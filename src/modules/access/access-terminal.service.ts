import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessService } from './access.service';
import { accessMembershipDenial } from './access-membership';
import { TerminalCheckInDto } from './dto/terminal-check-in.dto';

@Injectable()
export class AccessTerminalService {
  constructor(private readonly db: PrismaService, private readonly access: AccessService) {
  }

  private async authorize(tx: Prisma.TransactionClient, gymId: string, actor: string, roles: string[]) {
    if (!gymId || !actor) throw new ForbiddenException('Academia e operador autenticados obrigatorios');
    const membership = await tx.userRole.findFirst({ where: {
      gymId, userId: actor, active: true, user: { active: true }, gym: { active: true },
      role: { name: { in: roles } },
    } });
    if (!membership) throw new ForbiddenException('Operacao de acesso nao autorizada');
  }

  private async atomic<T>(action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2034', 'P2002'].includes(error.code)) throw error;
        if (attempt === 2) throw new ConflictException('Operacao concorrente; repita com o mesmo identificador');
      }
    }
    throw new ConflictException('Operacao nao confirmada');
  }

  async checkIn(gymId: string, actor: string, dto: TerminalCheckInDto) {
    if (!!dto.studentId === !!dto.qrToken) throw new BadRequestException('Informe aluno ou QR, exclusivamente');
    const fingerprint = createHash('sha256').update(JSON.stringify([actor, dto.studentId ?? null, dto.qrToken ?? null])).digest('hex');
    return this.atomic(async tx => {
      await this.authorize(tx, gymId, actor, ['OWNER', 'MANAGER', 'RECEPTION']);
      const previous = await tx.accessEvent.findUnique({ where: { gymId_requestId: { gymId, requestId: dto.requestId } } });
      if (previous) {
        if (previous.requestFingerprint !== fingerprint) throw new ConflictException('Identificador ja utilizado para outra operacao');
        return this.response(tx, gymId, previous);
      }
      const now = new Date();
      let studentId = dto.studentId;
      let denial: string | null = null;
      if (dto.qrToken) {
        const credential = await tx.accessCredential.findFirst({
          where: { tokenHash: createHash('sha256').update(dto.qrToken).digest('hex'), student: { gymId } },
          select: { studentId: true, active: true, expiresAt: true },
        });
        if (!credential || !credential.active || (credential.expiresAt && credential.expiresAt <= now)) denial = 'Credencial invalida ou expirada';
        else studentId = credential.studentId;
      }
      const student = studentId ? await tx.student.findFirst({ where: { id: studentId, gymId }, select: { id: true, status: true } }) : null;
      if (!denial && !student) denial = 'Aluno nao encontrado nesta academia';
      if (!denial && student?.status !== 'ACTIVE') denial = 'Matricula inativa';
      if (!denial && student) denial = await accessMembershipDenial(tx, gymId, student.id, now);
      const assessed = !denial && student ? await tx.assessment.findFirst({ where: { studentId: student.id, student: { gymId } }, select: { id: true } }) : null;
      const warning = !denial && !assessed ? 'Avaliacao fisica nao cadastrada' : null;
      const event = await this.access.recordEvent({
        gymId, deviceId: null, studentId: student?.id ?? null, allowed: !denial, denialReason: denial,
        warning, source: 'RECEPTION_TERMINAL', actorUserId: actor, requestId: dto.requestId, requestFingerprint: fingerprint,
      }, tx);
      return this.response(tx, gymId, event);
    });
  }

  private async response(tx: Prisma.TransactionClient, gymId: string, event: { id: string; studentId: string | null; allowed: boolean; denialReason: string | null; warning: string | null; occurredAt: Date }) {
    const student = event.studentId ? await tx.student.findFirst({
      where: { id: event.studentId, gymId },
      select: { id: true, photoUrl: true, user: { select: { name: true } } },
    }) : null;
    return {
      eventId: event.id, allowed: event.allowed, denialReason: event.denialReason, warning: event.warning,
      status: !event.allowed ? 'DENIED' : event.warning ? 'REVIEW' : 'ALLOWED', occurredAt: event.occurredAt,
      student: student ? { id: student.id, name: student.user.name, photoUrl: student.photoUrl } : null,
    };
  }

  async myQr(gymId: string, actor: string) {
    return this.atomic(async tx => {
      await this.authorize(tx, gymId, actor, ['STUDENT']);
      const student = await tx.student.findFirst({ where: { gymId, userId: actor, status: 'ACTIVE' }, select: { id: true } });
      if (!student) throw new NotFoundException('Matricula ativa nao encontrada');
      const now = new Date();
      const recent = await tx.accessCredential.findFirst({
        where: { studentId: student.id, selfService: true, createdAt: { gt: new Date(now.getTime() - 15000) } }, select: { id: true },
      });
      if (recent) throw new TooManyRequestsException('Aguarde 15 segundos para gerar outro QR');
      const expiresAt = new Date(now.getTime() + 120000);
      await tx.accessCredential.updateMany({ where: { studentId: student.id, selfService: true, active: true }, data: { active: false } });
      const credential = await this.access.createCredential({
        studentId: student.id, type: 'QR_CODE', expiresAt: expiresAt.toISOString(),
      }, gymId, actor, tx, true);
      const imageDataUrl = await QRCode.toDataURL(credential.qrToken, { errorCorrectionLevel: 'M', width: 256, margin: 4 });
      return { credentialId: credential.credentialId, imageDataUrl, expiresAt };
    });
  }
}
