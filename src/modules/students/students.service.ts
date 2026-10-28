import { publicUserSelect } from '../../common/security/public-user-select';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { AcceptStudentInviteDto } from './dto/accept-student-invite.dto';
import { UpdateConsentsDto } from './dto/update-consents.dto';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { passwordPolicyViolations } from '../auth/auth-security';
import { TenantProductEntitlementsService } from '../product-entitlements/tenant-product-entitlements.service';

const STUDENT_ONBOARDING_SESSION = 'STUDENT_ONBOARDING';
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const TRIAL_STUDENT_LIMIT_FEATURE = 'commercial.trial_students_max';
const SERIALIZABLE_ATTEMPTS = 3;

@Injectable()
export class StudentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private entitlements: TenantProductEntitlementsService,
  ) {}

  private async activeTrialStudentLimit(gymId: string): Promise<number | null> {
    const now = new Date();
    const provisioning = await this.prisma.commercialTrialProvisioning.findFirst({
      where: {
        gymId,
        trialEndsAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select: { subscriptionId: true },
    });
    if (!provisioning) return null;

    const subscription = await this.prisma.tenantProductSubscription.findFirst({
      where: {
        id: provisioning.subscriptionId,
        gymId,
        status: 'ACTIVE',
        effectiveFrom: { lte: now },
        effectiveUntil: { gt: now },
      },
      select: { id: true },
    });
    if (!subscription) return null;

    const resolution = await this.entitlements.resolveFeature(
      gymId,
      TRIAL_STUDENT_LIMIT_FEATURE,
    );
    if (
      resolution.kind !== 'LIMIT' ||
      typeof resolution.value !== 'number' ||
      !Number.isInteger(resolution.value) ||
      resolution.value < 1
    ) {
      throw new ServiceUnavailableException(
        'Limite de alunos do trial nao configurado',
      );
    }
    return resolution.value;
  }

  private retryable(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    );
  }

  async create(dto: CreateStudentDto, userGymId?: string, actorUserId?: string) {
    if (!userGymId) {
      throw new BadRequestException('Tenant ativo obrigatorio');
    }

    if (dto.gymId && dto.gymId !== userGymId) {
      throw new NotFoundException('Academia nao encontrada');
    }

    const gym = await this.prisma.gym.findFirst({
      where: { id: userGymId, active: true },
    });

    if (!gym) {
      throw new NotFoundException('Academia nao encontrada');
    }

    const existingStudent = await this.prisma.student.findFirst({
      where: {
        gymId: userGymId,
        user: { email: dto.email },
      },
      include: { user: { select: publicUserSelect } },
    });

    if (existingStudent) {
      throw new ConflictException('Aluno ja cadastrado nesta academia');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    const studentRole = await this.prisma.role.findUnique({
      where: { name: 'STUDENT' },
    });

    if (!studentRole) {
      throw new NotFoundException('Role de aluno nao encontrada');
    }

    const trialStudentLimit = await this.activeTrialStudentLimit(userGymId);

    for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
      let onboardingToken: string | null = null;
      let onboardingExpiresAt: Date | null = null;

      try {
        const student = await this.prisma.$transaction(async (tx) => {
          if (trialStudentLimit !== null) {
            const currentStudents = await tx.student.count({
              where: {
                gymId: userGymId,
                status: { not: 'CANCELED' },
              },
            });
            if (currentStudents >= trialStudentLimit) {
              throw new ConflictException(
                `Trial limitado a ${trialStudentLimit} alunos`,
              );
            }
          }

          let user = existingUser;

      if (!user) {
        const provisionalSecret = randomBytes(48).toString('base64url');
        const passwordHash = await bcrypt.hash(provisionalSecret, 12);

        user = await tx.user.create({
          data: {
            email: dto.email,
            name: dto.name,
            phone: dto.phone,
            passwordHash,
            active: false,
          },
        });
      }

      const existingRole = await tx.userRole.findFirst({
        where: {
          userId: user.id,
          roleId: studentRole.id,
          gymId: userGymId,
        },
      });

      if (!existingRole) {
        await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: studentRole.id,
            gymId: userGymId,
          },
        });
      }

      const createdStudent = await tx.student.create({
        data: {
          gymId: userGymId,
          userId: user.id,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
          gender: dto.gender,
          goal: dto.goal,
          level: dto.level,
          consentHealth: dto.consentHealth ?? false,
          consentComm: dto.consentComm ?? false,
          consentBiometry: dto.consentBiometry ?? false,
        },
        include: { user: { select: publicUserSelect } },
      });

      await this.audit.record({
        gymId: userGymId,
        userId: actorUserId ?? null,
        action: 'STUDENT_CREATED',
        entity: 'Student',
        entityId: createdStudent.id,
        next: {
          status: createdStudent.status,
          consentHealth: createdStudent.consentHealth,
          consentComm: createdStudent.consentComm,
          consentBiometry: createdStudent.consentBiometry,
        },
      }, tx);

      if (!user.active) {
        onboardingToken = randomBytes(32).toString('base64url');
        const tokenHash = createHash('sha256')
          .update(onboardingToken)
          .digest('hex');
        onboardingExpiresAt = new Date(Date.now() + INVITE_TTL_MS);

        await tx.session.updateMany({
          where: {
            userId: user.id,
            deviceName: STUDENT_ONBOARDING_SESSION,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });

        await tx.session.create({
          data: {
            userId: user.id,
            refreshTokenHash: tokenHash,
            deviceName: STUDENT_ONBOARDING_SESSION,
            expiresAt: onboardingExpiresAt,
          },
        });
      }

          return createdStudent;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        return {
          id: student.id,
          name: student.user!.name,
          email: student.user!.email,
          phone: student.user!.phone,
          status: student.status,
          enrollmentDate: student.enrollmentDate,
          onboarding: onboardingToken
            ? {
                required: true,
                token: onboardingToken,
                expiresAt: onboardingExpiresAt,
              }
            : {
                required: false,
              },
        };
      } catch (error) {
        if (this.retryable(error) && attempt < SERIALIZABLE_ATTEMPTS) continue;
        throw error;
      }
    }

    throw new ConflictException('Falha de concorrencia ao cadastrar aluno');
  }

  async acceptInvite(dto: AcceptStudentInviteDto) {
    if (passwordPolicyViolations(dto.password).length > 0) {
      throw new BadRequestException(
        'Senha deve ter 12-128 caracteres com maiuscula, minuscula, numero e simbolo',
      );
    }

    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const now = new Date();

    const invite = await this.prisma.session.findFirst({
      where: {
        refreshTokenHash: tokenHash,
        deviceName: STUDENT_ONBOARDING_SESSION,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: { user: { select: publicUserSelect } },
    });

    if (!invite) {
      throw new UnauthorizedException('Convite invalido ou expirado');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.session.updateMany({
        where: {
          id: invite.id,
          userId: invite.userId,
          refreshTokenHash: tokenHash,
          deviceName: STUDENT_ONBOARDING_SESSION,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { revokedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedException('Convite invalido ou expirado');
      }
      await tx.user.update({
        where: { id: invite.userId },
        data: { passwordHash, active: true },
      });
    });

    return {
      activated: true,
      userId: invite.userId,
    };
  }

  async findAll(gymId: string) {
    const students = await this.prisma.student.findMany({
      where: { gymId },
      include: { user: { select: publicUserSelect } },
      orderBy: { enrollmentDate: 'desc' },
    });

    return students.map((s) => ({
      id: s.id,
      name: s.user!.name,
      email: s.user!.email,
      phone: s.user!.phone,
      status: s.status,
      enrollmentDate: s.enrollmentDate,
    }));
  }

  async findOne(id: string, gymId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, gymId },
      include: { user: { select: publicUserSelect } },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    return {
      id: student.id,
      name: student.user!.name,
      email: student.user!.email,
      phone: student.user!.phone,
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

  async updateConsents(
    id: string,
    dto: UpdateConsentsDto,
    gymId?: string,
    actorUserId?: string,
  ) {
    if (!gymId) {
      throw new BadRequestException('Tenant ativo obrigatorio');
    }

    // Only write explicitly supplied consents. Rewriting stale values of
    // unrelated fields could silently revoke or restore another preference.
    const changes = {
      ...(typeof dto.consentHealth === 'boolean' ? { consentHealth: dto.consentHealth } : {}),
      ...(typeof dto.consentComm === 'boolean' ? { consentComm: dto.consentComm } : {}),
      ...(typeof dto.consentBiometry === 'boolean' ? { consentBiometry: dto.consentBiometry } : {}),
    };
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Informe um consentimento para atualizar');
    }

    for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const previous = await tx.student.findFirst({
            where: { id, gymId },
            select: {
              id: true,
              consentHealth: true,
              consentComm: true,
              consentBiometry: true,
            },
          });
          if (!previous) {
            throw new NotFoundException('Aluno nao encontrado');
          }

          // Tenant authority is checked at write-time too. Atomic with audit.
          const updated = await tx.student.update({
            where: { id, gymId },
            data: changes,
            select: {
              id: true,
              consentHealth: true,
              consentComm: true,
              consentBiometry: true,
            },
          });

          await this.audit.record({
            gymId,
            userId: actorUserId ?? null,
            action: 'STUDENT_CONSENTS_UPDATED',
            entity: 'Student',
            entityId: id,
            previous: {
              consentHealth: previous.consentHealth,
              consentComm: previous.consentComm,
              consentBiometry: previous.consentBiometry,
            },
            next: updated,
          }, tx);

          return updated;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (this.retryable(error) && attempt < SERIALIZABLE_ATTEMPTS) continue;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          throw new NotFoundException('Aluno nao encontrado');
        }
        throw error;
      }
    }

    throw new ConflictException('Falha de concorrencia ao atualizar consentimentos');
  }
}
