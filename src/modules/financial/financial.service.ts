import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFinancialAccountDto } from './dto/create-financial-account.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CreateChargeDto } from './dto/create-charge.dto';
import { PayChargeDto } from './dto/pay-charge.dto';

const MAX_SERIALIZABLE_RETRIES = 3;

@Injectable()
export class FinancialService {
  constructor(private prisma: PrismaService) {}

  private async withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
        if (!retryable || attempt === MAX_SERIALIZABLE_RETRIES) {
          throw error;
        }
      }
    }
    throw new BadRequestException('Falha de concorrencia financeira');
  }

  async createAccount(dto: CreateFinancialAccountDto, gymId: string) {
    const gym = await this.prisma.gym.findFirst({ where: { id: gymId, active: true } });
    if (!gym) {
      throw new NotFoundException('Academia nao encontrada');
    }

    return this.prisma.financialAccount.create({
      data: {
        gymId,
        name: dto.name,
        type: dto.type,
        initialBalance: dto.initialBalance ?? 0,
      } as any,
    });
  }

  async findAllAccounts(gymId: string) {
    return this.prisma.financialAccount.findMany({
      where: { gymId, active: true },
    });
  }

  async createSubscription(dto: CreateSubscriptionDto, gymId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, gymId },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    return this.prisma.subscription.create({
      data: {
        gymId,
        studentId: dto.studentId,
        planName: dto.planName,
        amount: dto.amount,
        nextBillingAt: dto.nextBillingAt ? new Date(dto.nextBillingAt) : null,
      } as any,
      include: { student: { include: { user: true } } },
    });
  }

  async createCharge(dto: CreateChargeDto, gymId: string) {
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

    return this.prisma.charge.create({
      data: {
        gymId,
        studentId: dto.studentId,
        subscriptionId: dto.subscriptionId,
        amount: dto.amount,
        dueDate: new Date(dto.dueDate),
        paymentMethod: dto.paymentMethod,
      } as any,
    });
  }

  async payCharge(chargeId: string, dto: PayChargeDto, gymId: string) {
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
            return { charge, transaction: existingTransaction, idempotent: true };
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
              return {
                charge: concurrentCharge,
                transaction: concurrentTransaction,
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
          return { charge: updatedCharge, transaction, idempotent: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async findAllCharges(gymId: string) {
    return this.prisma.charge.findMany({
      where: { gymId },
      include: {
        student: { include: { user: true } },
        subscription: true,
      },
      orderBy: { dueDate: 'desc' },
    });
  }
}
