import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { provisionPilot } = require('../dist/prisma/seeds/pilot-gym-seed.js');
const { compare } = require('bcrypt');
const url = new URL(process.env.DATABASE_URL || '');
if (process.env.NODE_ENV !== 'test' || process.env.IRON_RUNTIME_ENV !== 'HOMOLOG' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/iron_ci') {
  throw new Error('Disposable iron_ci database required');
}
const db = new PrismaClient();
const suffix = randomUUID();
const slug = `pilot-cert-${suffix}`;
const roles = ['OWNER', 'RECEPTION', 'TRAINER'];
const config = { gym: { name: 'Synthetic CI pilot', slug, timezone: 'America/Sao_Paulo' }, planVersionId: '', effectiveUntil: new Date(Date.now() + 30 * 86400000).toISOString(), users: roles.map(role => ({ role, name: role, email: `${role.toLowerCase()}-${suffix}@example.invalid` })) };
const env = { IRON_RUNTIME_ENV: 'HOMOLOG', IRON_PILOT_APPLY: slug, ...Object.fromEntries(roles.map(role => [`IRON_PILOT_${role}_PASSWORD`, `Synthetic-${role}-${suffix}!`])) };
let planId;
try {
  for (const name of roles) await db.role.upsert({ where: { name }, create: { name }, update: {} });
  const plan = await db.productPlan.create({ data: { code: slug, name: slug, versions: { create: { version: 1, status: 'DRAFT' } } }, include: { versions: true } });
  planId = plan.id; config.planVersionId = plan.versions[0].id;
  await assert.rejects(provisionPilot(db, config, env), /PUBLISHED/);
  assert.equal(await db.gym.count({ where: { slug } }), 0);
  await db.productPlanVersion.update({ where: { id: config.planVersionId }, data: { status: 'PUBLISHED' } });
  const first = await provisionPilot(db, config, env);
  assert.equal(first.idempotentReplay, false);
  const users = await db.user.findMany({ where: { email: { in: config.users.map(u => u.email) } }, include: { userRoles: { include: { role: true } } } });
  assert.equal(users.length, 3);
  for (const user of users) {
    assert.equal(user.emailVerifiedAt, null);
    assert.equal(user.userRoles.length, 1);
    assert.equal(user.userRoles[0].gymId, first.gymId);
    assert.ok(roles.includes(user.userRoles[0].role.name));
    assert.ok(await compare(env[`IRON_PILOT_${user.userRoles[0].role.name}_PASSWORD`], user.passwordHash));
  }
  const replay = await provisionPilot(db, config, env);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.gymId, first.gymId);
  assert.equal(await db.tenantProductSubscription.count({ where: { gymId: first.gymId } }), 1);
  const hashes = users.map(user => user.passwordHash).sort();
  assert.deepEqual((await db.user.findMany({ where: { id: { in: users.map(u => u.id) } } })).map(u => u.passwordHash).sort(), hashes);
  await assert.rejects(provisionPilot(db, { ...config, gym: { ...config.gym, name: 'changed' } }, env), /REPLAY_CONFLICT/);
  await assert.rejects(provisionPilot(db, { ...config, gym: { ...config.gym, slug: `${slug}-other` } }, { ...env, IRON_PILOT_APPLY: `${slug}-other` }), /IDENTITY_COLLISION/);
  await db.user.update({ where: { id: users[0].id }, data: { active: false } });
  await assert.rejects(provisionPilot(db, config, env), /STATE_DRIFT/);
  console.log('PILOT PostgreSQL PASS: atomic preflight, three tenant roles, password hashes, replay, collision and drift');
} finally {
  const gym = await db.gym.findUnique({ where: { slug } });
  if (gym) {
    await db.auditLog.deleteMany({ where: { gymId: gym.id } });
    await db.tenantProductSubscription.deleteMany({ where: { gymId: gym.id } });
    await db.gym.delete({ where: { id: gym.id } });
  }
  await db.user.deleteMany({ where: { email: { in: config.users.map(u => u.email) } } });
  if (planId) { await db.productPlanVersion.deleteMany({ where: { productPlanId: planId } }); await db.productPlan.delete({ where: { id: planId } }); }
  await db.$disconnect();
}
