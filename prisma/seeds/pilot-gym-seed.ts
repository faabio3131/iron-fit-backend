import { Prisma, PrismaClient, RoleName } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { passwordPolicyViolations } from '../../src/modules/auth/auth-security';

const PILOT_ROLES: RoleName[] = ['OWNER', 'RECEPTION', 'TRAINER'];
export type PilotConfig = {
  gym: { name: string; slug: string; timezone: string };
  planVersionId: string;
  effectiveUntil: string;
  users: { role: RoleName; name: string; email: string }[];
};

export function validatePilotConfig(input: PilotConfig, env: NodeJS.ProcessEnv) {
  if (env.IRON_RUNTIME_ENV !== 'HOMOLOG' || env.IRON_PILOT_APPLY !== input?.gym?.slug) {
    throw new Error('PILOT_ENVIRONMENT_CONFIRMATION_REQUIRED');
  }
  if (!input.gym.name?.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.gym.slug)) {
    throw new Error('PILOT_GYM_INVALID');
  }
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: input.gym.timezone }).format(); }
  catch { throw new Error('PILOT_TIMEZONE_INVALID'); }
  const until = new Date(input.effectiveUntil);
  if (!input.planVersionId || !Number.isFinite(until.getTime()) || until <= new Date() ||
      until.getTime() > Date.now() + 31 * 86400000) throw new Error('PILOT_TERM_INVALID');
  if (!Array.isArray(input.users) || input.users.length !== 3 ||
      PILOT_ROLES.some(role => input.users.filter(user => user.role === role).length !== 1)) {
    throw new Error('PILOT_ROLES_INVALID');
  }
  const users = PILOT_ROLES.map(role => {
    const user = input.users.find(entry => entry.role === role)!;
    const email = user.email?.trim().toLowerCase();
    if (!user.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('PILOT_USER_INVALID');
    }
    const password = env[`IRON_PILOT_${role}_PASSWORD`];
    if (!password || passwordPolicyViolations(password).length || Buffer.byteLength(password) > 72) {
      throw new Error('PILOT_PASSWORD_POLICY');
    }
    return { role, name: user.name.trim(), email, password };
  });
  if (new Set(users.map(user => user.email)).size !== 3 ||
      new Set(users.map(user => user.password)).size !== 3) throw new Error('PILOT_USERS_DISTINCT_REQUIRED');
  return { ...input, users, until };
}

export async function provisionPilot(db: PrismaClient, input: PilotConfig, env: NodeJS.ProcessEnv) {
  const config = validatePilotConfig(input, env);
  const fingerprint = createHash('sha256').update(JSON.stringify({
    gym: input.gym, planVersionId: input.planVersionId, effectiveUntil: config.until.toISOString(),
    users: config.users.map(({ password: _password, ...user }) => user),
  })).digest('hex');
  const markerId = `pilot-v1:${config.gym.slug}`;
  const hashes = await Promise.all(config.users.map(user => bcrypt.hash(user.password, 12)));
  return db.$transaction(async tx => {
    const marker = await tx.auditLog.findUnique({ where: { id: markerId } });
    if (marker) {
      const next = marker.next as { fingerprint?: string; subscriptionId?: string };
      if (next?.fingerprint !== fingerprint || !marker.gymId) throw new Error('PILOT_REPLAY_CONFLICT');
      const gym = await tx.gym.findUnique({ where: { id: marker.gymId } });
      const subscription = await tx.tenantProductSubscription.findUnique({ where: { id: next.subscriptionId } });
      if (!gym?.active || gym.slug !== config.gym.slug || gym.name !== config.gym.name ||
          gym.timezone !== config.gym.timezone || subscription?.gymId !== gym.id ||
          subscription.status !== 'ACTIVE' || subscription.planVersionId !== config.planVersionId ||
          subscription.effectiveUntil?.getTime() !== config.until.getTime()) throw new Error('PILOT_STATE_DRIFT');
      for (const user of config.users) {
        const existing = await tx.user.findUnique({ where: { email: user.email }, include: { userRoles: { include: { role: true } } } });
        if (!existing?.active || existing.userRoles.length !== 1 ||
            existing.userRoles[0].gymId !== gym.id || !existing.userRoles[0].active ||
            existing.userRoles[0].role.name !== user.role) throw new Error('PILOT_STATE_DRIFT');
      }
      return { gymId: gym.id, subscriptionId: subscription.id, idempotentReplay: true };
    }
    // Refuse adoption of existing tenants/accounts; never reset or elevate them.
    if (await tx.gym.findUnique({ where: { slug: config.gym.slug } }) ||
        await tx.user.count({ where: { email: { in: config.users.map(user => user.email) } } })) {
      throw new Error('PILOT_IDENTITY_COLLISION');
    }
    const plan = await tx.productPlanVersion.findUnique({ where: { id: config.planVersionId } });
    if (plan?.status !== 'PUBLISHED') throw new Error('PILOT_PUBLISHED_PLAN_REQUIRED');
    const roles = await tx.role.findMany({ where: { name: { in: PILOT_ROLES } } });
    if (roles.length !== 3) throw new Error('PILOT_CANONICAL_RBAC_REQUIRED');
    const gym = await tx.gym.create({ data: { name: config.gym.name, slug: config.gym.slug, timezone: config.gym.timezone } });
    for (const [index, user] of config.users.entries()) {
      await tx.user.create({ data: {
        name: user.name, email: user.email, passwordHash: hashes[index],
        userRoles: { create: { roleId: roles.find(role => role.name === user.role)!.id, gymId: gym.id } },
      } });
    }
    const subscription = await tx.tenantProductSubscription.create({ data: {
      gymId: gym.id, planVersionId: config.planVersionId, status: 'ACTIVE', effectiveUntil: config.until,
    } });
    await tx.auditLog.create({ data: {
      id: markerId, gymId: gym.id, action: 'PILOT_GYM_PROVISIONED', entity: 'Gym', entityId: gym.id,
      next: { fingerprint, subscriptionId: subscription.id, environment: 'HOMOLOG' },
    } });
    return { gymId: gym.id, subscriptionId: subscription.id, idempotentReplay: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

if (require.main === module) {
  const db = new PrismaClient();
  Promise.resolve().then(async () => {
    if (!process.env.IRON_PILOT_CONFIG_PATH) throw new Error('PILOT_CONFIG_PATH_REQUIRED');
    const config = JSON.parse(readFileSync(process.env.IRON_PILOT_CONFIG_PATH, 'utf8')) as PilotConfig;
    const result = await provisionPilot(db, config, process.env);
    console.log(JSON.stringify(result));
  }).catch(() => {
    // Prisma errors may contain connection strings or submitted values.
    console.error('PILOT_SEED_FAILED: revisar preflight, configuracao e estado; nenhum segredo exibido');
    process.exitCode = 1;
  }).finally(() => db.$disconnect());
}
