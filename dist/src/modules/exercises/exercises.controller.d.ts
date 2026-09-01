import { ExercisesService } from './exercises.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
export declare class ExercisesController {
    private exercisesService;
    constructor(exercisesService: ExercisesService);
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
