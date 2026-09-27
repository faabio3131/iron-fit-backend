import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const id = '11111111-1111-4111-8111-000000000011';
const reference = 'isv_' + 'D'.repeat(43);

try {
  await prisma.integrationConnection.upsert({
    where: { id },
    create: {
      id,
      scope: 'GLOBAL',
      gymId: null,
      providerCode: 'c11_dr_canary',
      environment: 'HOMOLOG',
      authModel: 'API_KEY',
      status: 'ACTIVE',
      capabilities: ['dr.boundary'],
      publicConfiguration: { purpose: 'C11 backup restore boundary drill' },
      secretReference: reference,
      secretVersion: 1,
      secretRotatedAt: new Date('2026-09-27T00:00:00.000Z'),
    },
    update: {
      status: 'ACTIVE',
      secretReference: reference,
      secretVersion: 1,
      secretRotatedAt: new Date('2026-09-27T00:00:00.000Z'),
      secretRevokedAt: null,
    },
  });
  console.log('C11_DR_SEED_PASS connection=' + id);
} finally {
  await prisma.$disconnect();
}
