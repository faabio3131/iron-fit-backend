import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
export declare class StudentsController {
    private studentsService;
    constructor(studentsService: StudentsService);
    create(dto: CreateStudentDto, user: any): Promise<{
        id: string;
        name: string;
        email: string;
        phone: string | null;
        status: import(".prisma/client").$Enums.StudentStatus;
        enrollmentDate: Date;
    }>;
    findAll(user: any): Promise<{
        id: string;
        name: string;
        email: string;
        phone: string | null;
        status: import(".prisma/client").$Enums.StudentStatus;
        enrollmentDate: Date;
    }[]>;
    findOne(id: string, user: any): Promise<{
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
