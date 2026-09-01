import { PrismaService } from '../../prisma/prisma.service';
import { CreateCredentialDto } from './dto/create-credential.dto';
export declare class AccessService {
    private prisma;
    constructor(prisma: PrismaService);
    private hash;
    createCredential(dto: CreateCredentialDto, userGymId?: string): Promise<{
        credentialId: string;
        qrToken: string;
        type: import(".prisma/client").$Enums.AccessType;
        active: boolean;
        aviso: string;
    }>;
    scan(qrToken: string, deviceId?: string): Promise<{
        allowed: boolean;
        denialReason: string | null;
        eventId: string | null;
        student: {
            id: string;
            name: string | null;
        } | null;
    }>;
}
