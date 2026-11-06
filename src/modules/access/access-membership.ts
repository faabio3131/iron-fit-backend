import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export async function accessMembershipDenial(db: PrismaService | Prisma.TransactionClient, gymId: string, studentId: string, now = new Date()): Promise<string | null> {
  const gym = await db.gym.findUnique({ where: { id: gymId }, select: { active: true } });
  if (!gym?.active) return 'Academia inativa';
  const membership = await db.subscription.findFirst({
    where: { gymId, studentId, status: { in: ['ACTIVE', 'TRIALING'] },
      OR: [{ nextBillingAt: null }, { nextBillingAt: { gt: now } }] },
    select: { id: true },
  });
  if (!membership) return 'Plano do aluno nao elegivel';
  const overdue = await db.charge.findFirst({
    where: { gymId, studentId, status: { in: ['PENDING', 'PROCESSING'] }, dueDate: { lt: now } },
    select: { id: true },
  });
  return overdue ? 'Mensalidade vencida: procure a recepcao' : null;
}
