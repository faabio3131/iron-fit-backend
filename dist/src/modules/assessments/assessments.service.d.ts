import { PrismaService } from '../../prisma/prisma.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
export declare class AssessmentsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateAssessmentDto, userId: string, userGymId?: string): Promise<{
        id: string;
        studentName: string;
        studentEmail: string | null;
        weight: number | null;
        height: number | null;
        bmi: number | null;
        bodyFatPercent: number | null;
        measurements: import("@prisma/client/runtime/library").JsonValue;
        restrictions: import("@prisma/client/runtime/library").JsonValue;
        notes: string | null;
        createdAt: Date;
    }>;
    findAllByStudent(studentId: string, userGymId?: string): Promise<{
        id: string;
        weight: number | null;
        height: number | null;
        bmi: number | null;
        bodyFatPercent: number | null;
        measurements: import("@prisma/client/runtime/library").JsonValue;
        restrictions: import("@prisma/client/runtime/library").JsonValue;
        notes: string | null;
        createdAt: Date;
    }[]>;
    findOne(id: string, userGymId?: string): Promise<{
        id: string;
        studentName: string;
        studentEmail: string | null;
        weight: number | null;
        height: number | null;
        bmi: number | null;
        bodyFatPercent: number | null;
        measurements: import("@prisma/client/runtime/library").JsonValue;
        restrictions: import("@prisma/client/runtime/library").JsonValue;
        notes: string | null;
        createdAt: Date;
    }>;
}
