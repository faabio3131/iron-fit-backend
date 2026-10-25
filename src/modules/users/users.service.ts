import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { passwordPolicyViolations, refreshSessionName } from '../auth/auth-security';
import { AuthService } from '../auth/auth.service';
import { InviteUserDto } from './dto/invite-user.dto';
import {
  canAssignRole,
  resolveAssignmentGymId,
} from '../../common/security/rbac-policy';

@Injectable()
export class UsersService {
  private readonly audit: AuditService;

  constructor(
    private prisma: PrismaService,
    private readonly authService: AuthService,
  ) {
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

  async invite(dto: InviteUserDto, actor: any) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const temporaryPassword = `${randomBytes(24).toString('base64url')}Aa1!`;

    const user = await this.create(
      {
        email: normalizedEmail,
        name: dto.name.trim(),
        phone: dto.phone?.trim() || undefined,
        gymId: dto.gymId,
        roleName: dto.roleName,
        password: temporaryPassword,
      },
      actor,
    );

    await this.authService.requestPasswordReset(normalizedEmail);

    await this.audit.record({
      gymId: dto.gymId ?? actor.activeGymId ?? actor.gymId ?? null,
      userId: actor.id ?? null,
      action: 'USER_INVITE_REQUESTED',
      entity: 'User',
      entityId: user.id,
      next: {
        targetUserId: user.id,
        role: dto.roleName,
        delivery: 'PASSWORD_SETUP_EMAIL',
      },
    });

    return {
      ...user,
      invitation: {
        accepted: true,
        delivery: 'PASSWORD_SETUP_EMAIL',
      },
    };
  }

  private async findManagedMembership(userId: string, actor: any) {
    const gymId = actor.activeGymId ?? actor.gymId;
    if (!gymId) {
      throw new BadRequestException('Selecione uma academia para administrar a equipe');
    }

    const membership = await this.prisma.userRole.findFirst({
      where: { userId, gymId },
      include: { role: true, user: true },
    });

    if (!membership) {
      throw new NotFoundException('Membro da equipe nao encontrado');
    }

    if (
      !canAssignRole(
        actor.roles ?? [],
        membership.role.name,
        actor.isSuperAdmin === true,
      )
    ) {
      throw new ForbiddenException('Membro fora da sua autoridade de gestao');
    }

    return { gymId, membership };
  }

  async updateMembershipStatus(userId: string, active: boolean, actor: any) {
    const { gymId, membership } = await this.findManagedMembership(userId, actor);
    if (membership.active === active) {
      return { userId, active, roleName: membership.role.name };
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // An authorized actor must not mutate a role that changed after the
        // policy check (for example, a manager just promoted to OWNER).
        await tx.userRole.update({
          where: {
            id: membership.id,
            gymId,
            roleId: membership.roleId,
            active: membership.active,
          },
          data: { active },
        });

        if (!active) {
          await tx.session.updateMany({
            where: {
              userId,
              deviceName: refreshSessionName(gymId),
              revokedAt: null,
            },
            data: { revokedAt: new Date() },
          });
        }

        await this.audit.record({
          gymId,
          userId: actor.id ?? null,
          action: active ? 'USER_MEMBERSHIP_ENABLED' : 'USER_MEMBERSHIP_DISABLED',
          entity: 'UserRole',
          entityId: membership.id,
          previous: { active: membership.active, role: membership.role.name },
          next: { active, role: membership.role.name, targetUserId: userId },
        }, tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2025' || error.code === 'P2034')
      ) {
        throw new ConflictException('Vinculo foi alterado; atualize a equipe e tente novamente');
      }
      throw error;
    }

    return { userId, active, roleName: membership.role.name };
  }

  async updateMembershipRole(userId: string, roleName: string, actor: any) {
    const { gymId, membership } = await this.findManagedMembership(userId, actor);

    if (!canAssignRole(actor.roles ?? [], roleName, actor.isSuperAdmin === true)) {
      throw new ForbiddenException('Role nao permitida para o usuario autenticado');
    }

    const role = await this.prisma.role.findUnique({ where: { name: roleName as any } });
    if (!role) {
      throw new NotFoundException('Role nao encontrado');
    }

    if (membership.roleId !== role.id) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.userRole.update({
            where: {
              id: membership.id,
              gymId,
              roleId: membership.roleId,
              active: membership.active,
            },
            data: { roleId: role.id, assignedBy: actor.id },
          });

          await this.audit.record({
            gymId,
            userId: actor.id ?? null,
            action: 'USER_ROLE_CHANGED',
            entity: 'UserRole',
            entityId: membership.id,
            previous: { role: membership.role.name },
            next: { role: role.name, targetUserId: userId },
          }, tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2025' || error.code === 'P2034')
        ) {
          throw new ConflictException('Vinculo foi alterado; atualize a equipe e tente novamente');
        }
        throw error;
      }
    }

    return {
      userId,
      roleName: role.name,
      active: membership.active,
    };
  }

  async findAll(actor: any) {
    const isGlobalSuperAdmin =
      actor.isSuperAdmin === true && actor.scope === 'global';
    const activeGymId = actor.activeGymId ?? actor.gymId;
    const isManagerOnly =
      !isGlobalSuperAdmin &&
      Array.isArray(actor.roles) &&
      actor.roles.includes('MANAGER') &&
      !actor.roles.includes('OWNER');

    const roleNames = isManagerOnly
      ? ['RECEPTION', 'TRAINER']
      : ['OWNER', 'MANAGER', 'RECEPTION', 'TRAINER'];

    const users = await this.prisma.user.findMany({
      where: isGlobalSuperAdmin
        ? undefined
        : {
            userRoles: {
              some: {
                gymId: activeGymId,
                role: { name: { in: roleNames as any } },
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
        userRoles: {
          where: isGlobalSuperAdmin
            ? { role: { name: { in: roleNames as any } } }
            : { gymId: activeGymId, role: { name: { in: roleNames as any } } },
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    });

    return users.map((user) => {
      const membership = user.userRoles[0];
      const roleName = membership?.role.name ?? null;
      const permissions = membership
        ? membership.role.rolePermissions.map((item) => item.permission.name)
        : [];
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        accountActive: user.active,
        createdAt: user.createdAt,
        roleName,
        membershipActive: membership?.active ?? false,
        permissions,
        canManage: roleName
          ? canAssignRole(
              actor.roles ?? [],
              roleName,
              actor.isSuperAdmin === true,
            )
          : false,
      };
    });
  }
}
