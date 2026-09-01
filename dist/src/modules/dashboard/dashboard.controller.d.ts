import { DashboardService } from './dashboard.service';
export declare class DashboardController {
    private dashboardService;
    constructor(dashboardService: DashboardService);
    getSummary(user: any): Promise<{
        students: {
            total: number;
            active: number;
            inactive: number;
        };
        equipments: {
            total: number;
        };
        revenue: {
            thisMonth: number;
        };
        charges: {
            pending: number;
            overdue: number;
        };
        workouts: {
            total: number;
            approved: number;
            drafts: number;
        };
        generatedAt: Date;
    }>;
    getRevenue(user: any, days?: string): Promise<{
        date: string;
        amount: number;
    }[]>;
    getAttendance(user: any, days?: string): Promise<{
        date: string;
        count: number;
    }[]>;
    getOverdue(user: any): Promise<({
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
    getBirthdays(user: any, days?: string): Promise<any[]>;
}
