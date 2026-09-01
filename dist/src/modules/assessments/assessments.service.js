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
exports.AssessmentsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let AssessmentsService = class AssessmentsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto, userId, userGymId) {
        const student = await this.prisma.student.findFirst({
            where: {
                id: dto.studentId,
                ...(userGymId ? { gymId: userGymId } : {}),
            },
            include: { user: true },
        });
        if (!student) {
            throw new common_1.NotFoundException('Aluno nao encontrado');
        }
        let calculatedBmi = dto.bmi;
        if (!calculatedBmi && dto.weight && dto.height) {
            const heightInMeters = dto.height / 100;
            calculatedBmi = Math.round((dto.weight / (heightInMeters * heightInMeters)) * 10) / 10;
        }
        const assessment = await this.prisma.assessment.create({
            data: {
                studentId: dto.studentId,
                evaluatorId: userId,
                weight: dto.weight,
                height: dto.height,
                bmi: calculatedBmi,
                bodyFatPercent: dto.bodyFatPercent,
                measurements: dto.measurements,
                restrictions: dto.restrictions,
                notes: dto.notes,
            },
        });
        const studentUser = student.user;
        return {
            id: assessment.id,
            studentName: studentUser ? studentUser.name : 'Sem usuario',
            studentEmail: studentUser ? studentUser.email : null,
            weight: assessment.weight,
            height: assessment.height,
            bmi: assessment.bmi,
            bodyFatPercent: assessment.bodyFatPercent,
            measurements: assessment.measurements,
            restrictions: assessment.restrictions,
            notes: assessment.notes,
            createdAt: assessment.createdAt,
        };
    }
    async findAllByStudent(studentId, userGymId) {
        const student = await this.prisma.student.findFirst({
            where: {
                id: studentId,
                ...(userGymId ? { gymId: userGymId } : {}),
            },
        });
        if (!student) {
            throw new common_1.NotFoundException('Aluno nao encontrado');
        }
        const assessments = await this.prisma.assessment.findMany({
            where: { studentId },
            orderBy: { createdAt: 'desc' },
        });
        return assessments.map((a) => ({
            id: a.id,
            weight: a.weight,
            height: a.height,
            bmi: a.bmi,
            bodyFatPercent: a.bodyFatPercent,
            measurements: a.measurements,
            restrictions: a.restrictions,
            notes: a.notes,
            createdAt: a.createdAt,
        }));
    }
    async findOne(id, userGymId) {
        const assessment = await this.prisma.assessment.findUnique({
            where: { id },
            include: {
                student: {
                    include: { user: true },
                },
            },
        });
        if (!assessment) {
            throw new common_1.NotFoundException('Avaliacao nao encontrada');
        }
        if (userGymId && assessment.student.gymId !== userGymId) {
            throw new common_1.ForbiddenException('Sem acesso a esta avaliacao');
        }
        const studentUser = assessment.student.user;
        return {
            id: assessment.id,
            studentName: studentUser ? studentUser.name : 'Sem usuario',
            studentEmail: studentUser ? studentUser.email : null,
            weight: assessment.weight,
            height: assessment.height,
            bmi: assessment.bmi,
            bodyFatPercent: assessment.bodyFatPercent,
            measurements: assessment.measurements,
            restrictions: assessment.restrictions,
            notes: assessment.notes,
            createdAt: assessment.createdAt,
        };
    }
};
exports.AssessmentsService = AssessmentsService;
exports.AssessmentsService = AssessmentsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AssessmentsService);
//# sourceMappingURL=assessments.service.js.map