"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FinancialService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let FinancialService = class FinancialService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createAccount(dto, userGymId) {
        const gymId = dto.gymId || userGymId;
        if (!gymId) {
            throw new common_1.NotFoundException('Academia nao informada');
        }
        return this.prisma.financialAccount.create({
            data: {
                gymId,
                name: dto.name,
                type: dto.type,
                initialBalance: dto.initialBalance || 0,
            },
        });
    }
    async findAllAccounts(userGymId) {
        return this.prisma.financialAccount.findMany({
            where: {
                ...(userGymId ? { gymId: userGymId } : {}),
                active: true,
            },
        });
    }
    async createSubscription(dto, userGymId) {
        const student = await this.prisma.student.findFirst({
            where: {
                id: dto.studentId,
                ...(userGymId ? { gymId: userGymId } : {}),
            },
        });
        if (!student) {
            throw new common_1.NotFoundException('Aluno nao encontrado');
        }
        const subscription = await this.prisma.subscription.create({
            data: {
                gymId: student.gymId,
                studentId: dto.studentId,
                planName: dto.planName,
                amount: dto.amount,
                nextBillingAt: dto.nextBillingAt ? new Date(dto.nextBillingAt) : null,
            },
            include: { student: { include: { user: true } } },
        });
        return subscription;
    }
    async createCharge(dto, userGymId) {
        const student = await this.prisma.student.findFirst({
            where: {
                id: dto.studentId,
                ...(userGymId ? { gymId: userGymId } : {}),
            },
        });
        if (!student) {
            throw new common_1.NotFoundException('Aluno nao encontrado');
        }
        return this.prisma.charge.create({
            data: {
                gymId: student.gymId,
                studentId: dto.studentId,
                subscriptionId: dto.subscriptionId,
                amount: dto.amount,
                dueDate: new Date(dto.dueDate),
                paymentMethod: dto.paymentMethod,
            },
        });
    }
    async payCharge(chargeId, dto, userGymId) {
        const charge = await this.prisma.charge.findUnique({
            where: { id: chargeId },
            include: { student: true },
        });
        if (!charge) {
            throw new common_1.NotFoundException('Cobranca nao encontrada');
        }
        if (userGymId && charge.gymId !== userGymId) {
            throw new common_1.NotFoundException('Cobranca nao encontrada');
        }
        if (charge.status === 'PAID') {
            throw new common_1.BadRequestException('Cobranca ja foi paga');
        }
        const account = await this.prisma.financialAccount.findUnique({
            where: { id: dto.accountId },
        });
        if (!account) {
            throw new common_1.NotFoundException('Conta nao encontrada');
        }
        if (account.gymId !== charge.gymId) {
            throw new common_1.BadRequestException('Conta nao pertence a esta academia');
        }
        const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
        const [updatedCharge, transaction] = await this.prisma.$transaction([
            this.prisma.charge.update({
                where: { id: chargeId },
                data: {
                    status: 'PAID',
                    paidAt,
                    paymentMethod: dto.paymentMethod || charge.paymentMethod,
                },
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
                },
            }),
        ]);
        return { charge: updatedCharge, transaction };
    }
    async findAllCharges(userGymId) {
        return this.prisma.charge.findMany({
            where: userGymId ? { gymId: userGymId } : {},
            include: {
                student: { include: { user: true } },
                subscription: true,
            },
            orderBy: { dueDate: 'desc' },
        });
    }
};
exports.FinancialService = FinancialService;
exports.FinancialService = FinancialService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], FinancialService);
//# sourceMappingURL=financial.service.js.map