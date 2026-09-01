import { PrismaService } from '../../prisma/prisma.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
export declare class ExercisesService {
    private prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateExerciseDto): Promise<{
        id: string;
        name: string;
        level: string | null;
        contraindications: import("@prisma/client/runtime/library").JsonValue | null;
        videoUrl: string | null;
        muscleGroup: string | null;
        movement: string | null;
    }>;
    findAll(): Promise<{
        id: string;
        name: string;
        level: string | null;
        contraindications: import("@prisma/client/runtime/library").JsonValue | null;
        videoUrl: string | null;
        muscleGroup: string | null;
        movement: string | null;
    }[]>;
}
