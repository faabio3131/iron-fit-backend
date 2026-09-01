import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFinancialAccountDto } from './dto/create-financial-account.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CreateChargeDto } from './dto/create-charge.dto';
import { PayChargeDto } from './dto/pay-charge.dto';

@Injectable()
export class FinancialService {
  constructor(private prisma: PrismaService) {}

  async createAccount(dto: CreateFinancialAccountDto, userGymId?: string) {
    const gymId = dto.gymId || userGymId;

    if (!gymId) {
      throw new NotFoundException('Academia nao informada');
    }

    return this.prisma.financialAccount.create({
      data: {
        gymId,
        name: dto.name,
        type: dto.type,
        initialBalance: dto.initialBalance || 0,
      } as any,
    });
  }

  async findAllAccounts(userGymId?: string) {
    return this.prisma.financialAccount.findMany({
      where: {
        ...(userGymId ? { gymId: userGymId } : {}),
        active: true,
      },
    });
  }

  async createSubscription(dto: CreateSubscriptionDto, userGymId?: string) {
    const student = await this.prisma.student.findFirst({
      where: {
        id: dto.studentId,
        ...(userGymId ? { gymId: userGymId } : {}),
      },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    const subscription = await this.prisma.subscription.create({
      data: {
        gymId: student.gymId,
        studentId: dto.studentId,
        planName: dto.planName,
        amount: dto.amount,
        nextBillingAt: dto.nextBillingAt ? new Date(dto.nextBillingAt) : null,
      } as any,
      include: { student: { include: { user: true } } },
    });

    return subscription;
  }

  async createCharge(dto: CreateChargeDto, userGymId?: string) {
    const student = await this.prisma.student.findFirst({
      where: {
        id: dto.studentId,
        ...(userGymId ? { gymId: userGymId } : {}),
      },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    return this.prisma.charge.create({
      data: {
        gymId: student.gymId,
        studentId: dto.studentId,
        subscriptionId: dto.subscriptionId,
        amount: dto.amount,
        dueDate: new Date(dto.dueDate),
        paymentMethod: dto.paymentMethod,
      } as any,
    });
  }

  async payCharge(chargeId: string, dto: PayChargeDto, userGymId?: string) {
    const charge = await this.prisma.charge.findUnique({
      where: { id: chargeId },
      include: { student: true },
    });

    if (!charge) {
      throw new NotFoundException('Cobranca nao encontrada');
    }

    if (userGymId && charge.gymId !== userGymId) {
      throw new NotFoundException('Cobranca nao encontrada');
    }

    if (charge.status === 'PAID') {
      throw new BadRequestException('Cobranca ja foi paga');
    }

    const account = await this.prisma.financialAccount.findUnique({
      where: { id: dto.accountId },
    });

    if (!account) {
      throw new NotFoundException('Conta nao encontrada');
    }

    if (account.gymId !== charge.gymId) {
      throw new BadRequestException('Conta nao pertence a esta academia');
    }

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();

    const [updatedCharge, transaction] = await this.prisma.$transaction([
      this.prisma.charge.update({
        where: { id: chargeId },
        data: {
          status: 'PAID',
          paidAt,
          paymentMethod: dto.paymentMethod || charge.paymentMethod,
        } as any,
      }),
      this.prisma.financialTransaction.create({
        data: {
          gymId: charge.gymId,
          type: 'INCOME',
          accountId: dto.accountId,
          description: `Mensalidade - ${charge.studentId.substring(0, 8)}...`,
          amount: charge.amount,
          paidAt,
          status: 'PAID',
          source: 'charge',
          sourceId: charge.id,
          studentId: charge.studentId,
          paymentMethod: dto.paymentMethod || charge.paymentMethod,
        } as any,
      }),
    ]);

    return { charge: updatedCharge, transaction };
  }

  async findAllCharges(userGymId?: string) {
    return this.prisma.charge.findMany({
      where: userGymId ? { gymId: userGymId } : {},
      include: {
        student: { include: { user: true } },
        subscription: true,
      },
      orderBy: { dueDate: 'desc' },
    });
  }
}
