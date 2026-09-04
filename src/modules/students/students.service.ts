import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { AcceptStudentInviteDto } from './dto/accept-student-invite.dto';
import { UpdateConsentsDto } from './dto/update-consents.dto';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';

const STUDENT_ONBOARDING_SESSION = 'STUDENT_ONBOARDING';
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class StudentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

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
      include: { user: true },
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

    let onboardingToken: string | null = null;
    let onboardingExpiresAt: Date | null = null;

    const student = await this.prisma.$transaction(async (tx) => {
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
        include: { user: true },
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
    });

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
  }

  async acceptInvite(dto: AcceptStudentInviteDto) {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const now = new Date();

    const invite = await this.prisma.session.findFirst({
      where: {
        refreshTokenHash: tokenHash,
        deviceName: STUDENT_ONBOARDING_SESSION,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: { user: true },
    });

    if (!invite) {
      throw new UnauthorizedException('Convite invalido ou expirado');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: invite.userId },
        data: {
          passwordHash,
          active: true,
        },
      }),
      this.prisma.session.update({
        where: { id: invite.id },
        data: { revokedAt: now },
      }),
    ]);

    return {
      activated: true,
      userId: invite.userId,
    };
  }

  async findAll(gymId: string) {
    const students = await this.prisma.student.findMany({
      where: { gymId },
      include: { user: true },
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
      include: { user: true },
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

    const previous = await this.prisma.student.findFirst({
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

    const nextValues = {
      consentHealth: dto.consentHealth ?? previous.consentHealth,
      consentComm: dto.consentComm ?? previous.consentComm,
      consentBiometry: dto.consentBiometry ?? previous.consentBiometry,
    };

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.student.update({
        where: { id },
        data: nextValues,
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
    });
  }
}
