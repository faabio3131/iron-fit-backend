import { FinancialService } from './financial.service';
import { CreateFinancialAccountDto } from './dto/create-financial-account.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CreateChargeDto } from './dto/create-charge.dto';
import { PayChargeDto } from './dto/pay-charge.dto';
export declare class FinancialController {
    private financialService;
    constructor(financialService: FinancialService);
    createAccount(dto: CreateFinancialAccountDto, user: any): Promise<{
        id: string;
        name: string;
        active: boolean;
        gymId: string;
        type: string;
        initialBalance: number;
    }>;
    findAllAccounts(user: any): Promise<{
        id: string;
        name: string;
        active: boolean;
        gymId: string;
        type: string;
        initialBalance: number;
    }[]>;
    createSubscription(dto: CreateSubscriptionDto, user: any): Promise<{
        student: {
            user: {
                id: string;
                name: string;
                email: string;
                phone: string | null;
                passwordHash: string;
                mfaEnabled: boolean;
                mfaSecret: string | null;
                active: boolean;
                createdAt: Date;
                updatedAt: Date;
            } | null;
        } & {
            id: string;
            userId: string | null;
            gymId: string;
            birthDate: Date | null;
            gender: string | null;
            goal: string | null;
            level: string | null;
            consentHealth: boolean;
            consentComm: boolean;
            consentBiometry: boolean;
            status: import(".prisma/client").$Enums.StudentStatus;
            enrollmentDate: Date;
        };
    } & {
        id: string;
        gymId: string;
        status: import(".prisma/client").$Enums.SubscriptionStatus;
        studentId: string;
        planName: string;
        amount: number;
        nextBillingAt: Date | null;
        gatewaySubId: string | null;
        startedAt: Date;
    }>;
    createCharge(dto: CreateChargeDto, user: any): Promise<{
        id: string;
        gymId: string;
        status: import(".prisma/client").$Enums.ChargeStatus;
        studentId: string;
        amount: number;
        subscriptionId: string | null;
        dueDate: Date | null;
        paymentMethod: string | null;
        paidAt: Date | null;
        gatewayChargeId: string | null;
        pixQrCode: string | null;
        paymentLink: string | null;
    }>;
    findAllCharges(user: any): Promise<({
        student: {
            user: {
                id: string;
                name: string;
                email: string;
                phone: string | null;
                passwordHash: string;
                mfaEnabled: boolean;
                mfaSecret: string | null;
                active: boolean;
                createdAt: Date;
                updatedAt: Date;
            } | null;
        } & {
            id: string;
            userId: string | null;
            gymId: string;
            birthDate: Date | null;
            gender: string | null;
            goal: string | null;
            level: string | null;
            consentHealth: boolean;
            consentComm: boolean;
            consentBiometry: boolean;
            status: import(".prisma/client").$Enums.StudentStatus;
            enrollmentDate: Date;
        };
        subscription: {
            id: string;
            gymId: string;
            status: import(".prisma/client").$Enums.SubscriptionStatus;
            studentId: string;
            planName: string;
            amount: number;
            nextBillingAt: Date | null;
            gatewaySubId: string | null;
            startedAt: Date;
        } | null;
    } & {
        id: string;
        gymId: string;
        status: import(".prisma/client").$Enums.ChargeStatus;
        studentId: string;
        amount: number;
        subscriptionId: string | null;
        dueDate: Date | null;
        paymentMethod: string | null;
        paidAt: Date | null;
        gatewayChargeId: string | null;
        pixQrCode: string | null;
        paymentLink: string | null;
    })[]>;
    payCharge(id: string, dto: PayChargeDto, user: any): Promise<{
        charge: {
            id: string;
            gymId: string;
            status: import(".prisma/client").$Enums.ChargeStatus;
            studentId: string;
            amount: number;
            subscriptionId: string | null;
            dueDate: Date | null;
            paymentMethod: string | null;
            paidAt: Date | null;
            gatewayChargeId: string | null;
            pixQrCode: string | null;
            paymentLink: string | null;
        };
        transaction: {
            id: string;
            description: string;
            createdAt: Date;
            gymId: string;
            status: import(".prisma/client").$Enums.TransactionStatus;
            studentId: string | null;
            type: import(".prisma/client").$Enums.TransactionType;
            amount: number;
            dueDate: Date | null;
            paymentMethod: string | null;
            paidAt: Date | null;
            accountId: string | null;
            categoryId: string | null;
            source: string | null;
            sourceId: string | null;
            supplierId: string | null;
            receiptUrl: string | null;
            createdBy: string | null;
        };
    }>;
}
