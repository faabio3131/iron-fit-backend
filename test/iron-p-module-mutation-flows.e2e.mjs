import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { login, request } from '../scripts/b6-e2e-lib.mjs';

// The test runs ONLY against the disposable Nest + real PostgreSQL CI environment.
test('P module mutations: communication consent, automation roles, privacy DSR and tenant isolation', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.IRON_RUNTIME_ENV, 'HOMOLOG');
  const ownerPassword = process.env.B6_OWNER_PASSWORD;
  const staffPassword = process.env.B6_STAFF_PASSWORD;
  const studentPassword = process.env.B6_STUDENT_PASSWORD;
  assert.ok(ownerPassword && staffPassword && studentPassword);
  const suffix = randomUUID().slice(0, 8);
  const gymSignup = async name => {
    const email = `p-module-${name}-${suffix}@example.com`;
    const trial = (await request('/commercial/trial/start', { method: 'POST', expected: 201,
      body: { requestId: randomUUID(), email, password: ownerPassword,
        name: 'P Module Owner', gymName: `P Module ${name} ${suffix}`,
        timezone: 'America/Sao_Paulo' },
    })).payload;
    return { trial, session: await login(email, ownerPassword) };
  };
  const a = await gymSignup('a'), b = await gymSignup('b');
  const employee = async (roleName) => {
    const email = `p-${roleName.toLowerCase()}-${suffix}@example.com`;
    await request('/users', { token: a.session.access_token, method: 'POST', expected: 201,
      body: { email, password: staffPassword, name: `P ${roleName}`, roleName } });
    return (await login(email, staffPassword)).access_token;
  };
  const reception = await employee('RECEPTION'), manager = await employee('MANAGER');
  const studentEmail = `p-student-${suffix}@example.com`;
  const student = (await request('/students', { token: a.session.access_token,
    method: 'POST', expected: 201, body: {
      name: 'P Module Student', email: studentEmail, goal: 'CONDICIONAMENTO',
      level: 'INICIANTE', consentComm: false,
    } })).payload;

  const template = (await request('/communication/templates', {
    token: reception, method: 'POST', expected: 201,
    body: { name: `P Template ${suffix}`, channel: 'IN_APP',
      title: 'Comunicacao interna', body: 'Mensagem institucional de teste' },
  })).payload;
  assert.ok(template.id);
  assert.ok((await request('/communication/templates', {
    token: reception, expected: 200,
  })).payload.some(row => row.id === template.id));
  assert.equal((await request('/communication/templates', {
    token: b.session.access_token, expected: 200,
  })).payload.some(row => row.id === template.id), false);

  // No provider call or actual outbound communication: intake MUST block
  // when the student has not consented.
  const queueBody = {
    studentId: student.id, templateId: template.id,
    channel: 'IN_APP', body: 'Somente fila interna consentida',
  };
  await request('/communication/messages', {
    token: reception, method: 'POST', expected: 400, body: queueBody,
  });
  await request('/student-onboarding/accept-invite', {
    method: 'POST', expected: 201,
    body: { token: student.onboarding.token, password: studentPassword },
  });
  const mobile = await login(studentEmail, studentPassword);
  const updated = (await request('/privacy/consents', {
    token: mobile.access_token, method: 'PATCH', expected: 200,
    body: { consentComm: true },
  })).payload;
  assert.equal(updated.consentComm, true);
  const queued = (await request('/communication/messages', {
    token: reception, method: 'POST', expected: 201, body: queueBody,
  })).payload;
  assert.equal(queued.status, 'QUEUED');
  assert.ok((await request('/communication/messages', {
    token: reception, expected: 200,
  })).payload.some(row => row.id === queued.id));
  assert.equal((await request('/communication/messages', {
    token: b.session.access_token, expected: 200,
  })).payload.some(row => row.id === queued.id), false);
  await request('/communication/messages', {
    token: b.session.access_token, method: 'POST',
    expected: 404, body: { ...queueBody, templateId: undefined },
  });

  await request('/communication/automations', {
    token: reception, method: 'POST', expected: 403,
    body: { name: 'Forbidden automation', triggerEvent: 'ENROLLMENT_CREATED', actions: {} },
  });
  const automation = (await request('/communication/automations', {
    token: manager, method: 'POST', expected: 201,
    body: { name: `P Automation ${suffix}`, triggerEvent: 'ENROLLMENT_CREATED',
      conditions: {}, actions: {} },
  })).payload;
  assert.ok(automation.id);
  assert.ok((await request('/communication/automations', {
    token: manager, expected: 200,
  })).payload.some(row => row.id === automation.id));

  const dsr = (await request('/privacy/dsr', {
    token: mobile.access_token, method: 'POST', expected: 201,
    body: { type: 'ACCESS' },
  })).payload;
  assert.equal(dsr.status, 'OPEN');
  await request('/privacy/dsr', {
    token: mobile.access_token, method: 'POST', expected: 409,
    body: { type: 'ACCESS' },
  });
  assert.ok((await request('/privacy/dsr', {
    token: mobile.access_token, expected: 200,
  })).payload.some(row => row.id === dsr.id));
  assert.equal((await request('/privacy/dsr', {
    token: b.session.access_token, expected: 200,
  })).payload.some(row => row.id === dsr.id), false);
  await request('/privacy/operations/dsr', {
    token: a.session.access_token, expected: 403,
  });
  const cancelled = (await request('/privacy/dsr/cancel', {
    token: mobile.access_token, method: 'POST', expected: 201,
    body: { requestId: dsr.id },
  })).payload;
  assert.equal(cancelled.status, 'CANCELLED');
  await request('/privacy/dsr/cancel', {
    token: mobile.access_token, method: 'POST', expected: 409,
    body: { requestId: dsr.id },
  });

  console.log(JSON.stringify({
    event: 'iron_p_module_mutations_consent_governance_cert',
    persistedTemplate: true, recipientConsentEnforced: true,
    queuedOnlyNoProvider: true, crossTenantMessagesDenied: true,
    automationRbac: true, privacyDsrCancelAndReplay: true,
    fmSuperAdminOperationsProtected: true,
  }));
}, { timeout: 120000 });
