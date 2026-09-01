import { SchedulesService } from './schedules.service';
import { CreateScheduleSlotDto } from './dto/create-schedule-slot.dto';
import { BookStudentDto } from './dto/book-student.dto';
export declare class SchedulesController {
    private schedulesService;
    constructor(schedulesService: SchedulesService);
    createSlot(dto: CreateScheduleSlotDto, user: any): Promise<{
        id: string;
        active: boolean;
        gymId: string;
        weekday: number;
        startTime: string;
        endTime: string;
        capacity: number;
    }>;
    findAllSlots(user: any): Promise<{
        id: string;
        active: boolean;
        gymId: string;
        weekday: number;
        startTime: string;
        endTime: string;
        capacity: number;
    }[]>;
    book(dto: BookStudentDto, user: any): Promise<{
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
    checkIn(id: string, user: any): Promise<{
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
