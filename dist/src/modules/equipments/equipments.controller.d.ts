import { EquipmentsService } from './equipments.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
export declare class EquipmentsController {
    private equipmentsService;
    constructor(equipmentsService: EquipmentsService);
    create(dto: CreateEquipmentDto, user: any): Promise<{
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
    findAll(user: any): Promise<{
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
    findOne(id: string, user: any): Promise<{
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
