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
exports.AccessService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const crypto_1 = require("crypto");
let AccessService = class AccessService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    hash(token) {
        return (0, crypto_1.createHash)('sha256').update(token).digest('hex');
    }
    async createCredential(dto, userGymId) {
        const student = await this.prisma.student.findFirst({
            where: {
                id: dto.studentId,
                ...(userGymId ? { gymId: userGymId } : {}),
            },
        });
        if (!student) {
            throw new common_1.NotFoundException('Aluno nao encontrado');
        }
        const rawToken = (0, crypto_1.randomBytes)(24).toString('hex');
        const tokenHash = this.hash(rawToken);
        const credential = await this.prisma.accessCredential.create({
            data: {
                studentId: dto.studentId,
                type: dto.type || 'QR_CODE',
                tokenHash,
                expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
            },
        });
        return {
            credentialId: credential.id,
            qrToken: rawToken,
            type: credential.type,
            active: credential.active,
            aviso: 'Guarde o qrToken: ele vira o QR Code e nao sera exibido novamente',
        };
    }
    async scan(qrToken, deviceId) {
        const tokenHash = this.hash(qrToken);
        const credential = await this.prisma.accessCredential.findFirst({
            where: { tokenHash },
            include: { student: { include: { user: true } } },
        });
        let allowed = true;
        let denialReason = null;
        if (!credential) {
            allowed = false;
            denialReason = 'Credencial invalida';
        }
        else if (!credential.active) {
            allowed = false;
            denialReason = 'Credencial inativa';
        }
        else if (credential.expiresAt && credential.expiresAt < new Date()) {
            allowed = false;
            denialReason = 'Credencial expirada';
        }
        else if (credential.student.status !== 'ACTIVE') {
            allowed = false;
            denialReason = 'Matricula inativa';
        }
        let gymId = null;
        if (deviceId) {
            const device = await this.prisma.accessDevice.findUnique({
                where: { id: deviceId },
            });
            if (device) {
                gymId = device.gymId;
            }
        }
        if (!gymId && credential) {
            gymId = credential.student.gymId;
        }
        let eventId = null;
        if (gymId) {
            const event = await this.prisma.accessEvent.create({
                data: {
                    gymId,
                    studentId: credential ? credential.studentId : null,
                    deviceId: deviceId || null,
                    allowed,
                    denialReason,
                },
            });
            eventId = event.id;
        }
        return {
            allowed,
            denialReason,
            eventId,
            student: credential
                ? {
                    id: credential.student.id,
                    name: credential.student.user ? credential.student.user.name : null,
                }
                : null,
        };
    }
};
exports.AccessService = AccessService;
exports.AccessService = AccessService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AccessService);
//# sourceMappingURL=access.service.js.map