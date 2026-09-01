import { PrismaService } from '../../prisma/prisma.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
export declare class EquipmentsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateEquipmentDto, userGymId?: string): Promise<{
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
    }>;
    findAll(userGymId?: string): Promise<{
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
    }[]>;
    findOne(id: string, userGymId?: string): Promise<{
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
    }>;
}
