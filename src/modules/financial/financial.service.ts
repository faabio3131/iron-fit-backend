import { publicUserSelect } from '../../common/security/public-user-select';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChargeStatus, Prisma, SubscriptionStatus, TransactionStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateFinancialAccountDto } from './dto/create-financial-account.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CreateChargeDto } from './dto/create-charge.dto';
import { PayChargeDto } from './dto/pay-charge.dto';
import { materializeIronFiscalHandoff } from './fiscal-handoff.persistence';
import { tenantChargeReadSelect } from './charge-read-model';

const MAX_SERIALIZABLE_RETRIES = 3;

@Injectable()
export class FinancialService {
  private readonly audit: AuditService;

  constructor(private prisma: PrismaService) {
    this.audit = new AuditService(prisma);
  }

  private async withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002');
        if (!retryable || attempt === MAX_SERIALIZABLE_RETRIES) {
          throw error;
        }
      }
    }
    throw new BadRequestException('Falha de concorrencia financeira');
  }

  private parseBooleanFilter(value: string | undefined, label: string) {
    if (value === undefined) return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new BadRequestException(`${label} deve ser true ou false`);
  }

  private parseDateFilter(value: string | undefined, label: string) {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Data ${label} invalida`);
    }
    return date;
  }

  private parseEnumFilter<T extends string>(
    value: string | undefined,
    allowed: readonly T[],
    label: string,
  ): T | undefined {
    if (!value) return undefined;
    if (!allowed.includes(value as T)) {
      throw new BadRequestException(`${label} invalido`);
    }
    return value as T;
  }

  async createAccount(
    dto: CreateFinancialAccountDto,
    gymId: string,
    actorUserId?: string,
  ) {
    const gym = await this.prisma.gym.findFirst({ where: { id: gymId, active: true } });
    if (!gym) {
      throw new NotFoundException('Academia nao encontrada');
    }

    const account = await this.prisma.financialAccount.create({
      data: {
        gymId,
        name: dto.name,
        type: dto.type,
        initialBalance: dto.initialBalance ?? 0,
      } as any,
    });

    await this.audit.record({
      gymId,
      userId: actorUserId ?? null,
      action: 'FINANCIAL_ACCOUNT_CREATED',
      entity: 'FinancialAccount',
      entityId: account.id,
      next: {
        name: account.name,
        type: account.type,
        initialBalance: account.initialBalance,
        active: account.active,
      },
    });

    return account;
  }

  async findAllAccounts(gymId: string) {
    return this.prisma.financialAccount.findMany({
      where: { gymId, active: true },
    });
  }

  async createSubscription(
    dto: CreateSubscriptionDto,
    gymId: string,
    actorUserId?: string,
  ) {
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, gymId },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    const subscription = await this.prisma.subscription.create({
      data: {
        gymId,
        studentId: dto.studentId,
        planName: dto.planName,
        amount: dto.amount,
        nextBillingAt: dto.nextBillingAt ? new Date(dto.nextBillingAt) : null,
      } as any,
      include: { student: { include: { user: { select: publicUserSelect } } } },
    });

    await this.audit.record({
      gymId,
      userId: actorUserId ?? null,
      action: 'FINANCIAL_SUBSCRIPTION_CREATED',
      entity: 'Subscription',
      entityId: subscription.id,
      next: {
        studentId: subscription.studentId,
        planName: subscription.planName,
        amount: subscription.amount,
        status: subscription.status,
        nextBillingAt: subscription.nextBillingAt,
      },
    });

    return subscription;
  }

  async findSubscriptions(
    gymId: string,
    filters:
      | string
      | { studentId?: string; status?: string } = {},
  ) {
    const normalized =
      typeof filters === 'string' ? { studentId: filters } : filters;
    const status = this.parseEnumFilter(
      normalized.status,
      Object.values(SubscriptionStatus),
      'Status da assinatura',
    );
    return this.prisma.subscription.findMany({
      where: {
        gymId,
        ...(normalized.studentId ? { studentId: normalized.studentId } : {}),
        ...(status ? { status } : {}),
      },
      include: { student: { include: { user: { select: publicUserSelect } } } },
      orderBy: { startedAt: 'desc' },
    });
  }

  async createCharge(
    dto: CreateChargeDto,
    gymId: string,
    actorUserId?: string,
  ) {
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, gymId },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    if (dto.subscriptionId) {
      const subscription = await this.prisma.subscription.findFirst({
        where: {
          id: dto.subscriptionId,
          gymId,
          studentId: dto.studentId,
        },
      });
      if (!subscription) {
        throw new NotFoundException('Assinatura nao encontrada');
      }
    }

    const charge = await this.prisma.charge.create({
      data: {
        gymId,
        studentId: dto.studentId,
        subscriptionId: dto.subscriptionId,
        amount: dto.amount,
        dueDate: new Date(dto.dueDate),
        paymentMethod: dto.paymentMethod,
      } as any,
    });

    await this.audit.record({
      gymId,
      userId: actorUserId ?? null,
      action: 'FINANCIAL_CHARGE_CREATED',
      entity: 'Charge',
      entityId: charge.id,
      next: {
        studentId: charge.studentId,
        subscriptionId: charge.subscriptionId,
        amount: charge.amount,
        dueDate: charge.dueDate,
        status: charge.status,
        paymentMethod: charge.paymentMethod,
      },
    });

    return charge;
  }

  async payCharge(
    chargeId: string,
    dto: PayChargeDto,
    gymId: string,
    actorUserId?: string,
  ) {
    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const charge = await tx.charge.findFirst({
            where: { id: chargeId, gymId },
            include: { student: true, subscription: true },
          });

          if (!charge) {
            throw new NotFoundException('Cobranca nao encontrada');
          }

          if (charge.student.gymId !== gymId) {
            throw new NotFoundException('Cobranca nao encontrada');
          }

          if (
            charge.subscription &&
            (charge.subscription.gymId !== gymId ||
              charge.subscription.studentId !== charge.studentId)
          ) {
            throw new BadRequestException('Inconsistencia entre cobranca e assinatura');
          }

          const account = await tx.financialAccount.findFirst({
            where: { id: dto.accountId, gymId, active: true },
          });
          if (!account) {
            throw new NotFoundException('Conta nao encontrada');
          }

          const existingTransaction = await tx.financialTransaction.findFirst({
            where: { gymId, source: 'charge', sourceId: charge.id },
          });

          if (charge.status === 'PAID') {
            if (!existingTransaction) {
              throw new BadRequestException('Cobranca paga sem transacao financeira correspondente');
            }
            const materialized = await materializeIronFiscalHandoff(tx, {
              gymId,
              chargeId: charge.id,
              transactionId: existingTransaction.id,
              studentId: charge.studentId,
              subscriptionId: charge.subscriptionId,
              amount: charge.amount,
              paidAt: charge.paidAt,
              paymentMethod: charge.paymentMethod,
            });
            return {
              charge,
              transaction: existingTransaction,
              fiscalHandoff: materialized.contract,
              fiscalHandoffRecordId: materialized.record.id,
              idempotent: true,
            };
          }

          if (existingTransaction) {
            throw new BadRequestException('Transacao financeira duplicada para cobranca nao paga');
          }

          const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
          const updated = await tx.charge.updateMany({
            where: { id: charge.id, gymId, status: { not: 'PAID' } },
            data: {
              status: 'PAID',
              paidAt,
              paymentMethod: dto.paymentMethod || charge.paymentMethod,
            } as any,
          });

          if (updated.count !== 1) {
            const concurrentCharge = await tx.charge.findFirst({
              where: { id: charge.id, gymId },
              include: { student: true, subscription: true },
            });
            const concurrentTransaction = await tx.financialTransaction.findFirst({
              where: { gymId, source: 'charge', sourceId: charge.id },
            });
            if (concurrentCharge?.status === 'PAID' && concurrentTransaction) {
              const materialized = await materializeIronFiscalHandoff(tx, {
                gymId,
                chargeId: concurrentCharge.id,
                transactionId: concurrentTransaction.id,
                studentId: concurrentCharge.studentId,
                subscriptionId: concurrentCharge.subscriptionId,
                amount: concurrentCharge.amount,
                paidAt: concurrentCharge.paidAt,
                paymentMethod: concurrentCharge.paymentMethod,
              });
              return {
                charge: concurrentCharge,
                transaction: concurrentTransaction,
                fiscalHandoff: materialized.contract,
                fiscalHandoffRecordId: materialized.record.id,
                idempotent: true,
              };
            }
            throw new BadRequestException('Conflito ao processar pagamento');
          }

          const transaction = await tx.financialTransaction.create({
            data: {
              gymId,
              type: 'INCOME',
              accountId: account.id,
              description: `Mensalidade - ${charge.studentId.substring(0, 8)}...`,
              amount: charge.amount,
              paidAt,
              status: 'PAID',
              source: 'charge',
              sourceId: charge.id,
              studentId: charge.studentId,
              paymentMethod: dto.paymentMethod || charge.paymentMethod,
            } as any,
          });

          const updatedCharge = await tx.charge.findUnique({ where: { id: charge.id } });
          const materialized = await materializeIronFiscalHandoff(tx, {
            gymId,
            chargeId: charge.id,
            transactionId: transaction.id,
            studentId: charge.studentId,
            subscriptionId: charge.subscriptionId,
            amount: transaction.amount,
            paidAt: updatedCharge?.paidAt ?? paidAt,
            paymentMethod:
              updatedCharge?.paymentMethod ??
              dto.paymentMethod ??
              charge.paymentMethod,
          });
          const fiscalHandoff = materialized.contract;

          await this.audit.record({
            gymId,
            userId: actorUserId ?? null,
            action: 'FINANCIAL_CHARGE_PAID',
            entity: 'Charge',
            entityId: charge.id,
            previous: {
              status: charge.status,
              paidAt: charge.paidAt,
              paymentMethod: charge.paymentMethod,
            },
            next: {
              status: updatedCharge?.status,
              paidAt: updatedCharge?.paidAt,
              paymentMethod: updatedCharge?.paymentMethod,
              transactionId: transaction.id,
              accountId: account.id,
              amount: transaction.amount,
              fiscalHandoff,
              fiscalHandoffRecordId: materialized.record.id,
            },
          }, tx);

          await this.audit.record({
            gymId,
            userId: actorUserId ?? null,
            action: 'FISCAL_HANDOFF_PENDING_CAPABILITY',
            entity: 'Charge',
            entityId: charge.id,
            next: {
              ...fiscalHandoff,
              fiscalHandoffRecordId: materialized.record.id,
            },
          }, tx);

          return {
            charge: updatedCharge,
            transaction,
            fiscalHandoff,
            fiscalHandoffRecordId: materialized.record.id,
            idempotent: false,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async findAllCharges(
    gymId: string,
    filters:
      | string
      | {
          studentId?: string;
          status?: string;
          dueFrom?: string;
          dueTo?: string;
          overdue?: string;
        } = {},
  ) {
    const normalized =
      typeof filters === 'string' ? { studentId: filters } : filters;
    const status = this.parseEnumFilter(
      normalized.status,
      Object.values(ChargeStatus),
      'Status da cobranca',
    );
    const dueFrom = this.parseDateFilter(normalized.dueFrom, 'inicial');
    const dueTo = this.parseDateFilter(normalized.dueTo, 'final');
    const overdue = this.parseBooleanFilter(normalized.overdue, 'overdue');

    if (dueFrom && dueTo && dueFrom.getTime() > dueTo.getTime()) {
      throw new BadRequestException(
        'Data inicial nao pode ser posterior a data final',
      );
    }
    if (overdue === true && status && status !== ChargeStatus.PENDING) {
      throw new BadRequestException(
        'Filtro de inadimplencia exige cobranca PENDING',
      );
    }

    const dueDate = {
      ...(dueFrom ? { gte: dueFrom } : {}),
      ...(dueTo ? { lte: dueTo } : {}),
      ...(overdue === true ? { lt: new Date() } : {}),
    };
    const hasDueDateFilter = Object.keys(dueDate).length > 0;

    return this.prisma.charge.findMany({
      where: {
        gymId,
        ...(normalized.studentId ? { studentId: normalized.studentId } : {}),
        ...(overdue === true
          ? { status: ChargeStatus.PENDING }
          : status
            ? { status }
            : {}),
        ...(hasDueDateFilter ? { dueDate } : {}),
        ...(overdue === false
          ? {
              NOT: {
                status: ChargeStatus.PENDING,
                dueDate: { lt: new Date() },
              },
            }
          : {}),
      },
      select: tenantChargeReadSelect,
      orderBy: { dueDate: 'desc' },
    });
  }

  async findTransactions(
    gymId: string,
    filters: {
      studentId?: string;
      accountId?: string;
      status?: string;
      type?: string;
      from?: string;
      to?: string;
    } = {},
  ) {
    const status = this.parseEnumFilter(
      filters.status,
      Object.values(TransactionStatus),
      'Status da transacao',
    );
    const type = this.parseEnumFilter(
      filters.type,
      Object.values(TransactionType),
      'Tipo da transacao',
    );
    const from = this.parseDateFilter(filters.from, 'inicial');
    const to = this.parseDateFilter(filters.to, 'final');
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException(
        'Data inicial nao pode ser posterior a data final',
      );
    }

    return this.prisma.financialTransaction.findMany({
      where: {
        gymId,
        ...(filters.studentId ? { studentId: filters.studentId } : {}),
        ...(filters.accountId ? { accountId: filters.accountId } : {}),
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
        ...(from || to
          ? {
              paidAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      select: {
        id: true,
        type: true,
        accountId: true,
        description: true,
        amount: true,
        dueDate: true,
        paidAt: true,
        status: true,
        source: true,
        sourceId: true,
        studentId: true,
        paymentMethod: true,
        receiptUrl: true,
        createdAt: true,
        account: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });
  }
}
