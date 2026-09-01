import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email ja cadastrado');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        phone: dto.phone,
        passwordHash,
      },
    });

    if (dto.gymId && dto.roleName) {
      const gym = await this.prisma.gym.findUnique({
        where: { id: dto.gymId },
      });

      if (!gym) {
        throw new NotFoundException('Academia nao encontrada');
      }

      const role = await this.prisma.role.findUnique({
        where: { name: dto.roleName as any },
      });

      if (!role) {
        throw new NotFoundException('Role nao encontrado');
      }

      await this.prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: role.id,
          gymId: dto.gymId,
        },
      });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
    };
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        active: true,
        createdAt: true,
      },
    });
  }
}
