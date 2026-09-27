import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { passwordPolicyViolations } from '../auth/auth-security';
import {
  canAssignRole,
  resolveAssignmentGymId,
} from '../../common/security/rbac-policy';

@Injectable()
export class UsersService {
  private readonly audit: AuditService;

  constructor(private prisma: PrismaService) {
    this.audit = new AuditService(prisma);
  }

  async create(dto: CreateUserDto, actor: any) {
    if (passwordPolicyViolations(dto.password).length > 0) {
      throw new BadRequestException(
        'Senha deve ter 12-128 caracteres com maiuscula, minuscula, numero e simbolo',
      );
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email ja cadastrado');
    }

    let role: any = null;
    let assignmentGymId: string | null | undefined;

    if (dto.roleName || dto.gymId) {
      if (!dto.roleName) {
        throw new BadRequestException('Role obrigatoria para vinculo com academia');
      }

      if (!canAssignRole(actor.roles ?? [], dto.roleName, actor.isSuperAdmin === true)) {
        throw new ForbiddenException('Role nao permitida para o usuario autenticado');
      }

      try {
        assignmentGymId = resolveAssignmentGymId({
          actorGymId: actor.activeGymId ?? actor.gymId,
          requestedGymId: dto.gymId,
          targetRole: dto.roleName,
          isSuperAdmin: actor.isSuperAdmin === true,
        });
      } catch {
        throw new ForbiddenException('Tenant nao permitido para atribuicao');
      }

      if (assignmentGymId) {
        const gym = await this.prisma.gym.findFirst({
          where: { id: assignmentGymId, active: true },
        });

        if (!gym) {
          throw new NotFoundException('Academia nao encontrada');
        }
      }

      role = await this.prisma.role.findUnique({
        where: { name: dto.roleName as any },
      });

      if (!role) {
        throw new NotFoundException('Role nao encontrado');
      }
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

    await this.audit.record({
      gymId: assignmentGymId ?? actor.activeGymId ?? actor.gymId ?? null,
      userId: actor.id ?? null,
      action: 'USER_CREATED',
      entity: 'User',
      entityId: user.id,
      next: { active: user.active },
    });

    if (role) {
      const userRole = await this.prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: role.id,
          gymId: assignmentGymId ?? null,
          assignedBy: actor.id,
        },
      });

      await this.audit.record({
        gymId: assignmentGymId ?? null,
        userId: actor.id ?? null,
        action: 'USER_ROLE_ASSIGNED',
        entity: 'UserRole',
        entityId: userRole.id,
        next: {
          targetUserId: user.id,
          role: role.name,
          gymId: assignmentGymId ?? null,
        },
      });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
    };
  }

  async findAll(actor: any) {
    const isGlobalSuperAdmin =
      actor.isSuperAdmin === true && actor.scope === 'global';

    return this.prisma.user.findMany({
      where: isGlobalSuperAdmin
        ? undefined
        : {
            userRoles: {
              some: {
                gymId: actor.activeGymId ?? actor.gymId,
              },
            },
          },
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
