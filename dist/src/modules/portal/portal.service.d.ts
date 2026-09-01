import { PrismaService } from '../../prisma/prisma.service';
export declare class PortalService {
    private prisma;
    constructor(prisma: PrismaService);
    private getStudentByUserId;
    getProfile(userId: string): Promise<{
        id: string;
        name: string | null;
        email: string | null;
        phone: string | null;
        gym: {
            id: string;
            name: string;
            slug: string;
            logoUrl: string | null;
        };
        status: import(".prisma/client").$Enums.StudentStatus;
        enrollmentDate: Date;
        goal: string | null;
        level: string | null;
    }>;
    getWorkouts(userId: string): Promise<({
        sessions: ({
            exercises: ({
                equipment: {
                    id: string;
                    name: string;
                    active: boolean;
                    gymId: string;
                    standardName: string | null;
                    type: string | null;
                    primaryMuscle: string | null;
                    secondaryMuscles: import("@prisma/client/runtime/library").JsonValue | null;
                    movementPattern: string | null;
                    difficulty: string | null;
                    contraindications: import("@prisma/client/runtime/library").JsonValue | null;
                    videoUrl: string | null;
                } | null;
                exercise: {
                    id: string;
                    name: string;
                    level: string | null;
                    contraindications: import("@prisma/client/runtime/library").JsonValue | null;
                    videoUrl: string | null;
                    muscleGroup: string | null;
                    movement: string | null;
                };
            } & {
                id: string;
                notes: string | null;
                exerciseId: string;
                equipmentId: string | null;
                order: number;
                sets: number | null;
                reps: string | null;
                restSeconds: number | null;
                suggestedLoad: string | null;
                sessionId: string;
            })[];
        } & {
            id: string;
            name: string;
            order: number;
            sessionType: string | null;
            estimatedMinutes: number | null;
            workoutId: string;
        })[];
    } & {
        id: string;
        createdAt: Date;
        goal: string | null;
        level: string | null;
        status: import(".prisma/client").$Enums.WorkoutStatus;
        studentId: string;
        notes: string | null;
        assessmentId: string | null;
        weeklyFrequency: number | null;
        startDate: Date | null;
        validUntil: Date | null;
        createdByAI: boolean;
        approvedById: string | null;
    })[]>;
    getAssessments(userId: string): Promise<{
        id: string;
        createdAt: Date;
        studentId: string;
        weight: number | null;
        height: number | null;
        bmi: number | null;
        bodyFatPercent: number | null;
        measurements: import("@prisma/client/runtime/library").JsonValue | null;
        restrictions: import("@prisma/client/runtime/library").JsonValue | null;
        notes: string | null;
        evaluatorId: string | null;
    }[]>;
    getSchedules(userId: string): Promise<({
        slot: {
            id: string;
            active: boolean;
            gymId: string;
            weekday: number;
            startTime: string;
            endTime: string;
            capacity: number;
        };
    } & {
        id: string;
        status: import(".prisma/client").$Enums.ScheduleStatus;
        studentId: string;
        slotId: string;
        date: Date;
        checkedInAt: Date | null;
    })[]>;
    getCharges(userId: string): Promise<{
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
    }[]>;
    checkIn(userId: string): Promise<{
        slot: {
            id: string;
            active: boolean;
            gymId: string;
            weekday: number;
            startTime: string;
            endTime: string;
            capacity: number;
        };
    } & {
        id: string;
        status: import(".prisma/client").$Enums.ScheduleStatus;
        studentId: string;
        slotId: string;
        date: Date;
        checkedInAt: Date | null;
    }>;
}
