import { PrismaService } from '../../prisma/prisma.service';
import { CreateScheduleSlotDto } from './dto/create-schedule-slot.dto';
import { BookStudentDto } from './dto/book-student.dto';
export declare class SchedulesService {
    private prisma;
    constructor(prisma: PrismaService);
    createSlot(dto: CreateScheduleSlotDto, userGymId?: string): Promise<{
        id: string;
        active: boolean;
        gymId: string;
        weekday: number;
        startTime: string;
        endTime: string;
        capacity: number;
    }>;
    findAllSlots(userGymId?: string): Promise<{
        id: string;
        active: boolean;
        gymId: string;
        weekday: number;
        startTime: string;
        endTime: string;
        capacity: number;
    }[]>;
    book(dto: BookStudentDto, userGymId?: string): Promise<{
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
    checkIn(id: string, userGymId?: string): Promise<{
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
