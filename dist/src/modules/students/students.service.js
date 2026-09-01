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
exports.StudentsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const bcrypt = require("bcrypt");
let StudentsService = class StudentsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto, userGymId) {
        if (userGymId && dto.gymId !== userGymId) {
            throw new common_1.NotFoundException('Academia nao encontrada');
        }
        const gym = await this.prisma.gym.findUnique({
            where: { id: dto.gymId },
        });
        if (!gym) {
            throw new common_1.NotFoundException('Academia nao encontrada');
        }
        const existing = await this.prisma.student.findFirst({
            where: {
                gymId: dto.gymId,
                user: { email: dto.email },
            },
            include: { user: true },
        });
        if (existing) {
            throw new common_1.ConflictException('Aluno ja cadastrado nesta academia');
        }
        const passwordHash = await bcrypt.hash('aluno123', 10);
        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                name: dto.name,
                phone: dto.phone,
                passwordHash,
            },
        });
        const student = await this.prisma.student.create({
            data: {
                gymId: dto.gymId,
                userId: user.id,
                birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
                gender: dto.gender,
                goal: dto.goal,
                level: dto.level,
                consentHealth: dto.consentHealth || false,
                consentComm: dto.consentComm || false,
                consentBiometry: dto.consentBiometry || false,
            },
            include: { user: true },
        });
        return {
            id: student.id,
            name: student.user.name,
            email: student.user.email,
            phone: student.user.phone,
            status: student.status,
            enrollmentDate: student.enrollmentDate,
        };
    }
    async findAll(gymId) {
        const students = await this.prisma.student.findMany({
            where: { gymId },
            include: { user: true },
            orderBy: { enrollmentDate: 'desc' },
        });
        return students.map((s) => ({
            id: s.id,
            name: s.user.name,
            email: s.user.email,
            phone: s.user.phone,
            status: s.status,
            enrollmentDate: s.enrollmentDate,
        }));
    }
    async findOne(id, gymId) {
        const student = await this.prisma.student.findFirst({
            where: { id, gymId },
            include: { user: true },
        });
        if (!student) {
            throw new common_1.NotFoundException('Aluno nao encontrado');
        }
        return {
            id: student.id,
            name: student.user.name,
            email: student.user.email,
            phone: student.user.phone,
            birthDate: student.birthDate,
            gender: student.gender,
            goal: student.goal,
            level: student.level,
            status: student.status,
            enrollmentDate: student.enrollmentDate,
            consentHealth: student.consentHealth,
            consentComm: student.consentComm,
            consentBiometry: student.consentBiometry,
        };
    }
};
exports.StudentsService = StudentsService;
exports.StudentsService = StudentsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], StudentsService);
//# sourceMappingURL=students.service.js.map