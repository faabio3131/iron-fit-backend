import { fixtureCnpj } from './fixture-cnpj.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { login, request } from '../scripts/b6-e2e-lib.mjs';

const db = new PrismaClient();
test('pilot reception: official trial, owner opt-in, atomic enrollment, four payment forms, own closing and tenant barriers', async () => {
  assert.equal(process.env.CI, 'true');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/iron_ci');
  const id = randomUUID().slice(0, 8), password = process.env.B6_OWNER_PASSWORD;
  async function tenant(label) {
    const email = `desk-${label}-${id}@example.com`;
    const { payload } = await request('/commercial/trial/start', { method: 'POST', expected: 201, body: { requestId: randomUUID(), email, password, name: `Desk ${label}`, cnpj: fixtureCnpj(), gymName: `Desk ${label} ${id}`, timezone: 'America/Sao_Paulo' } });
    return { gymId: payload.gymId, session: await login(email, password) };
  }
  try {
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(process.env.IRON_RUNTIME_ENV, 'HOMOLOG');
    assert.ok(['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
    await db.authRateLimitBucket.deleteMany({ where: { scope: { in: ['AUTH_SIGNUP_IP', 'AUTH_LOGIN_REQUEST_IP', 'AUTH_LOGIN_FAILURE_IP'] } } });
    const a = await tenant('a'), b = await tenant('b');
    const owner = a.session.access_token;
    const receptionEmail = `desk-reception-${id}@example.com`;
    const trainerEmail = `desk-trainer-${id}@example.com`;
    for (const [roleName, email] of [['RECEPTION', receptionEmail], ['TRAINER', trainerEmail]]) {
      await request('/users', { token: owner, method: 'POST', expected: 201, body: { email, password, name: roleName, roleName } });
    }
    const reception = await login(receptionEmail, password), trainer = await login(trainerEmail, password);
    const token = reception.access_token;
    await request('/reception/admin/settings', { token: owner, expected: 403 });
    await request('/auth/step-up', { token: owner, method: 'POST', expected: 200, body: { currentPassword: password } });
    const account = (await request('/financial/accounts', { token: owner, method: 'POST', expected: 201, body: { name: 'Caixa piloto', type: 'CASH' } })).payload;
    const plan = (await request('/reception/admin/plans', { token: owner, method: 'POST', expected: 201, body: { name: 'Mensal piloto', amount: 15990, intervalMonths: 1 } })).payload;
    const quarterly = (await request('/reception/admin/plans', { token: owner, method: 'POST', expected: 201, body: { name: 'Trimestral piloto', amount: 39900, intervalMonths: 3 } })).payload;
    await request('/reception/catalog', { token: trainer.access_token, expected: 403 });
    await request('/reception/admin/policy', { token, method: 'POST', expected: 403, body: { accountId: account.id, enabled: true } });
    await request('/financial/accounts', { token, expected: 403 });
    const students = [];
    for (let index = 0; index < 4; index++) students.push((await request('/students', { token, method: 'POST', expected: 201, body: { name: `Desk Student ${index}`, email: `desk-student-${index}-${id}@example.com`, ...(index === 0 ? { cpf: '529.982.247-25', birthDate: '2000-01-31', photoUrl: 'https://example.invalid/avatar.png' } : {}) } })).payload);
    assert.equal((await request(`/students/${students[0].id}`, { token: trainer.access_token, expected: 200 })).payload.cpf, null);
    assert.equal((await request(`/students/${students[0].id}`, { token, expected: 200 })).payload.cpf, '52998224725');
    const otherStudent = (await request('/students', { token: b.session.access_token, method: 'POST', expected: 201, body: { name: 'Other tenant student', email: `desk-other-${id}@example.com` } })).payload;
    const dueDate = new Date().toISOString().slice(0, 10);
    const first = { requestId: randomUUID(), studentId: students[0].id, planId: plan.id, dueDate, paymentMethod: 'CASH', receivedConfirmed: true };
    await request('/reception/enroll', { token, method: 'POST', expected: 403, body: first });
    assert.equal(await db.subscription.count({ where: { gymId: a.gymId } }), 0);
    await request('/reception/admin/policy', { token: owner, method: 'POST', expected: 201, body: { accountId: account.id, enabled: true } });
    await request('/reception/enroll', { token, method: 'POST', expected: 404, body: { ...first, requestId: randomUUID(), studentId: otherStudent.id } });
    await request('/reception/enroll', { token, method: 'POST', expected: 400, body: { ...first, amount: 1 } });
    await request('/reception/enroll', { token, method: 'POST', expected: 400, body: { ...first, receivedConfirmed: false } });
    for (const [index, method] of ['CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD'].entries()) {
      const body = index === 0 ? first : { ...first, requestId: randomUUID(), studentId: students[index].id, planId: index === 1 ? quarterly.id : plan.id, paymentMethod: method };
      const sales = await Promise.all(Array.from({ length: index === 0 ? 2 : 1 }, () => request('/reception/enroll', { token, method: 'POST', expected: 201, body })));
      const sale = sales[0].payload;
      for (const concurrent of sales) assert.equal(concurrent.payload.id, sale.id);
      assert.equal(sale.charge.status, 'PAID'); assert.equal(sale.subscription.status, 'ACTIVE');
      assert.equal(sale.charge.amount, index === 1 ? 39900 : 15990);
      const replay = (await request('/reception/enroll', { token, method: 'POST', expected: 201, body })).payload;
      assert.equal(replay.id, sale.id); assert.equal(replay.idempotent, true);
      assert.equal(await db.financialTransaction.count({ where: { gymId: a.gymId, sourceId: sale.charge.id } }), 1);
      assert.ok(await db.fiscalHandoff.findUnique({ where: { chargeId: sale.charge.id } }));
    }
    const renew = (await request('/financial/charges', { token: owner, method: 'POST', expected: 201, body: { studentId: students[0].id, amount: 15990, dueDate } })).payload;
    const receive = { requestId: randomUUID(), paymentMethod: 'PIX', receivedConfirmed: true };
    const payment = (await request(`/reception/charges/${renew.id}/receive`, { token, method: 'POST', expected: 201, body: receive })).payload;
    assert.equal(payment.charge.status, 'PAID');
    assert.equal((await request(`/reception/charges/${renew.id}/receive`, { token, method: 'POST', expected: 201, body: receive })).payload.id, payment.id);
    await request(`/reception/charges/${renew.id}/receive`, { token: b.session.access_token, method: 'POST', expected: 403, body: { ...receive, requestId: randomUUID() } });
    // A gateway-backed charge cannot be converted into a manual success.
    const gateway = await db.charge.create({ data: { gymId: a.gymId, studentId: students[0].id, amount: 100, gatewayRequestId: randomUUID() } });
    await request(`/reception/charges/${gateway.id}/receive`, { token, method: 'POST', expected: 409, body: { ...receive, requestId: randomUUID() } });
    assert.equal((await db.charge.findUnique({ where: { id: gateway.id } })).status, 'PENDING');
    const from = new Date(Date.now() - 86400000).toISOString(), to = new Date(Date.now() + 86400000).toISOString();
    const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const closing = (await request(`/reception/closing?${query}`, { token, expected: 200 })).payload;
    assert.equal(closing.count, 5); assert.equal(closing.totalMinor, 103860);
    assert.equal(closing.scope, 'CURRENT_OPERATOR');
    assert.equal((await request(`/reception/closing?${query}`, { token: owner, expected: 200 })).payload.count, 0);
    assert.equal(await db.deskReceipt.count({ where: { gymId: b.gymId } }), 0);
    assert.equal((await db.student.findUnique({ where: { id: students[0].id } })).cpf, '52998224725');
    await request('/reception/admin/policy', { token: owner, method: 'POST', expected: 201, body: { accountId: account.id, enabled: false } });
    await request('/reception/enroll', { token, method: 'POST', expected: 403, body: { ...first, requestId: randomUUID() } });
  } finally { await db.$disconnect(); }
}, { timeout: 90000 });
