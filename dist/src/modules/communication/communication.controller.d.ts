import { CommunicationService } from './communication.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { CreateAutomationDto } from './dto/create-automation.dto';
export declare class CommunicationController {
    private communicationService;
    constructor(communicationService: CommunicationService);
    createTemplate(dto: CreateTemplateDto, user: any): Promise<{
        id: string;
        name: string;
        active: boolean;
        gymId: string;
        channel: import(".prisma/client").$Enums.MessageChannel;
        title: string | null;
        body: string;
        variables: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    findAllTemplates(user: any): Promise<{
        id: string;
        name: string;
        active: boolean;
        gymId: string;
        channel: import(".prisma/client").$Enums.MessageChannel;
        title: string | null;
        body: string;
        variables: import("@prisma/client/runtime/library").JsonValue | null;
    }[]>;
    sendMessage(dto: SendMessageDto, user: any): Promise<{
        id: string;
        createdAt: Date;
        gymId: string;
        status: import(".prisma/client").$Enums.MessageStatus;
        studentId: string;
        channel: import(".prisma/client").$Enums.MessageChannel;
        title: string | null;
        body: string;
        templateId: string | null;
        sentAt: Date | null;
        deliveredAt: Date | null;
        readAt: Date | null;
        errorMessage: string | null;
    }>;
    findAllMessages(user: any): Promise<({
        student: {
            user: {
                id: string;
                name: string;
                email: string;
                phone: string | null;
                passwordHash: string;
                mfaEnabled: boolean;
                mfaSecret: string | null;
                active: boolean;
                createdAt: Date;
                updatedAt: Date;
            } | null;
        } & {
            id: string;
            userId: string | null;
            gymId: string;
            birthDate: Date | null;
            gender: string | null;
            goal: string | null;
            level: string | null;
            consentHealth: boolean;
            consentComm: boolean;
            consentBiometry: boolean;
            status: import(".prisma/client").$Enums.StudentStatus;
            enrollmentDate: Date;
        };
        template: {
            id: string;
            name: string;
            active: boolean;
            gymId: string;
            channel: import(".prisma/client").$Enums.MessageChannel;
            title: string | null;
            body: string;
            variables: import("@prisma/client/runtime/library").JsonValue | null;
        } | null;
    } & {
        id: string;
        createdAt: Date;
        gymId: string;
        status: import(".prisma/client").$Enums.MessageStatus;
        studentId: string;
        channel: import(".prisma/client").$Enums.MessageChannel;
        title: string | null;
        body: string;
        templateId: string | null;
        sentAt: Date | null;
        deliveredAt: Date | null;
        readAt: Date | null;
        errorMessage: string | null;
    })[]>;
    createAutomation(dto: CreateAutomationDto, user: any): Promise<{
        id: string;
        name: string;
        active: boolean;
        gymId: string;
        triggerEvent: string;
        conditions: import("@prisma/client/runtime/library").JsonValue | null;
        actions: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    findAllAutomations(user: any): Promise<{
        id: string;
        name: string;
        active: boolean;
        gymId: string;
        triggerEvent: string;
        conditions: import("@prisma/client/runtime/library").JsonValue | null;
        actions: import("@prisma/client/runtime/library").JsonValue | null;
    }[]>;
}
