"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommunicationService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let CommunicationService = class CommunicationService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createTemplate(dto, userGymId) {
        const gymId = dto.gymId || userGymId;
        if (!gymId) {
            throw new common_1.NotFoundException('Academia nao informada');
        }
        return this.prisma.communicationTemplate.create({
            data: {
                gymId,
                name: dto.name,
                channel: dto.channel,
                title: dto.title,
                body: dto.body,
                variables: dto.variables,
            },
        });
    }
    async findAllTemplates(userGymId) {
        return this.prisma.communicationTemplate.findMany({
            where: {
                ...(userGymId ? { gymId: userGymId } : {}),
                active: true,
            },
            orderBy: { name: 'asc' },
        });
    }
    async sendMessage(dto, userGymId) {
        const student = await this.prisma.student.findFirst({
            where: {
                id: dto.studentId,
                ...(userGymId ? { gymId: userGymId } : {}),
            },
        });
        if (!student) {
            throw new common_1.NotFoundException('Aluno nao encontrado');
        }
        return this.prisma.communicationMessage.create({
            data: {
                gymId: student.gymId,
                studentId: dto.studentId,
                templateId: dto.templateId,
                channel: dto.channel,
                title: dto.title,
                body: dto.body,
                status: 'QUEUED',
            },
        });
    }
    async findAllMessages(userGymId) {
        return this.prisma.communicationMessage.findMany({
            where: userGymId ? { gymId: userGymId } : {},
            include: {
                student: { include: { user: true } },
                template: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    async createAutomation(dto, userGymId) {
        const gymId = dto.gymId || userGymId;
        if (!gymId) {
            throw new common_1.NotFoundException('Academia nao informada');
        }
        return this.prisma.communicationAutomation.create({
            data: {
                gymId,
                name: dto.name,
                triggerEvent: dto.triggerEvent,
                conditions: dto.conditions,
                actions: dto.actions,
            },
        });
    }
    async findAllAutomations(userGymId) {
        return this.prisma.communicationAutomation.findMany({
            where: {
                ...(userGymId ? { gymId: userGymId } : {}),
                active: true,
            },
            orderBy: { name: 'asc' },
        });
    }
};
exports.CommunicationService = CommunicationService;
exports.CommunicationService = CommunicationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CommunicationService);
//# sourceMappingURL=communication.service.js.map