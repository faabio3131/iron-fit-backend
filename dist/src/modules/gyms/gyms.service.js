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
exports.GymsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let GymsService = class GymsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto) {
        const existing = await this.prisma.gym.findUnique({
            where: { slug: dto.slug },
        });
        if (existing) {
            throw new common_1.ConflictException('Slug ja existe');
        }
        const gym = await this.prisma.gym.create({
            data: {
                name: dto.name,
                slug: dto.slug,
                logoUrl: dto.logoUrl,
                timezone: dto.timezone || 'America/Sao_Paulo',
            },
        });
        return gym;
    }
    async findAll() {
        return this.prisma.gym.findMany({
            where: { active: true },
            orderBy: { createdAt: 'desc' },
        });
    }
    async findOne(id) {
        const gym = await this.prisma.gym.findUnique({
            where: { id },
        });
        if (!gym) {
            throw new common_1.NotFoundException('Academia nao encontrada');
        }
        return gym;
    }
};
exports.GymsService = GymsService;
exports.GymsService = GymsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], GymsService);
//# sourceMappingURL=gyms.service.js.map