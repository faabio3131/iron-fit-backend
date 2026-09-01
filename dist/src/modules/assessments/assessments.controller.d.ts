import { AssessmentsService } from './assessments.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
export declare class AssessmentsController {
    private assessmentsService;
    constructor(assessmentsService: AssessmentsService);
    create(studentId: string, dto: CreateAssessmentDto, user: any): Promise<{
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
    findAllByStudent(studentId: string, user: any): Promise<{
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
}
export declare class AssessmentsByIdController {
    private assessmentsService;
    constructor(assessmentsService: AssessmentsService);
    findOne(id: string, user: any): Promise<{
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
