import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { CreateAutomationDto } from './dto/create-automation.dto';

@Injectable()
export class CommunicationService {
  constructor(private prisma: PrismaService) {}

  async createTemplate(dto: CreateTemplateDto, gymId: string) {
    const gym = await this.prisma.gym.findFirst({
      where: { id: gymId, active: true },
    });

    if (!gym) {
      throw new NotFoundException('Academia nao encontrada');
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

  async findAllTemplates(gymId: string) {
    return this.prisma.communicationTemplate.findMany({
      where: { gymId, active: true },
      orderBy: { name: 'asc' },
    });
  }

  async sendMessage(dto: SendMessageDto, gymId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, gymId },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    if (dto.templateId) {
      const template = await this.prisma.communicationTemplate.findFirst({
        where: { id: dto.templateId, gymId, active: true },
      });

      if (!template) {
        throw new NotFoundException('Template nao encontrado');
      }
    }

    return this.prisma.communicationMessage.create({
      data: {
        gymId,
        studentId: dto.studentId,
        templateId: dto.templateId,
        channel: dto.channel as any,
        title: dto.title,
        body: dto.body,
        status: 'QUEUED',
        dispatchKey: randomUUID(),
      } as any,
    });
  }

  async findAllMessages(gymId: string) {
    return this.prisma.communicationMessage.findMany({
      where: { gymId },
      include: {
        student: { include: { user: true } },
        template: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAutomation(dto: CreateAutomationDto, gymId: string) {
    const gym = await this.prisma.gym.findFirst({
      where: { id: gymId, active: true },
    });

    if (!gym) {
      throw new NotFoundException('Academia nao encontrada');
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

  async findAllAutomations(gymId: string) {
    return this.prisma.communicationAutomation.findMany({
      where: { gymId, active: true },
      orderBy: { name: 'asc' },
    });
  }
}
