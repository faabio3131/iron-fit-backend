import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { FinancialService } from '../financial/financial.service';
import { DeskEnrollDto, DeskPlanDto, DeskPolicyDto, DeskReceiveDto } from './dto/reception.dto';

export function nextMembershipBilling(due: Date, months: number) {
  const next = new Date(due);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next;
}

@Injectable()
export class ReceptionService {
  constructor(private readonly db: PrismaService, private readonly finance: FinancialService, private readonly audit: AuditService) {}

  private async authorize(db: Prisma.TransactionClient | PrismaService, gymId: string, actor: string, ownerOnly = false) {
    if (!gymId || !actor) throw new ForbiddenException('Academia e operador autenticados obrigatorios');
    const member = await db.userRole.findFirst({ where: {
      gymId, userId: actor, active: true, user: { active: true }, gym: { active: true },
      role: { name: { in: ownerOnly ? ['OWNER'] : ['OWNER', 'RECEPTION'] } },
    } });
    if (!member) throw new ForbiddenException('Operacao de balcao nao autorizada');
  }

  async catalog(gymId: string, actor: string) {
    await this.authorize(this.db, gymId, actor);
    const [policy, plans] = await Promise.all([
      this.db.receptionDeskPolicy.findUnique({ where: { gymId }, include: { account: { select: { gymId: true, active: true } } } }),
      this.db.membershipPlan.findMany({ where: { gymId, active: true }, orderBy: { name: 'asc' } }),
    ]);
    return { enabled: policy?.enabled === true && policy.account.gymId === gymId && policy.account.active, plans };
  }

  async settings(gymId: string, actor: string) {
    await this.authorize(this.db, gymId, actor, true);
    return {
      policy: await this.db.receptionDeskPolicy.findUnique({ where: { gymId } }),
      plans: await this.db.membershipPlan.findMany({ where: { gymId }, orderBy: { name: 'asc' } }),
    };
  }

  async configure(gymId: string, actor: string, dto: DeskPolicyDto) {
    return this.db.$transaction(async tx => {
      await this.authorize(tx, gymId, actor, true);
      const account = await tx.financialAccount.findFirst({ where: { id: dto.accountId, gymId, active: true } });
      if (!account) throw new NotFoundException('Conta da academia nao encontrada');
      const policy = await tx.receptionDeskPolicy.upsert({ where: { gymId },
        create: { gymId, accountId: account.id, enabled: dto.enabled, updatedByUserId: actor },
        update: { accountId: account.id, enabled: dto.enabled, updatedByUserId: actor },
      });
      await this.audit.record({ gymId, userId: actor, action: 'RECEPTION_DESK_POLICY_UPDATED', entity: 'ReceptionDeskPolicy', entityId: gymId, next: { accountId: account.id, enabled: dto.enabled } }, tx);
      return policy;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async createPlan(gymId: string, actor: string, dto: DeskPlanDto) {
    return this.db.$transaction(async tx => {
      await this.authorize(tx, gymId, actor, true);
      const plan = await tx.membershipPlan.create({ data: { gymId, name: dto.name.trim(), amount: dto.amount, intervalMonths: dto.intervalMonths } });
      await this.audit.record({ gymId, userId: actor, action: 'MEMBERSHIP_PLAN_CREATED', entity: 'MembershipPlan', entityId: plan.id, next: { name: plan.name, amount: plan.amount, intervalMonths: plan.intervalMonths } }, tx);
      return plan;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async setPlanActive(gymId: string, actor: string, id: string, active: boolean) {
    return this.db.$transaction(async tx => {
      await this.authorize(tx, gymId, actor, true);
      const changed = await tx.membershipPlan.updateMany({ where: { id, gymId }, data: { active } });
      if (changed.count !== 1) throw new NotFoundException('Plano nao encontrado');
      await this.audit.record({ gymId, userId: actor, action: 'MEMBERSHIP_PLAN_STATUS_UPDATED', entity: 'MembershipPlan', entityId: id, next: { active } }, tx);
      return { id, active };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async enroll(gymId: string, actor: string, dto: DeskEnrollDto) {
    if (dto.receivedConfirmed !== true || !['CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD'].includes(dto.paymentMethod)) {
      throw new BadRequestException('Confirme recebimento presencial e meio de pagamento');
    }
    const due = new Date(dto.dueDate);
    if (!Number.isFinite(due.getTime())) throw new BadRequestException('Vencimento invalido');
    const fingerprint = createHash('sha256').update(JSON.stringify({ actor, studentId: dto.studentId, planId: dto.planId, dueDate: due.toISOString(), paymentMethod: dto.paymentMethod })).digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(async tx => {
          await this.authorize(tx, gymId, actor);
          const policy = await tx.receptionDeskPolicy.findUnique({ where: { gymId } });
          if (!policy?.enabled) throw new ForbiddenException('Caixa de balcao desabilitado pelo proprietario');
          const account = await tx.financialAccount.findFirst({ where: { id: policy.accountId, gymId, active: true } });
          if (!account) throw new ForbiddenException('Conta de recebimento indisponivel');
          const previous = await tx.deskReceipt.findUnique({ where: { gymId_requestId: { gymId, requestId: dto.requestId } }, include: { charge: true, subscription: true } });
          if (previous) {
            if (previous.fingerprint !== fingerprint) throw new ConflictException('Chave reutilizada com outros dados');
            return { id: previous.id, charge: previous.charge, subscription: previous.subscription, idempotent: true };
          }
          const student = await tx.student.findFirst({ where: { id: dto.studentId, gymId, status: 'ACTIVE' } });
          const plan = await tx.membershipPlan.findFirst({ where: { id: dto.planId, gymId, active: true } });
          if (!student || !plan) throw new NotFoundException('Aluno ou plano nao encontrado');
          const existing = await tx.subscription.findFirst({ where: { gymId, studentId: student.id, status: { in: ['ACTIVE', 'TRIALING'] } } });
          if (existing) throw new ConflictException('Aluno ja possui plano ativo; solicite revisao ao proprietario');
          const nextBillingAt = nextMembershipBilling(due, plan.intervalMonths);
          if (nextBillingAt <= new Date() || due.getTime() > Date.now() + 90 * 86400000) throw new BadRequestException('Vencimento fora do periodo permitido');
          const subscription = await tx.subscription.create({ data: { gymId, studentId: student.id, planName: plan.name, amount: plan.amount, nextBillingAt } });
          const charge = await tx.charge.create({ data: { gymId, studentId: student.id, subscriptionId: subscription.id, amount: plan.amount, dueDate: due, paymentMethod: dto.paymentMethod } });
          const settled = await this.finance.payCharge(charge.id, { accountId: account.id, paymentMethod: dto.paymentMethod }, gymId, actor, undefined, tx);
          const receipt = await tx.deskReceipt.create({ data: { gymId, requestId: dto.requestId, fingerprint, actorUserId: actor, studentId: student.id, planId: plan.id, subscriptionId: subscription.id, chargeId: charge.id } });
          await this.audit.record({ gymId, userId: actor, action: 'RECEPTION_ENROLLMENT_PAID', entity: 'DeskReceipt', entityId: receipt.id, next: { studentId: student.id, subscriptionId: subscription.id, chargeId: charge.id, transactionId: settled.transaction.id } }, tx);
          return { id: receipt.id, charge: settled.charge, subscription, idempotent: false };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2034', 'P2002'].includes(error.code) || attempt === 2) throw error;
      }
    }
    throw new ConflictException('Conflito ao registrar matricula');
  }

  async studentCharges(gymId: string, actor: string, studentId: string) {
    await this.authorize(this.db, gymId, actor);
    const student = await this.db.student.findFirst({ where: { id: studentId, gymId } });
    if (!student) throw new NotFoundException('Aluno nao encontrado');
    return this.db.charge.findMany({ where: { gymId, studentId, status: 'PENDING' },
      select: { id: true, amount: true, dueDate: true, status: true, gatewayRequestId: true }, orderBy: { dueDate: 'asc' }, take: 100 });
  }

  async receive(gymId: string, actor: string, chargeId: string, dto: DeskReceiveDto) {
    if (dto.receivedConfirmed !== true || !['CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD'].includes(dto.paymentMethod)) {
      throw new BadRequestException('Confirme recebimento presencial e meio de pagamento');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({ actor, chargeId, paymentMethod: dto.paymentMethod })).digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(async tx => {
          await this.authorize(tx, gymId, actor);
          const policy = await tx.receptionDeskPolicy.findUnique({ where: { gymId } });
          if (!policy?.enabled) throw new ForbiddenException('Caixa de balcao desabilitado pelo proprietario');
          const previous = await tx.deskReceipt.findUnique({ where: { gymId_requestId: { gymId, requestId: dto.requestId } }, include: { charge: true } });
          if (previous) {
            if (previous.fingerprint !== fingerprint) throw new ConflictException('Chave reutilizada com outros dados');
            return { id: previous.id, charge: previous.charge, idempotent: true };
          }
          const charge = await tx.charge.findFirst({ where: { id: chargeId, gymId } });
          if (!charge) throw new NotFoundException('Cobranca nao encontrada');
          if (charge.status !== 'PENDING') throw new ConflictException('Cobranca ja recebida ou indisponivel');
          // Canonical settlement also rejects gateway-backed charges. A human
          // checkbox never substitutes provider verification.
          const settled = await this.finance.payCharge(charge.id, { accountId: policy.accountId, paymentMethod: dto.paymentMethod }, gymId, actor, undefined, tx);
          const receipt = await tx.deskReceipt.create({ data: { gymId, requestId: dto.requestId, fingerprint, actorUserId: actor, studentId: charge.studentId, subscriptionId: charge.subscriptionId, chargeId: charge.id } });
          await this.audit.record({ gymId, userId: actor, action: 'RECEPTION_PAYMENT_RECEIVED', entity: 'DeskReceipt', entityId: receipt.id, next: { chargeId, transactionId: settled.transaction.id } }, tx);
          return { id: receipt.id, charge: settled.charge, idempotent: false };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2034', 'P2002'].includes(error.code) || attempt === 2) throw error;
      }
    }
    throw new ConflictException('Conflito no recebimento');
  }

  async closing(gymId: string, actor: string, fromValue: string, toValue: string) {
    await this.authorize(this.db, gymId, actor);
    const from = new Date(fromValue), to = new Date(toValue);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to.getTime() - from.getTime() > 32 * 86400000) {
      throw new BadRequestException('Periodo invalido; maximo 32 dias');
    }
    const receipts = await this.db.deskReceipt.findMany({ where: { gymId, actorUserId: actor, charge: { paidAt: { gte: from, lt: to } } },
      include: { charge: { select: { id: true, amount: true, status: true, paymentMethod: true, paidAt: true } }, student: { select: { id: true, user: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' } });
    const byMethod: Record<string, number> = {};
    for (const receipt of receipts) if (receipt.charge.status === 'PAID') {
      const method = receipt.charge.paymentMethod ?? 'OTHER'; byMethod[method] = (byMethod[method] ?? 0) + receipt.charge.amount;
    }
    return { from, to, scope: 'CURRENT_OPERATOR', count: receipts.length, totalMinor: Object.values(byMethod).reduce((sum, amount) => sum + amount, 0), byMethod,
      receipts: receipts.map(row => ({ id: row.id, studentName: row.student.user?.name ?? 'Aluno', charge: row.charge })) };
  }
}
