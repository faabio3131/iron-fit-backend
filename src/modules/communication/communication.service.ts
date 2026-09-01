import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { CreateAutomationDto } from './dto/create-automation.dto';

@Injectable()
export class CommunicationService {
  constructor(private prisma: PrismaService) {}

  async createTemplate(dto: CreateTemplateDto, userGymId?: string) {
    const gymId = dto.gymId || userGymId;

    if (!gymId) {
      throw new NotFoundException('Academia nao informada');
    }

    return this.prisma.communicationTemplate.create({
      data: {
        gymId,
        name: dto.name,
        channel: dto.channel as any,
        title: dto.title,
        body: dto.body,
        variables: dto.variables,
      } as any,
    });
  }

  async findAllTemplates(userGymId?: string) {
    return this.prisma.communicationTemplate.findMany({
      where: {
        ...(userGymId ? { gymId: userGymId } : {}),
        active: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async sendMessage(dto: SendMessageDto, userGymId?: string) {
    const student = await this.prisma.student.findFirst({
      where: {
        id: dto.studentId,
        ...(userGymId ? { gymId: userGymId } : {}),
      },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    return this.prisma.communicationMessage.create({
      data: {
        gymId: student.gymId,
        studentId: dto.studentId,
        templateId: dto.templateId,
        channel: dto.channel as any,
        title: dto.title,
        body: dto.body,
        status: 'QUEUED',
      } as any,
    });
  }

  async findAllMessages(userGymId?: string) {
    return this.prisma.communicationMessage.findMany({
      where: userGymId ? { gymId: userGymId } : {},
      include: {
        student: { include: { user: true } },
        template: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAutomation(dto: CreateAutomationDto, userGymId?: string) {
    const gymId = dto.gymId || userGymId;

    if (!gymId) {
      throw new NotFoundException('Academia nao informada');
    }

    return this.prisma.communicationAutomation.create({
      data: {
        gymId,
        name: dto.name,
        triggerEvent: dto.triggerEvent,
        conditions: dto.conditions,
        actions: dto.actions,
      } as any,
    });
  }

  async findAllAutomations(userGymId?: string) {
    return this.prisma.communicationAutomation.findMany({
      where: {
        ...(userGymId ? { gymId: userGymId } : {}),
        active: true,
      },
      orderBy: { name: 'asc' },
    });
  }
}
