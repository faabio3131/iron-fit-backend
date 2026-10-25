import test from 'node:test';
import assert from 'node:assert/strict';

const { CommunicationService } = await import('../dist/src/modules/communication/communication.service.js');

test('C02 message list whitelists student user identity and excludes authentication secrets', async () => {
  const sensitiveUser = {
    id: 'user-a', name: 'Aluno A', email: 'a@example.test',
    phone: '11900000000', active: true, createdAt: new Date(),
    passwordHash: 'SECRET-PASSWORD-HASH', mfaSecret: 'SECRET-MFA-KEY',
    mfaEnabled: true, resetToken: 'SECRET-RESET',
  };
  let query;
  const prisma = {
    communicationMessage: {
      findMany: async args => {
        query = args;
        const selection = args.include.student.include.user.select;
        const user = Object.fromEntries(Object.entries(sensitiveUser).filter(([key]) => selection[key] === true));
        return [{ id: 'message-a', gymId: 'gym-a', student: { id: 'student-a', user } }];
      },
    },
  };
  const service = new CommunicationService(prisma);
  const messages = await service.findAllMessages('gym-a');

  assert.deepEqual(query.where, { gymId: 'gym-a' });
  assert.equal(query.include.template, true);
  assert.equal(query.include.student.include.user.select.id, true);
  assert.equal(query.include.student.include.user.select.name, true);
  assert.equal(query.include.student.include.user.select.email, true);
  assert.equal(query.include.student.include.user.select.phone, true);
  assert.equal(query.include.student.include.user.select.passwordHash, undefined);
  assert.equal(query.include.student.include.user.select.mfaSecret, undefined);
  assert.equal(query.include.student.include.user.select.mfaEnabled, undefined);
  assert.equal(messages[0].student.user.name, 'Aluno A');
  assert.equal(JSON.stringify(messages).includes('SECRET-'), false);
});

test('C02 message list does not allow selecting a foreign tenant', async () => {
  const rows = [];
  const prisma = {
    communicationMessage: {
      findMany: async args => {
        rows.push(args.where);
        return [];
      },
    },
  };
  await new CommunicationService(prisma).findAllMessages('gym-a');
  assert.deepEqual(rows, [{ gymId: 'gym-a' }]);
});
