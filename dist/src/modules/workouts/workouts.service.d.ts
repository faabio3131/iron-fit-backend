import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkoutDto } from './dto/create-workout.dto';
export declare class WorkoutsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateWorkoutDto, userGymId?: string): Promise<{
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
    }>;
    findAllByStudent(studentId: string, userGymId?: string): Promise<({
        sessions: ({
            exercises: ({
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
    findOne(id: string, userGymId?: string): Promise<{
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
        student: {
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
    }>;
    updateStatus(id: string, status: string, userId: string, userGymId?: string): Promise<{
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
    }>;
}
