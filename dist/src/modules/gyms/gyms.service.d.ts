import { PrismaService } from '../../prisma/prisma.service';
import { CreateGymDto } from './dto/create-gym.dto';
export declare class GymsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateGymDto): Promise<{
        id: string;
        name: string;
        active: boolean;
        createdAt: Date;
        slug: string;
        logoUrl: string | null;
        timezone: string;
    }>;
    findAll(): Promise<{
        id: string;
        name: string;
        active: boolean;
        createdAt: Date;
        slug: string;
        logoUrl: string | null;
        timezone: string;
    }[]>;
    findOne(id: string): Promise<{
        id: string;
        name: string;
        active: boolean;
        createdAt: Date;
        slug: string;
        logoUrl: string | null;
        timezone: string;
    }>;
}
