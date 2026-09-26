import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const {
  canonicalBillingPayload,
} = require('../dist/src/modules/saas-billing/contracts/saas-billing-provider.port.js');
const {
  decryptActionSecret,
  totpCode,
} = require('../dist/src/modules/auth/auth-security.js');

const prisma = new PrismaClient();
const PORT = 3346;
const BASE = 'http://127.0.0.1:' + PORT + '/api/v1';
const JWT_SECRET = 'b6-jwt-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MFA_KEY = '11'.repeat(32);
const ACTION_KEY = '22'.repeat(32);
const BILLING_SECRET = 'b6-sandbox-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TRIAL_CODE = 'B6_TRIAL';
const BASIC_CODE = 'B6_BASIC';
const PRO_CODE = 'B6_PRO';
const BASIC_PRICE = 'B6_BASIC_MONTHLY';
const PRO_PRICE = 'B6_PRO_MONTHLY';
const adminPassword = 'B6Admin#2026Aa';
const ownerPassword = 'B6Owner#2026Aa';
const ownerPasswordAfterReset = 'B6Owner#2026Bb';
const managerPassword = 'B6Manager#2026Aa';
const trainerPassword = 'B6Trainer#2026Aa';
const studentPassword = 'B6Student#2026Aa';

let server;
const serverOutput = [];

function log(message, extra = undefined) {
  process.stdout.write(
    JSON.stringify({
      event: 'b6_e2e',
      message,
      ...(extra === undefined ? {} : { extra }),
    }) + '\n',
  );
}

async function raw(path, options = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(options.token ? { authorization: 'Bearer ' + options.token } : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(BASE + path, {
    method: options.method ?? 'GET',
    headers,
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: response.status, data };
}

async function api(path, options = {}) {
  const result = await raw(path, options);
  const expected = Array.isArray(options.expect)
    ? options.expect
    : [options.expect ?? 200];
  assert.ok(
    expected.includes(result.status),
    [
      options.method ?? 'GET',
      path,
      'expected ' + expected.join('/') + ' got ' + result.status,
      JSON.stringify(result.data),
    ].join(' '),
  );
  return result.data;
}

async function waitForReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(
        'Backend B6 encerrou antes do readiness: ' +
          serverOutput.slice(-20).join('\n'),
      );
    }
    try {
      const response = await fetch(BASE + '/health/ready');
      if (response.status === 200) return;
    } catch {
      // startup in progress
    }
    await delay(250);
  }
  throw new Error(
    'Timeout aguardando readiness B6: ' + serverOutput.slice(-20).join('\n'),
  );
}

function startServer() {
  server = spawn(process.execPath, ['dist/src/main.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT),
      JWT_SECRET,
      JWT_EXPIRES_IN: '15m',
      CORS_ORIGINS: 'http://localhost:3000',
      TRUST_PROXY_HOPS: '0',
      MFA_ENCRYPTION_KEY: MFA_KEY,
      AUTH_ACTION_TOKEN_ENCRYPTION_KEY: ACTION_KEY,
      AUTH_REQUIRE_VERIFIED_EMAIL: 'false',
      IRON_FIT_TRIAL_PLAN_CODE: TRIAL_CODE,
      IRON_FIT_TRIAL_DAYS: '14',
      SAAS_BILLING_PROVIDER: 'INTERNAL_SANDBOX',
      SAAS_BILLING_SANDBOX_ENABLED: 'true',
      SAAS_BILLING_SANDBOX_SECRET: BILLING_SECRET,
      SAAS_BILLING_INVOICE_DUE_DAYS: '0',
      SAAS_BILLING_DUNNING_GRACE_DAYS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (chunk) => {
      const text = String(chunk);
      serverOutput.push(text.trim());
      if (serverOutput.length > 200) serverOutput.shift();
    });
  }
}

async function upsertRole(name) {
  return prisma.role.upsert({
    where: { name },
    update: {},
    create: { name, description: 'B6 integrated certification role' },
  });
}

async function seedPlan(code, name, features) {
  const plan = await prisma.productPlan.upsert({
    where: { code },
    update: { name },
    create: { code, name },
  });
  const version = await prisma.productPlanVersion.upsert({
    where: {
      productPlanId_version: {
        productPlanId: plan.id,
        version: 1,
      },
    },
    update: {
      status: 'PUBLISHED',
      publishedAt: new Date(),
      retiredAt: null,
    },
    create: {
      productPlanId: plan.id,
      version: 1,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  for (const [featureKey, featureEnabled] of Object.entries(features)) {
    await prisma.productPlanEntitlement.upsert({
      where: {
        planVersionId_featureKey: {
          planVersionId: version.id,
          featureKey,
        },
      },
      update: {
        kind: 'FEATURE',
        featureEnabled,
        limitValue: null,
        policyValues: null,
      },
      create: {
        planVersionId: version.id,
        featureKey,
        kind: 'FEATURE',
        featureEnabled,
      },
    });
  }
  return version;
}

async function seedFoundation() {
  for (const role of [
    'SUPER_ADMIN',
    'OWNER',
    'MANAGER',
    'RECEPTION',
    'TRAINER',
    'STUDENT',
  ]) {
    await upsertRole(role);
  }

  const common = {
    'equipment.catalog': true,
    'equipment.inventory': true,
    'ai.workout_generation': true,
    'content.tenant_private': true,
  };
  await seedPlan(TRIAL_CODE, 'B6 Trial', {
    ...common,
    'content.iron_managed': false,
  });
  await seedPlan(BASIC_CODE, 'B6 Basic', {
    ...common,
    'content.iron_managed': false,
  });
  await seedPlan(PRO_CODE, 'B6 Pro', {
    ...common,
    'content.iron_managed': true,
  });

  const adminHash = await bcrypt.hash(adminPassword, 12);
  const admin = await prisma.user.upsert({
    where: { email: 'b6-admin@iron.invalid' },
    update: {
      passwordHash: adminHash,
      active: true,
      emailVerifiedAt: new Date(),
      mfaEnabled: false,
      mfaSecret: null,
    },
    create: {
      email: 'b6-admin@iron.invalid',
      name: 'B6 Super Admin',
      passwordHash: adminHash,
      active: true,
      emailVerifiedAt: new Date(),
    },
  });
  const role = await prisma.role.findUniqueOrThrow({
    where: { name: 'SUPER_ADMIN' },
  });
  const existing = await prisma.userRole.findFirst({
    where: { userId: admin.id, roleId: role.id, gymId: null },
  });
  if (!existing) {
    await prisma.userRole.create({
      data: { userId: admin.id, roleId: role.id, gymId: null },
    });
  }

  const exercise = await prisma.exercise.upsert({
    where: { name: 'B6 Agachamento Livre' },
    update: {},
    create: {
      name: 'B6 Agachamento Livre',
      muscleGroup: 'LEGS',
      movement: 'SQUAT',
      level: 'INTERMEDIATE',
    },
  });

  const catalogA = await prisma.equipmentCatalogItem.upsert({
    where: { slug: 'b6-leg-press-canonical' },
    update: { active: true },
    create: {
      slug: 'b6-leg-press-canonical',
      name: 'B6 Leg Press Canonical',
      category: 'PLATE_LOADED',
      primaryMuscle: 'LEGS',
      active: true,
    },
  });
  const catalogB = await prisma.equipmentCatalogItem.upsert({
    where: { slug: 'b6-bike-canonical' },
    update: { active: true },
    create: {
      slug: 'b6-bike-canonical',
      name: 'B6 Bike Canonical',
      category: 'CARDIO',
      active: true,
    },
  });

  return { admin, exercise, catalogA, catalogB };
}

async function login(email, password, extra = {}) {
  return api('/auth/login', {
    method: 'POST',
    body: { email, password, ...extra },
    expect: 200,
  });
}

function webhookSignature(payload) {
  return createHmac('sha256', BILLING_SECRET)
    .update(canonicalBillingPayload(payload))
    .digest('hex');
}

async function sendBillingWebhook(payload) {
  return api('/saas-billing/webhooks/INTERNAL_SANDBOX', {
    method: 'POST',
    headers: {
      'x-saas-billing-signature':
        'sha256=' + webhookSignature(payload),
    },
    body: payload,
    expect: 201,
  });
}

function feature(rows, key) {
  return rows.find((item) => item.featureKey === key);
}

async function main() {
  const startedAt = Date.now();
  const { admin, exercise, catalogA, catalogB } = await seedFoundation();
  startServer();

  try {
    await waitForReady();
    log('backend readiness green');

    const adminLogin = await login(
      'b6-admin@iron.invalid',
      adminPassword,
    );
    const adminToken = adminLogin.access_token;
    assert.equal(typeof adminToken, 'string');

    for (const price of [
      {
        priceCode: BASIC_PRICE,
        planCode: BASIC_CODE,
        version: 1,
        currency: 'BRL',
        amountMinor: 10000,
        interval: 'MONTHLY',
      },
      {
        priceCode: PRO_PRICE,
        planCode: PRO_CODE,
        version: 1,
        currency: 'BRL',
        amountMinor: 20000,
        interval: 'MONTHLY',
      },
    ]) {
      await api('/saas-billing/prices', {
        method: 'POST',
        token: adminToken,
        body: price,
        expect: 201,
      });
    }

    const suffix = Date.now().toString(36);
    const ownerAEmail = 'b6-owner-a-' + suffix + '@iron.invalid';
    const ownerBEmail = 'b6-owner-b-' + suffix + '@iron.invalid';
    const managerEmail = 'b6-manager-' + suffix + '@iron.invalid';
    const trainerEmail = 'b6-trainer-' + suffix + '@iron.invalid';
    const studentEmail = 'b6-student-' + suffix + '@iron.invalid';

    const trialRequestId = randomUUID();
    const trialABody = {
      requestId: trialRequestId,
      email: ownerAEmail,
      password: ownerPassword,
      name: 'B6 Owner A',
      gymName: 'B6 Academy A ' + suffix,
      timezone: 'America/Sao_Paulo',
    };

    const concurrentTrial = await Promise.all([
      raw('/commercial/trial/start', {
        method: 'POST',
        body: trialABody,
      }),
      raw('/commercial/trial/start', {
        method: 'POST',
        body: trialABody,
      }),
    ]);
    assert.ok(
      concurrentTrial.some((item) => item.status === 201),
      JSON.stringify(concurrentTrial),
    );
    assert.ok(
      concurrentTrial.every((item) => [201, 409].includes(item.status)),
      JSON.stringify(concurrentTrial),
    );
    const trialA = await api('/commercial/trial/start', {
      method: 'POST',
      body: trialABody,
      expect: 201,
    });
    assert.equal(trialA.idempotentReplay, true);

    assert.equal(
      await prisma.commercialTrialProvisioning.count({
        where: { requestId: trialRequestId },
      }),
      1,
    );
    assert.equal(
      await prisma.user.count({ where: { email: ownerAEmail } }),
      1,
    );

    const trialB = await api('/commercial/trial/start', {
      method: 'POST',
      body: {
        requestId: randomUUID(),
        email: ownerBEmail,
        password: ownerPassword,
        name: 'B6 Owner B',
        gymName: 'B6 Academy B ' + suffix,
        timezone: 'America/Sao_Paulo',
      },
      expect: 201,
    });

    const ownerALogin = await login(ownerAEmail, ownerPassword);
    let ownerAToken = ownerALogin.access_token;
    let ownerARefresh = ownerALogin.refresh_token;
    const ownerBLogin = await login(ownerBEmail, ownerPassword);
    const ownerBToken = ownerBLogin.access_token;

    assert.equal(ownerALogin.user.activeGymId, trialA.gymId);
    assert.equal(ownerBLogin.user.activeGymId, trialB.gymId);

    const equipmentBSelection = await api('/equipments/catalog/selection', {
      method: 'POST',
      token: ownerBToken,
      body: { catalogItemIds: [catalogB.id] },
      expect: 201,
    });
    const equipmentB = equipmentBSelection[0];
    assert.equal(equipmentB.catalogItemId, catalogB.id);
    const foreignEquipment = await raw('/equipments/' + equipmentB.id, {
      token: ownerAToken,
    });
    assert.equal(foreignEquipment.status, 404);

    const spoof = await raw(
      '/equipments?gymId=' + encodeURIComponent(trialB.gymId),
      { token: ownerAToken },
    );
    assert.equal(spoof.status, 404);

    await api('/commercial/onboarding', {
      method: 'PATCH',
      token: ownerAToken,
      body: {
        step: 'ACADEMY_PROFILE',
        data: {
          name: 'B6 Academy A Certified',
          timezone: 'America/Sao_Paulo',
        },
      },
      expect: 200,
    });

    const weakUser = await raw('/users', {
      method: 'POST',
      token: ownerAToken,
      body: {
        email: 'b6-weak-' + suffix + '@iron.invalid',
        password: 'weakpassword12',
        name: 'B6 Weak',
        roleName: 'TRAINER',
      },
    });
    assert.equal(weakUser.status, 400);

    await api('/users', {
      method: 'POST',
      token: ownerAToken,
      body: {
        email: managerEmail,
        password: managerPassword,
        name: 'B6 Manager',
        roleName: 'MANAGER',
      },
      expect: 201,
    });
    await api('/users', {
      method: 'POST',
      token: ownerAToken,
      body: {
        email: trainerEmail,
        password: trainerPassword,
        name: 'B6 Trainer',
        roleName: 'TRAINER',
      },
      expect: 201,
    });

    const managerLogin = await login(managerEmail, managerPassword);
    const managerToken = managerLogin.access_token;
    const trainerLogin = await login(trainerEmail, trainerPassword);
    const trainerToken = trainerLogin.access_token;
    assert.equal(
      (await raw('/financial/accounts', { token: trainerToken })).status,
      403,
    );
    assert.equal(
      (await raw('/users', { token: trainerToken })).status,
      403,
    );
    await api('/students', {
      token: managerToken,
      expect: 200,
    });

    const equipmentASelection = await api('/equipments/catalog/selection', {
      method: 'POST',
      token: ownerAToken,
      body: { catalogItemIds: [catalogA.id] },
      expect: 201,
    });
    const equipmentA = equipmentASelection[0];
    assert.equal(equipmentA.catalogItemId, catalogA.id);

    await api('/commercial/onboarding', {
      method: 'PATCH',
      token: ownerAToken,
      body: { step: 'EQUIPMENT_INVENTORY' },
      expect: 200,
    });
    await api('/commercial/onboarding', {
      method: 'PATCH',
      token: ownerAToken,
      body: { step: 'TEAM_REVIEW' },
      expect: 200,
    });

    const student = await api('/students', {
      method: 'POST',
      token: ownerAToken,
      body: {
        name: 'B6 Student',
        email: studentEmail,
        goal: 'HIPERTROFIA',
        level: 'INTERMEDIARIO',
        consentHealth: true,
        consentComm: true,
      },
      expect: 201,
    });
    assert.equal(student.onboarding.required, true);

    const weakActivation = await raw(
      '/student-onboarding/accept-invite',
      {
        method: 'POST',
        body: {
          token: student.onboarding.token,
          password: 'weakpassword12',
        },
      },
    );
    assert.equal(weakActivation.status, 400);

    await api('/student-onboarding/accept-invite', {
      method: 'POST',
      body: {
        token: student.onboarding.token,
        password: studentPassword,
      },
      expect: 201,
    });

    const assessment = await api(
      '/students/' + student.id + '/assessments',
      {
        method: 'POST',
        token: trainerToken,
        body: {
          weight: 82,
          height: 1.8,
          bodyFatPercent: 16,
          notes: 'B6 integrated assessment',
        },
        expect: 201,
      },
    );

    const workout = await api('/workouts', {
      method: 'POST',
      token: trainerToken,
      body: {
        studentId: student.id,
        assessmentId: assessment.id,
        goal: 'HIPERTROFIA',
        level: 'INTERMEDIARIO',
        weeklyFrequency: 3,
        sessions: [
          {
            name: 'B6 Session A',
            order: 1,
            exercises: [
              {
                exerciseId: exercise.id,
                order: 1,
                sets: 4,
                reps: '8-12',
                restSeconds: 90,
              },
            ],
          },
        ],
      },
      expect: 201,
    });
    await api('/workouts/' + workout.id + '/status', {
      method: 'PATCH',
      token: trainerToken,
      body: { status: 'APPROVED' },
      expect: 200,
    });
    await api('/workouts/' + workout.id + '/status', {
      method: 'PATCH',
      token: trainerToken,
      body: { status: 'ACTIVE' },
      expect: 200,
    });

    const aiUnavailable = await raw('/ai/workout-candidates', {
      method: 'POST',
      token: trainerToken,
      body: {
        studentId: student.id,
        assessmentId: assessment.id,
        requestId: randomUUID(),
        instructions: 'Teste B6 fail-closed sem provider real',
      },
    });
    assert.ok(
      [502, 503].includes(aiUnavailable.status),
      JSON.stringify(aiUnavailable),
    );

    const bookingDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const slot = await api('/schedule-slots', {
      method: 'POST',
      token: ownerAToken,
      body: {
        weekday: bookingDate.getUTCDay(),
        startTime: '08:00',
        endTime: '09:00',
        capacity: 5,
      },
      expect: 201,
    });
    const booking = await api('/schedules', {
      method: 'POST',
      token: ownerAToken,
      body: {
        studentId: student.id,
        slotId: slot.id,
        date: bookingDate.toISOString(),
      },
      expect: 201,
    });
    await api('/schedules/' + booking.id + '/check-in', {
      method: 'PATCH',
      token: ownerAToken,
      expect: 200,
    });

    const device = await prisma.accessDevice.create({
      data: {
        gymId: trialA.gymId,
        name: 'B6 Gate',
        type: 'QR_CODE',
        active: true,
      },
    });
    const deviceAuth = await api(
      '/access/devices/' + device.id + '/token',
      {
        method: 'POST',
        token: ownerAToken,
        expect: 201,
      },
    );
    const credential = await api('/access/credentials', {
      method: 'POST',
      token: ownerAToken,
      body: { studentId: student.id, type: 'QR_CODE' },
      expect: 201,
    });
    const nonce = 'b6-nonce-' + randomUUID();
    const scanBody = {
      qrToken: credential.qrToken,
      deviceId: device.id,
      deviceToken: deviceAuth.deviceToken,
      nonce,
      timestamp: Date.now(),
    };
    const scanAllowed = await api('/access/scan', {
      method: 'POST',
      body: scanBody,
      expect: 201,
    });
    assert.equal(scanAllowed.allowed, true);
    const scanReplay = await api('/access/scan', {
      method: 'POST',
      body: { ...scanBody, timestamp: Date.now() },
      expect: 201,
    });
    assert.equal(scanReplay.allowed, false);
    assert.equal(scanReplay.denialReason, 'Replay detectado');
    const events = await api('/access/events', {
      token: ownerAToken,
      expect: 200,
    });
    assert.ok(events.some((event) => event.id === scanAllowed.eventId));
    assert.ok(events.some((event) => event.id === scanReplay.eventId));

    const account = await api('/financial/accounts', {
      method: 'POST',
      token: ownerAToken,
      body: {
        name: 'B6 Cash',
        type: 'CASH',
        initialBalance: 0,
      },
      expect: 201,
    });
    const studentSubscription = await api('/financial/subscriptions', {
      method: 'POST',
      token: ownerAToken,
      body: {
        studentId: student.id,
        planName: 'B6 Student Monthly',
        amount: 15000,
      },
      expect: 201,
    });
    const charge = await api('/financial/charges', {
      method: 'POST',
      token: ownerAToken,
      body: {
        studentId: student.id,
        subscriptionId: studentSubscription.id,
        amount: 15000,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        paymentMethod: 'PIX',
      },
      expect: 201,
    });
    const firstPay = await api(
      '/financial/charges/' + charge.id + '/pay',
      {
        method: 'PATCH',
        token: ownerAToken,
        body: {
          accountId: account.id,
          paymentMethod: 'PIX',
        },
        expect: 200,
      },
    );
    assert.equal(firstPay.idempotent, false);
    const secondPay = await api(
      '/financial/charges/' + charge.id + '/pay',
      {
        method: 'PATCH',
        token: ownerAToken,
        body: {
          accountId: account.id,
          paymentMethod: 'PIX',
        },
        expect: 200,
      },
    );
    assert.equal(secondPay.idempotent, true);

    await api('/commercial/onboarding', {
      method: 'PATCH',
      token: ownerAToken,
      body: { step: 'FINISH' },
      expect: 200,
    });
    const onboarding = await api('/commercial/onboarding', {
      token: ownerAToken,
      expect: 200,
    });
    assert.equal(onboarding.status, 'COMPLETED');

    const studentLogin = await login(studentEmail, studentPassword);
    const studentToken = studentLogin.access_token;
    const profile = await api('/me/profile', {
      token: studentToken,
      expect: 200,
    });
    assert.equal(profile.email, studentEmail);
    const mobileWorkouts = await api('/me/workouts', {
      token: studentToken,
      expect: 200,
    });
    assert.ok(mobileWorkouts.some((item) => item.id === workout.id));
    const mobileAssessments = await api('/me/assessments', {
      token: studentToken,
      expect: 200,
    });
    assert.ok(
      mobileAssessments.some((item) => item.id === assessment.id),
    );
    await api('/me/schedules', {
      token: studentToken,
      expect: 200,
    });
    const mobileCharges = await api('/me/charges', {
      token: studentToken,
      expect: 200,
    });
    assert.ok(mobileCharges.some((item) => item.id === charge.id));
    await api('/product-entitlements/me/features', {
      token: studentToken,
      expect: 200,
    });

    const checkoutBasic = await api('/saas-billing/checkout', {
      method: 'POST',
      token: ownerAToken,
      body: {
        requestId: randomUUID(),
        priceCode: BASIC_PRICE,
      },
      expect: 201,
    });
    assert.equal(checkoutBasic.sandboxOnly, true);

    const firstPeriodStart = new Date();
    const firstPeriodEnd = new Date(
      firstPeriodStart.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    const basicPaidEvent = {
      eventId: 'b6-basic-paid-' + randomUUID(),
      eventType: 'invoice.paid',
      occurredAt: firstPeriodStart.toISOString(),
      data: {
        providerSessionRef: checkoutBasic.providerSessionRef,
        providerInvoiceRef: 'b6-basic-invoice-' + suffix,
        providerPaymentRef: 'b6-basic-payment-' + suffix,
        providerSubscriptionRef: 'b6-subscription-' + suffix,
        amountMinor: checkoutBasic.amountMinor,
        currency: checkoutBasic.currency,
        periodStart: firstPeriodStart.toISOString(),
        periodEnd: firstPeriodEnd.toISOString(),
      },
    };
    const basicPaid = await sendBillingWebhook(basicPaidEvent);
    assert.equal(basicPaid.idempotent, false);
    const basicReplay = await sendBillingWebhook(basicPaidEvent);
    assert.equal(basicReplay.idempotent, true);

    let currentProduct = await api(
      '/product-entitlements/tenant/current',
      { token: ownerAToken, expect: 200 },
    );
    assert.equal(
      currentProduct.planVersion.productPlan.code,
      BASIC_CODE,
    );

    const upgrade = await api('/saas-billing/change-plan', {
      method: 'POST',
      token: ownerAToken,
      body: {
        requestId: randomUUID(),
        priceCode: PRO_PRICE,
        transitionKind: 'UPGRADE',
        reason: 'B6 upgrade certification',
      },
      expect: 201,
    });
    assert.equal(
      upgrade.proration.policy,
      'IMMEDIATE_REMAINING_PERIOD_DELTA',
    );
    assert.ok(upgrade.checkout.amountMinor > 0);

    const proPaidEvent = {
      eventId: 'b6-pro-paid-' + randomUUID(),
      eventType: 'invoice.paid',
      occurredAt: new Date().toISOString(),
      data: {
        providerSessionRef: upgrade.checkout.providerSessionRef,
        providerInvoiceRef: 'b6-pro-invoice-' + suffix,
        providerPaymentRef: 'b6-pro-payment-' + suffix,
        providerSubscriptionRef: 'b6-subscription-' + suffix,
        amountMinor: upgrade.checkout.amountMinor,
        currency: upgrade.checkout.currency,
        periodStart: firstPeriodStart.toISOString(),
        periodEnd: firstPeriodEnd.toISOString(),
      },
    };
    await sendBillingWebhook(proPaidEvent);
    currentProduct = await api('/product-entitlements/tenant/current', {
      token: ownerAToken,
      expect: 200,
    });
    assert.equal(currentProduct.planVersion.productPlan.code, PRO_CODE);
    let features = await api('/product-entitlements/tenant/features', {
      token: ownerAToken,
      expect: 200,
    });
    assert.equal(feature(features, 'content.iron_managed').value, true);

    const downgrade = await api('/saas-billing/change-plan', {
      method: 'POST',
      token: ownerAToken,
      body: {
        requestId: randomUUID(),
        priceCode: BASIC_PRICE,
        transitionKind: 'DOWNGRADE',
        reason: 'B6 downgrade certification',
      },
      expect: 201,
    });
    assert.equal(
      downgrade.proration.policy,
      'NO_IMMEDIATE_REFUND_EFFECTIVE_NEXT_PERIOD',
    );

    const scheduledFor = new Date(downgrade.scheduledFor);
    await api('/saas-billing/admin/recurrence/run', {
      method: 'POST',
      token: adminToken,
      body: {
        asOf: new Date(scheduledFor.getTime() + 1000).toISOString(),
      },
      expect: 201,
    });

    const billingState = await api('/saas-billing/current', {
      token: ownerAToken,
      expect: 200,
    });
    const recurringInvoice = billingState.invoices.find(
      (invoice) =>
        invoice.status === 'OPEN' &&
        invoice.amountDueMinor === 10000,
    );
    assert.ok(recurringInvoice, JSON.stringify(billingState.invoices));

    await sendBillingWebhook({
      eventId: 'b6-payment-failed-' + randomUUID(),
      eventType: 'invoice.payment_failed',
      occurredAt: new Date(recurringInvoice.dueAt).toISOString(),
      data: {
        invoiceId: recurringInvoice.id,
        providerPaymentRef: 'b6-failed-payment-' + suffix,
        amountMinor: recurringInvoice.amountDueMinor,
        currency: recurringInvoice.currency,
      },
    });

    const dunningAt = new Date(
      new Date(recurringInvoice.dueAt).getTime() +
        2 * 24 * 60 * 60 * 1000,
    );
    await api('/saas-billing/admin/dunning/run', {
      method: 'POST',
      token: adminToken,
      body: { asOf: dunningAt.toISOString() },
      expect: 201,
    });

    const suspendedAgreement = await api('/saas-billing/current', {
      token: ownerAToken,
      expect: 200,
    });
    assert.equal(suspendedAgreement.agreement.status, 'SUSPENDED');
    features = await api('/product-entitlements/tenant/features', {
      token: ownerAToken,
      expect: 200,
    });
    assert.equal(feature(features, 'equipment.inventory').value, false);
    assert.equal(
      feature(features, 'equipment.inventory').source,
      'FAIL_CLOSED_DEFAULT',
    );

    await sendBillingWebhook({
      eventId: 'b6-late-paid-' + randomUUID(),
      eventType: 'invoice.paid',
      occurredAt: new Date(
        dunningAt.getTime() + 60 * 1000,
      ).toISOString(),
      data: {
        invoiceId: recurringInvoice.id,
        providerPaymentRef: 'b6-late-payment-' + suffix,
        amountMinor: recurringInvoice.amountDueMinor,
        currency: recurringInvoice.currency,
      },
    });

    const reactivatedAgreement = await api('/saas-billing/current', {
      token: ownerAToken,
      expect: 200,
    });
    assert.equal(reactivatedAgreement.agreement.status, 'ACTIVE');
    currentProduct = await api('/product-entitlements/tenant/current', {
      token: ownerAToken,
      expect: 200,
    });
    assert.equal(currentProduct.planVersion.productPlan.code, BASIC_CODE);
    features = await api('/product-entitlements/tenant/features', {
      token: ownerAToken,
      expect: 200,
    });
    assert.equal(feature(features, 'equipment.inventory').value, true);
    assert.equal(feature(features, 'content.iron_managed').value, false);

    const rotated = await api('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: ownerARefresh },
      expect: 200,
    });
    const replay = await raw('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: ownerARefresh },
    });
    assert.equal(replay.status, 401);
    assert.equal(
      (await raw('/auth/me', { token: rotated.access_token })).status,
      401,
    );

    const reloginBeforeReset = await login(ownerAEmail, ownerPassword);
    ownerAToken = reloginBeforeReset.access_token;
    ownerARefresh = reloginBeforeReset.refresh_token;

    const knownRecovery = await api('/auth/password/reset/request', {
      method: 'POST',
      body: { email: ownerAEmail },
      expect: 202,
    });
    const unknownRecovery = await api('/auth/password/reset/request', {
      method: 'POST',
      body: { email: 'absent-' + suffix + '@iron.invalid' },
      expect: 202,
    });
    assert.deepEqual(knownRecovery, unknownRecovery);

    const ownerUser = await prisma.user.findUniqueOrThrow({
      where: { email: ownerAEmail },
    });
    const resetRecord = await prisma.authActionToken.findFirstOrThrow({
      where: {
        userId: ownerUser.id,
        kind: 'PASSWORD_RESET',
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    const resetToken = decryptActionSecret(
      {
        get(name) {
          return name === 'AUTH_ACTION_TOKEN_ENCRYPTION_KEY'
            ? ACTION_KEY
            : undefined;
        },
      },
      resetRecord.deliveryCiphertext,
    );

    await api('/auth/password/reset/confirm', {
      method: 'POST',
      body: {
        token: resetToken,
        newPassword: ownerPasswordAfterReset,
      },
      expect: 200,
    });
    assert.equal(
      (
        await raw('/auth/password/reset/confirm', {
          method: 'POST',
          body: {
            token: resetToken,
            newPassword: ownerPasswordAfterReset,
          },
        })
      ).status,
      401,
    );
    assert.equal(
      (await raw('/auth/me', { token: ownerAToken })).status,
      401,
    );
    assert.equal(
      (
        await raw('/auth/login', {
          method: 'POST',
          body: {
            email: ownerAEmail,
            password: ownerPassword,
          },
        })
      ).status,
      401,
    );

    let secureLogin = await login(
      ownerAEmail,
      ownerPasswordAfterReset,
    );
    ownerAToken = secureLogin.access_token;

    const mfaSetup = await api('/auth/mfa/setup', {
      method: 'POST',
      token: ownerAToken,
      body: { currentPassword: ownerPasswordAfterReset },
      expect: 200,
    });
    const mfaConfirmed = await api('/auth/mfa/confirm', {
      method: 'POST',
      token: ownerAToken,
      body: { code: totpCode(mfaSetup.secret) },
      expect: 200,
    });
    assert.equal(mfaConfirmed.enabled, true);
    assert.equal(mfaConfirmed.recoveryCodes.length, 8);

    const mfaRequired = await login(
      ownerAEmail,
      ownerPasswordAfterReset,
    );
    assert.equal(mfaRequired.requires_mfa, true);
    assert.equal(mfaRequired.access_token, undefined);
    assert.equal(
      (
        await raw('/auth/login', {
          method: 'POST',
          body: {
            email: ownerAEmail,
            password: ownerPasswordAfterReset,
            mfaCode: '000000',
          },
        })
      ).status,
      401,
    );
    secureLogin = await login(
      ownerAEmail,
      ownerPasswordAfterReset,
      { mfaCode: totpCode(mfaSetup.secret) },
    );
    ownerAToken = secureLogin.access_token;
    await api('/auth/mfa/disable', {
      method: 'POST',
      token: ownerAToken,
      body: {
        currentPassword: ownerPasswordAfterReset,
        recoveryCode: mfaConfirmed.recoveryCodes[0],
      },
      expect: 200,
    });

    secureLogin = await login(
      ownerAEmail,
      ownerPasswordAfterReset,
    );
    ownerAToken = secureLogin.access_token;
    ownerARefresh = secureLogin.refresh_token;

    const sessions = await api('/auth/sessions', {
      token: ownerAToken,
      expect: 200,
    });
    assert.ok(sessions.some((session) => session.current === true));

    let rateLimited = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = await raw('/auth/login', {
        method: 'POST',
        body: {
          email: managerEmail,
          password: 'Wrong#Password2026',
        },
      });
      if (result.status === 429) {
        rateLimited = true;
        break;
      }
      assert.equal(result.status, 401);
    }
    assert.equal(rateLimited, true);

    const burst = await Promise.all(
      Array.from({ length: 25 }, () =>
        raw('/health/live'),
      ),
    );
    assert.equal(
      burst.every((result) => result.status === 200),
      true,
    );
    const scopedBurst = await Promise.all(
      Array.from({ length: 10 }, () =>
        raw('/students', { token: ownerAToken }),
      ),
    );
    assert.equal(
      scopedBurst.every((result) => result.status === 200),
      true,
    );

    const badProvider = await raw(
      '/saas-billing/webhooks/NOT_CONFIGURED',
      {
        method: 'POST',
        headers: {
          'x-saas-billing-signature': 'sha256=' + '0'.repeat(64),
        },
        body: {
          eventId: 'b6-bad-provider',
          eventType: 'checkout.completed',
          occurredAt: new Date().toISOString(),
          data: { providerSessionRef: 'none' },
        },
      },
    );
    assert.ok([400, 503].includes(badProvider.status));

    await api('/auth/logout', {
      method: 'POST',
      body: { refreshToken: ownerARefresh },
      expect: 200,
    });
    assert.equal(
      (await raw('/auth/me', { token: ownerAToken })).status,
      401,
    );
    const finalRelogin = await login(
      ownerAEmail,
      ownerPasswordAfterReset,
    );
    assert.equal(typeof finalRelogin.access_token, 'string');

    const securityAuditCount = await prisma.auditLog.count({
      where: {
        gymId: trialA.gymId,
        action: {
          in: [
            'AUTH_LOGIN_SUCCESS',
            'STUDENT_CREATED',
            'ASSESSMENT_CREATED',
            'WORKOUT_STATUS_UPDATED',
            'ACCESS_DECISION_RECORDED',
            'FINANCIAL_CHARGE_PAID',
            'SAAS_INVOICE_PAID',
            'SAAS_DUNNING_SUSPENDED',
          ],
        },
      },
    });
    assert.ok(securityAuditCount >= 7);

    log('integrated journey green', {
      gymA: trialA.gymId,
      gymB: trialB.gymId,
      durationMs: Date.now() - startedAt,
      auditSignals: securityAuditCount,
    });
  } finally {
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => server.once('exit', resolve)),
        delay(3000),
      ]);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      event: 'b6_e2e_failure',
      message: error instanceof Error ? error.message : String(error),
      serverOutput: serverOutput.slice(-25),
    }) + '\n',
  );
  process.exitCode = 1;
});
