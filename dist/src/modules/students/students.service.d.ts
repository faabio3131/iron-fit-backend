import { PrismaService } from '../../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
export declare class StudentsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateStudentDto, userGymId?: string): Promise<{
        id: string;
        name: string;
        email: string;
        phone: string | null;
        status: import(".prisma/client").$Enums.StudentStatus;
        enrollmentDate: Date;
    }>;
    findAll(gymId: string): Promise<{
        id: string;
        name: string;
        email: string;
        phone: string | null;
        status: import(".prisma/client").$Enums.StudentStatus;
        enrollmentDate: Date;
    }[]>;
    findOne(id: string, gymId: string): Promise<{
        id: string;
        name: string;
        email: string;
        phone: string | null;
        birthDate: Date | null;
        gender: string | null;
        goal: string | null;
        level: string | null;
        status: import(".prisma/client").$Enums.StudentStatus;
        enrollmentDate: Date;
        consentHealth: boolean;
        consentComm: boolean;
        consentBiometry: boolean;
    }>;
}
