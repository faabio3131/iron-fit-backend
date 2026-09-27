import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const { decryptActionSecret, totpCode } = require('../dist/src/modules/auth/auth-security.js');

const prisma = new PrismaClient();
const API = process.env.B6_API_URL ?? 'http://127.0.0.1:3333/api/v1';
const billingSecret = process.env.SAAS_BILLING_SANDBOX_SECRET;
if (!billingSecret) throw new Error('SAAS_BILLING_SANDBOX_SECRET ausente');

const startedAt = Date.now();
const evidence = [];

function record(name, detail = {}) {
  evidence.push({ name, ...detail });
  process.stdout.write(JSON.stringify({ event: 'b6_e2e', name, ...detail }) + '\n');
}

async function http(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  const expected = options.expected ?? [200, 201, 202, 204];
  if (!expected.includes(response.status)) {
    throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status}: ${text}`);
  }
  return { status: response.status, body, headers: response.headers };
}

async function waitForReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const result = await http('/health/ready', { expected: [200] });
      if (result.body?.status === 'ok' && result.body?.probe === 'readiness' && result.body?.dependencies?.postgres === 'up') return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('backend nao ficou ready');
}

function uuid() {
  return crypto.randomUUID();
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function billingSignature(payload) {
  return createHmac('sha256', billingSecret).update(canonical(payload)).digest('hex');
}

async function login(email, password, extra = {}) {
  return (await http('/auth/login', {
    method: 'POST',
    body: { email, password, ...extra },
    expected: [200],
  })).body;
}

async function signedBillingWebhook(payload) {
  return http('/saas-billing/webhooks/INTERNAL_SANDBOX', {
    method: 'POST',
    headers: { 'x-saas-billing-signature': `sha256=${billingSignature(payload)}` },
    body: payload,
    expected: [200, 201],
  });
}

async function payCheckout(checkout, suffix, amountMinor = checkout.amountMinor) {
  const now = new Date();
  const end = new Date(now);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const payload = {
    eventId: `evt-${suffix}-${uuid()}`,
    eventType: 'invoice.paid',
    occurredAt: now.toISOString(),
    data: {
      providerSessionRef: checkout.providerSessionRef,
      providerInvoiceRef: `inv-${suffix}-${uuid()}`,
      providerPaymentRef: `pay-${suffix}-${uuid()}`,
      providerSubscriptionRef: 'sandbox-subscription-b6',
      amountMinor,
      currency: checkout.currency,
      periodStart: now.toISOString(),
      periodEnd: end.toISOString(),
    },
  };
  const result = await signedBillingWebhook(payload);
  const replay = await signedBillingWebhook(payload);
  assert.equal(replay.body.idempotent, true);
  return result.body;
}

function actionConfig() {
  return { get: (key) => process.env[key] };
}

async function main() {
  await waitForReady();
  const live = await http('/health/live', { expected: [200] });
  assert.equal(live.body.status, 'ok');
  assert.equal(live.body.probe, 'liveness');
  record('health_ready_live');

  const admin = await login('admin@gym-saas.com', 'admin123');
  assert.ok(admin.access_token);
  record('super_admin_login');

  const trialPassword = 'Strong-Trial-2026!';
  const trialEmail = 'b6.owner.a@example.com';
  const trialARequest = uuid();
  const trialA = (await http('/commercial/trial/start', {
    method: 'POST',
    body: {
      requestId: trialARequest,
      email: trialEmail,
      password: trialPassword,
      name: 'Owner B6 A',
      gymName: 'IRON B6 Academy A',
      timezone: 'America/Sao_Paulo',
    },
    expected: [201],
  })).body;
  const trialReplay = (await http('/commercial/trial/start', {
    method: 'POST',
    body: {
      requestId: trialARequest,
      email: trialEmail,
      password: trialPassword,
      name: 'Owner B6 A',
      gymName: 'IRON B6 Academy A',
      timezone: 'America/Sao_Paulo',
    },
    expected: [201],
  })).body;
  assert.equal(trialReplay.idempotentReplay, true);
  assert.equal(trialReplay.gymId, trialA.gymId);
  record('trial_create_and_idempotent_replay', { gymId: trialA.gymId });

  const ownerLogin = await login(trialEmail, trialPassword);
  let ownerToken = ownerLogin.access_token;
  let ownerRefresh = ownerLogin.refresh_token;
  assert.equal(ownerLogin.user.activeGymId, trialA.gymId);

  const trialStatus = (await http('/commercial/trial/status', { token: ownerToken })).body;
  assert.equal(trialStatus.status, 'TRIALING');
  record('owner_login_and_trial_status');

  for (const step of ['ACADEMY_PROFILE', 'EQUIPMENT_INVENTORY', 'TEAM_REVIEW', 'FINISH']) {
    const data = step === 'ACADEMY_PROFILE'
      ? { name: 'IRON B6 Academy A Certified', timezone: 'America/Sao_Paulo' }
      : undefined;
    await http('/commercial/onboarding', {
      method: 'PATCH',
      token: ownerToken,
      body: { step, ...(data ? { data } : {}) },
    });
  }
  const onboarding = (await http('/commercial/onboarding', { token: ownerToken })).body;
  assert.equal(onboarding.status, 'COMPLETED');
  record('onboarding_complete');

  const managerPassword = 'Manager-B6-2026!';
  const trainerPassword = 'Trainer-B6-2026!';
  await http('/users', {
    method: 'POST',
    token: ownerToken,
    body: { email: 'b6.manager@example.com', password: managerPassword, name: 'Manager B6', roleName: 'MANAGER' },
  });
  await http('/users', {
    method: 'POST',
    token: ownerToken,
    body: { email: 'b6.trainer@example.com', password: trainerPassword, name: 'Trainer B6', roleName: 'TRAINER' },
  });
  const manager = await login('b6.manager@example.com', managerPassword);
  const trainer = await login('b6.trainer@example.com', trainerPassword);
  assert.equal(manager.user.roles.includes('MANAGER'), true);
  assert.equal(trainer.user.roles.includes('TRAINER'), true);
  await http('/users', { token: trainer.access_token, expected: [403] });
  record('team_rbac_owner_manager_trainer');

  const createdStudent = (await http('/students', {
    method: 'POST',
    token: ownerToken,
    body: {
      name: 'Student B6',
      email: 'b6.student@example.com',
      phone: '+5511999999999',
      goal: 'HIPERTROFIA',
      level: 'INTERMEDIARIO',
      consentHealth: true,
      consentComm: true,
      consentBiometry: false,
    },
  })).body;
  assert.equal(createdStudent.onboarding.required, true);
  await http('/student-onboarding/accept-invite', {
    method: 'POST',
    body: { token: createdStudent.onboarding.token, password: 'Student-B6-2026!' },
  });
  const studentLogin = await login('b6.student@example.com', 'Student-B6-2026!');
  assert.equal(studentLogin.user.roles.includes('STUDENT'), true);
  await http('/users', { token: studentLogin.access_token, expected: [403] });
  record('student_create_invite_activate_login', { studentId: createdStudent.id });

  const catalog = (await http('/equipments/catalog?search=B6%20Power%20Rack', {
    token: ownerToken,
  })).body;
  assert.ok(Array.isArray(catalog) && catalog.length === 1);
  const selectedEquipment = (await http('/equipments/catalog/selection', {
    method: 'POST',
    token: ownerToken,
    body: { catalogItemIds: [catalog[0].id] },
  })).body;
  assert.ok(Array.isArray(selectedEquipment) && selectedEquipment.length === 1);
  const equipment = selectedEquipment[0];
  const exercise = (await http('/exercises', {
    method: 'POST',
    token: ownerToken,
    body: { name: `Agachamento B6 ${Date.now()}`, muscleGroup: 'Pernas' },
  })).body;
  record('equipment_catalog_selection_and_exercise_created', { equipmentId: equipment.id });

  const assessment = (await http(`/students/${createdStudent.id}/assessments`, {
    method: 'POST',
    token: trainer.access_token,
    body: { weight: 80, height: 182, bodyFatPercent: 17, notes: 'B6 integrated assessment' },
  })).body;
  assert.ok(assessment.id);
  const persistedAssessment = await prisma.assessment.findUniqueOrThrow({ where: { id: assessment.id } });
  assert.equal(persistedAssessment.studentId, createdStudent.id);

  const workout = (await http('/workouts', {
    method: 'POST',
    token: trainer.access_token,
    body: {
      studentId: createdStudent.id,
      assessmentId: assessment.id,
      goal: 'Hipertrofia B6',
      level: 'INTERMEDIARIO',
      weeklyFrequency: 4,
      sessions: [{
        name: 'Treino Integrado B6',
        order: 1,
        exercises: [{
          exerciseId: exercise.id,
          order: 1,
          sets: 4,
          reps: '10',
          restSeconds: 60,
        }],
      }],
    },
  })).body;
  await http(`/workouts/${workout.id}/status`, {
    method: 'PATCH',
    token: trainer.access_token,
    body: { status: 'APPROVED' },
  });
  await http(`/workouts/${workout.id}/status`, {
    method: 'PATCH',
    token: trainer.access_token,
    body: { status: 'ACTIVE' },
  });

  const aiFailure = await http('/ai/workout-candidates', {
    method: 'POST',
    token: trainer.access_token,
    body: { studentId: createdStudent.id, assessmentId: assessment.id, instructions: 'Gerar candidato B6' },
    expected: [503],
  });
  assert.ok(aiFailure.body);
  record('assessment_workout_human_review_and_ai_fail_closed');

  const slot = (await http('/schedule-slots', {
    method: 'POST',
    token: manager.access_token,
    body: { weekday: 1, startTime: '07:00', endTime: '08:00', capacity: 20, active: true },
  })).body;
  const schedule = (await http('/schedules', {
    method: 'POST',
    token: manager.access_token,
    body: { studentId: createdStudent.id, slotId: slot.id, date: '2026-09-28T10:00:00.000Z' },
  })).body;
  await http(`/schedules/${schedule.id}/check-in`, {
    method: 'PATCH',
    token: manager.access_token,
  });
  record('schedule_booking_checkin');

  const credential = (await http('/access/credentials', {
    method: 'POST',
    token: ownerToken,
    body: { studentId: createdStudent.id, type: 'QR_CODE' },
  })).body;
  assert.ok(credential.id);
  await http('/me/check-in', { method: 'POST', token: studentLogin.access_token });
  const events = (await http('/access/events', { token: ownerToken })).body;
  assert.ok(Array.isArray(events) && events.length > 0);
  record('access_credential_and_event_history');

  const account = (await http('/financial/accounts', {
    method: 'POST',
    token: ownerToken,
    body: { name: 'Caixa B6', type: 'CASH', initialBalance: 0 },
  })).body;
  await http('/financial/subscriptions', {
    method: 'POST',
    token: ownerToken,
    body: { studentId: createdStudent.id, planName: 'Mensal B6', amount: 19990, nextBillingAt: '2026-10-26T00:00:00.000Z' },
  });
  const charge = (await http('/financial/charges', {
    method: 'POST',
    token: ownerToken,
    body: { studentId: createdStudent.id, amount: 19990, dueDate: '2026-09-27T00:00:00.000Z', paymentMethod: 'PIX' },
  })).body;
  await http(`/financial/charges/${charge.id}/pay`, {
    method: 'PATCH',
    token: ownerToken,
    body: { accountId: account.id, paymentMethod: 'PIX' },
  });
  record('student_financial_lifecycle');

  for (const [priceCode, planCode, amountMinor] of [
    ['IRON_BASIC_MONTHLY', 'IRON_BASIC', 9900],
    ['IRON_PRO_MONTHLY', 'IRON_PRO', 19900],
    ['IRON_PRO_PLUS_MONTHLY', 'IRON_PRO_PLUS', 29900],
  ]) {
    await http('/saas-billing/prices', {
      method: 'POST',
      token: admin.access_token,
      body: { priceCode, planCode, version: 1, currency: 'BRL', amountMinor, interval: 'MONTHLY' },
    });
  }

  const proCheckout = (await http('/saas-billing/checkout', {
    method: 'POST',
    token: ownerToken,
    body: { requestId: uuid(), priceCode: 'IRON_PRO_MONTHLY' },
  })).body;
  await payCheckout(proCheckout, 'trial-to-pro');
  let currentProduct = (await http('/product-entitlements/tenant/current', { token: ownerToken })).body;
  assert.equal(currentProduct.planVersion.productPlan.code, 'IRON_PRO');
  record('billing_trial_to_paid');

  const upgrade = (await http('/saas-billing/change-plan', {
    method: 'POST',
    token: ownerToken,
    body: { requestId: uuid(), priceCode: 'IRON_PRO_PLUS_MONTHLY', transitionKind: 'UPGRADE', reason: 'B6 upgrade' },
  })).body;
  assert.equal(upgrade.transitionKind, 'UPGRADE');
  await payCheckout(upgrade.checkout, 'upgrade-plus', upgrade.checkout.amountMinor);
  currentProduct = (await http('/product-entitlements/tenant/current', { token: ownerToken })).body;
  assert.equal(currentProduct.planVersion.productPlan.code, 'IRON_PRO_PLUS');

  const downgrade = (await http('/saas-billing/change-plan', {
    method: 'POST',
    token: ownerToken,
    body: { requestId: uuid(), priceCode: 'IRON_BASIC_MONTHLY', transitionKind: 'DOWNGRADE', reason: 'B6 downgrade' },
  })).body;
  assert.equal(downgrade.transitionKind ?? 'DOWNGRADE', 'DOWNGRADE');
  assert.ok(downgrade.scheduledFor);
  record('billing_upgrade_and_downgrade_schedule');

  const agreement = await prisma.saasBillingAgreement.findFirstOrThrow({
    where: { gymId: trialA.gymId, status: 'ACTIVE' },
  });
  await prisma.saasBillingAgreement.update({
    where: { id: agreement.id },
    data: { nextBillingAt: new Date(Date.now() - 2 * 86400000) },
  });
  await http('/saas-billing/admin/recurrence/run', {
    method: 'POST',
    token: admin.access_token,
    body: { asOf: new Date().toISOString() },
  });
  const recurringInvoice = await prisma.saasInvoice.findFirstOrThrow({
    where: { agreementId: agreement.id, status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
  });

  await http('/saas-billing/admin/dunning/run', {
    method: 'POST',
    token: admin.access_token,
    body: { asOf: new Date(Date.now() + 3 * 86400000).toISOString() },
  });
  let suspended = await prisma.tenantProductSubscription.findFirstOrThrow({
    where: { gymId: trialA.gymId, status: 'SUSPENDED' },
  });
  assert.ok(suspended);

  const reactivatePayload = {
    eventId: `evt-reactivate-${uuid()}`,
    eventType: 'invoice.paid',
    occurredAt: new Date().toISOString(),
    data: {
      invoiceId: recurringInvoice.id,
      providerPaymentRef: `pay-reactivate-${uuid()}`,
      amountMinor: recurringInvoice.amountDueMinor,
      currency: recurringInvoice.currency,
    },
  };
  await signedBillingWebhook(reactivatePayload);
  const activeAfterPayment = await prisma.tenantProductSubscription.findFirstOrThrow({
    where: { gymId: trialA.gymId, status: 'ACTIVE' },
  });
  assert.equal(activeAfterPayment.id, suspended.id);
  record('dunning_suspension_and_reactivation');

  const studentProfile = (await http('/me/profile', { token: studentLogin.access_token })).body;
  const studentWorkouts = (await http('/me/workouts', { token: studentLogin.access_token })).body;
  const studentAssessments = (await http('/me/assessments', { token: studentLogin.access_token })).body;
  const studentSchedules = (await http('/me/schedules', { token: studentLogin.access_token })).body;
  const studentCharges = (await http('/me/charges', { token: studentLogin.access_token })).body;
  assert.equal(studentProfile.id, createdStudent.id);
  assert.ok(studentWorkouts.length > 0);
  assert.ok(studentAssessments.length > 0);
  assert.ok(studentSchedules.length > 0);
  assert.ok(studentCharges.length > 0);
  record('student_mobile_domain_surface');

  const trialB = (await http('/commercial/trial/start', {
    method: 'POST',
    body: {
      requestId: uuid(),
      email: 'b6.owner.b@example.com',
      password: 'Strong-Tenant-B-2026!',
      name: 'Owner B6 B',
      gymName: 'IRON B6 Academy B',
      timezone: 'America/Sao_Paulo',
    },
    expected: [201],
  })).body;
  await http(`/equipments?gymId=${trialB.gymId}`, {
    token: ownerToken,
    expected: [400, 403, 404],
  });
  record('cross_tenant_denied');

  const tampered = ownerToken.slice(0, -2) + 'xx';
  await http('/auth/me', { token: tampered, expected: [401] });
  record('tampered_claim_token_denied');

  const refresh1 = (await http('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: ownerRefresh },
    expected: [200],
  })).body;
  await http('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: ownerRefresh },
    expected: [401],
  });
  await http('/auth/me', { token: refresh1.access_token, expected: [401] });
  const reloginAfterReplay = await login(trialEmail, trialPassword);
  ownerToken = reloginAfterReplay.access_token;
  ownerRefresh = reloginAfterReplay.refresh_token;
  record('refresh_rotation_replay_revokes_session');

  await http('/auth/password/reset/request', {
    method: 'POST',
    body: { email: trialEmail },
    expected: [202],
  });
  const resetRecord = await prisma.authActionToken.findFirstOrThrow({
    where: { user: { email: trialEmail }, kind: 'PASSWORD_RESET', consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  const resetToken = decryptActionSecret(actionConfig(), resetRecord.deliveryCiphertext);
  const resetPassword = 'Reset-Owner-B6-2026!';
  await http('/auth/password/reset/confirm', {
    method: 'POST',
    body: { token: resetToken, newPassword: resetPassword },
  });
  await http('/auth/password/reset/confirm', {
    method: 'POST',
    body: { token: resetToken, newPassword: 'Replay-Blocked-2026!' },
    expected: [401],
  });
  await http('/auth/me', { token: ownerToken, expected: [401] });
  const afterReset = await login(trialEmail, resetPassword);
  ownerToken = afterReset.access_token;
  ownerRefresh = afterReset.refresh_token;
  record('password_reset_replay_and_session_invalidation');

  const mfaSetup = (await http('/auth/mfa/setup', {
    method: 'POST',
    token: ownerToken,
    body: { currentPassword: resetPassword },
  })).body;
  const mfaCode = totpCode(mfaSetup.secret);
  await http('/auth/mfa/confirm', {
    method: 'POST',
    token: ownerToken,
    body: { code: mfaCode },
  });
  await http('/auth/logout', {
    method: 'POST',
    body: { refreshToken: ownerRefresh },
  });

  const mfaChallenge = await login(trialEmail, resetPassword);
  assert.equal(mfaChallenge.requires_mfa, true);
  assert.equal(Boolean(mfaChallenge.access_token), false);
  await http('/auth/login', {
    method: 'POST',
    body: { email: trialEmail, password: resetPassword, mfaCode: '000000' },
    expected: [401],
  });
  const withMfa = await login(trialEmail, resetPassword, { mfaCode: totpCode(mfaSetup.secret) });
  assert.ok(withMfa.access_token);
  ownerToken = withMfa.access_token;
  record('mfa_required_and_bypass_denied');

  const ownerSessions = (await http('/auth/sessions', { token: ownerToken })).body;
  assert.ok(Array.isArray(ownerSessions) && ownerSessions.length > 0);
  record('session_list_available');

  const burstStart = Date.now();
  const burst = await Promise.all(
    Array.from({ length: 40 }, (_, index) =>
      index % 2 === 0
        ? http('/health/live', { expected: [200] })
        : http('/auth/me', { token: ownerToken, expected: [200] }),
    ),
  );
  assert.equal(burst.length, 40);
  const burstMs = Date.now() - burstStart;
  assert.ok(burstMs < 10000, `burst demorou ${burstMs}ms`);
  record('concurrency_burst', { requests: 40, durationMs: burstMs });

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await http('/auth/login', {
      method: 'POST',
      body: { email: 'b6.bruteforce@example.com', password: 'Wrong-Password-2026!' },
      expected: [401, 429],
    });
    if (attempt === 5) assert.equal(result.status, 429);
  }
  record('brute_force_rate_limit');

  await http('/auth/logout', {
    method: 'POST',
    body: { refreshToken: withMfa.refresh_token },
  });
  await http('/auth/me', { token: ownerToken, expected: [401] });
  record('logout_session_revocation');

  const reconciliation = await http('/saas-billing/admin/reconcile', {
    method: 'POST',
    token: admin.access_token,
    body: {},
  });
  assert.equal(reconciliation.body.mismatches, 0);
  record('billing_reconciliation_zero_mismatch');

  const elapsedMs = Date.now() - startedAt;
  process.stdout.write(JSON.stringify({
    event: 'b6_system_certification_complete',
    elapsedMs,
    checks: evidence.length,
    evidence,
  }) + '\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
