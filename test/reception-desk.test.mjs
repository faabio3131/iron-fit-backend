import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { normalizeCpf } = require('../dist/src/common/security/cpf.js');
const { nextMembershipBilling, ReceptionService } = require('../dist/src/modules/reception/reception.service.js');
test('CPF validates check digits, strips formatting and keeps absent values nullable', () => {
  assert.equal(normalizeCpf('529.982.247-25'), '52998224725');
  assert.equal(normalizeCpf(undefined), null);
  assert.equal(normalizeCpf(null), null);
  for (const value of ['11111111111', '52998224726', 'abcd', '123']) assert.throws(() => normalizeCpf(value), /CPF/);
});
test('membership billing clamps month ends without skipping February or crossing quarter boundary', () => {
  assert.equal(nextMembershipBilling(new Date('2027-01-31T00:00:00Z'), 1).toISOString(), '2027-02-28T00:00:00.000Z');
  assert.equal(nextMembershipBilling(new Date('2028-01-31T00:00:00Z'), 1).toISOString(), '2028-02-29T00:00:00.000Z');
  assert.equal(nextMembershipBilling(new Date('2026-11-30T00:00:00Z'), 3).toISOString(), '2027-02-28T00:00:00.000Z');
});
test('desk requires active current OWNER/RECEPTION membership and refuses global/employee privilege widening', async () => {
  const calls = [];
  const db = { userRole: { findFirst: async input => { calls.push(input); return null; } } };
  const service = new ReceptionService(db, {}, {});
  await assert.rejects(service.catalog('gym-a', 'actor'), /autorizada/);
  assert.equal(calls[0].where.gymId, 'gym-a');
  assert.deepEqual(calls[0].where.role.name.in, ['OWNER', 'RECEPTION']);
  await assert.rejects(service.catalog(undefined, 'actor'), /autenticados/);
});
test('unconfirmed receipts fail before opening a transaction or calling finance', async () => {
  const service = new ReceptionService({}, {}, {});
  await assert.rejects(service.enroll('gym-a', 'actor', { receivedConfirmed: false, paymentMethod: 'CASH' }), /recebimento/);
  await assert.rejects(service.receive('gym-a', 'actor', 'charge', { receivedConfirmed: true, paymentMethod: 'GATEWAY_SUCCESS' }), /recebimento/);
});

test('CPF disclosure requires an explicit authorized projection and is hidden by default', async () => {
  const { StudentsService } = require('../dist/src/modules/students/students.service.js');
  const row = { id: 'student', cpf: '52998224725', user: { name: 'Ana', email: 'ana@example.invalid' } };
  const db = { student: { findMany: async () => [row], findFirst: async () => row } };
  const students = new StudentsService(db, {}, {});
  assert.equal((await students.findAll('gym'))[0].cpf, null);
  assert.equal((await students.findOne('student', 'gym')).cpf, null);
  assert.equal((await students.findAll('gym', true))[0].cpf, row.cpf);
});


test('SERIALIZABLE reception race reconciles an already committed identical receipt',async()=>{
  const { Prisma }=require('@prisma/client');
  const {createHash}=require('node:crypto');
  const dto={
    requestId:'same-request',studentId:'student-a',planId:'plan-a',
    dueDate:'2026-11-10',paymentMethod:'CASH',receivedConfirmed:true,
  };
  const fingerprint=createHash('sha256').update(JSON.stringify({
    actor:'operator-a',studentId:dto.studentId,planId:dto.planId,
    dueDate:new Date(dto.dueDate).toISOString(),paymentMethod:dto.paymentMethod,
  })).digest('hex');
  const expected={id:'desk-1',fingerprint,charge:{id:'charge-1'},subscription:{id:'sub-1'}};
  let txCalls=0;
  const db={
    $transaction:async()=>{txCalls++;throw new Prisma.PrismaClientKnownRequestError(
      'Serialization retry',{code:'P2034',clientVersion:'6.19.3'});
    },
    deskReceipt:{findUnique:async()=>expected},
  };
  const service=new ReceptionService(db,{},{});
  const row=await service.enroll('gym-a','operator-a',dto);
  assert.equal(txCalls,1);
  assert.deepEqual(row,{id:'desk-1',charge:expected.charge,
    subscription:expected.subscription,idempotent:true});
});

test('exhausted reception serialization retries return safe 409 rather than leaked 500',async()=>{
  const { Prisma }=require('@prisma/client');
  let attempted=0;
  const db={
    $transaction:async()=>{attempted++;throw new Prisma.PrismaClientKnownRequestError(
      'Serialization retry',{code:'P2034',clientVersion:'6.19.3'});
    },
    deskReceipt:{findUnique:async()=>null},
  };
  const dto={
    requestId:'retry-capped',studentId:'student-a',planId:'plan-a',
    dueDate:'2026-11-10',paymentMethod:'CASH',receivedConfirmed:true,
  };
  const service=new ReceptionService(db,{},{});
  await assert.rejects(()=>service.enroll('gym-a','operator-a',dto),error=>
    error?.getStatus?.()===409 && /Conflito de concorrencia/.test(error.message));
  assert.equal(attempted,6);
});
