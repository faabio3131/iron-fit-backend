import { AccessService } from './access.service';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { ScanDto } from './dto/scan.dto';
export declare class AccessController {
    private accessService;
    constructor(accessService: AccessService);
    createCredential(dto: CreateCredentialDto, user: any): Promise<{
        credentialId: string;
        qrToken: string;
        type: import(".prisma/client").$Enums.AccessType;
        active: boolean;
        aviso: string;
    }>;
    scan(dto: ScanDto): Promise<{
        allowed: boolean;
        denialReason: string | null;
        eventId: string | null;
        student: {
            id: string;
            name: string | null;
        } | null;
    }>;
}
