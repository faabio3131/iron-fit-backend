import { Injectable } from '@nestjs/common';
import { ManagerAlertCategory, ManagerAlertSeverity } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ManagerAlertsService } from './manager-alerts.service';

export interface ManagerAlertDomainEvent {
  gymId: string;
  eventId: string;
  resourceId?: string;
  resourceType?: string;
  occurredAt?: Date;
  summary?: string;
}

@Injectable()
export class ManagerAlertProducersService {
  constructor(private readonly alerts: ManagerAlertsService) {}

  overdueStudentCharge(event: ManagerAlertDomainEvent) {
    return this.emit(event, 'charge.overdue', ManagerAlertCategory.STUDENT_BILLING, ManagerAlertSeverity.WARNING, 'Cobrança de aluno vencida', 'Há uma cobrança vencida que requer análise.', 'Charge');
  }

  attendanceRisk(event: ManagerAlertDomainEvent) {
    return this.emit(event, 'attendance.risk', ManagerAlertCategory.ATTENDANCE_RISK, ManagerAlertSeverity.WARNING, 'Queda de frequência identificada', 'Um aluno apresenta queda de frequência e possível risco de cancelamento.', 'Student');
  }

  assessmentOrWorkoutPending(event: ManagerAlertDomainEvent) {
    return this.emit(event, 'workout.review.pending', ManagerAlertCategory.ASSESSMENT_WORKOUT, ManagerAlertSeverity.INFO, 'Avaliação ou treino pendente', 'Há uma avaliação ou treino aguardando ação da equipe.', 'Workout');
  }

  equipmentProblem(event: ManagerAlertDomainEvent) {
    return this.emit(event, 'equipment.problem', ManagerAlertCategory.EQUIPMENT, ManagerAlertSeverity.WARNING, 'Equipamento requer atenção', 'Um equipamento foi sinalizado com problema operacional.', 'Equipment');
  }

  deliveryFailure(event: ManagerAlertDomainEvent) {
    return this.emit(event, 'delivery.failed', ManagerAlertCategory.DELIVERY_FAILURE, ManagerAlertSeverity.WARNING, 'Falha de entrega ou pagamento', 'Uma operação externa falhou e requer acompanhamento.', 'Delivery');
  }

  paymentFailure(event: ManagerAlertDomainEvent) {
    // Financial content stays OWNER-only through the canonical category policy.
    return this.emit(event, 'charge.payment.failed', ManagerAlertCategory.STUDENT_BILLING, ManagerAlertSeverity.WARNING, 'Falha no pagamento de aluno', 'Uma cobrança de aluno apresentou falha de pagamento e requer análise.', 'Charge');
  }

  integrationDegraded(event: ManagerAlertDomainEvent) {
    return this.emit(event, 'integration.degraded', ManagerAlertCategory.INTEGRATION_HEALTH, ManagerAlertSeverity.CRITICAL, 'Integração indisponível', 'Uma integração da academia está desconectada ou degradada.', 'IntegrationConnection');
  }

  planLimitNear(event: ManagerAlertDomainEvent) {
    return this.emit(event, 'plan.limit.near', ManagerAlertCategory.PLAN_LIMIT, ManagerAlertSeverity.WARNING, 'Limite do plano próximo', 'O consumo de um recurso está próximo do limite contratado.', 'TenantProductSubscription');
  }

  suspiciousAccess(event: ManagerAlertDomainEvent) {
    return this.emit(event, 'security.access.suspicious', ManagerAlertCategory.SECURITY, ManagerAlertSeverity.CRITICAL, 'Tentativa de acesso suspeita', 'Foi detectado um evento de acesso que requer verificação do proprietário.', 'SecurityEvent');
  }

  operationalIncident(event: ManagerAlertDomainEvent) {
    return this.emit(event, 'operations.incident', ManagerAlertCategory.OPERATIONAL_INCIDENT, ManagerAlertSeverity.CRITICAL, 'Incidente operacional', 'Um incidente operacional requer acompanhamento dos gestores.', 'OperationalIncident');
  }

  humanApprovalPending(event: ManagerAlertDomainEvent) {
    return this.emit(event, 'approval.human.pending', ManagerAlertCategory.HUMAN_APPROVAL, ManagerAlertSeverity.INFO, 'Aprovação humana pendente', 'Há um candidato gerado por IA aguardando decisão humana.', 'ApprovalCandidate');
  }

  criticalEscalation(event: ManagerAlertDomainEvent, category: ManagerAlertCategory) {
    return this.emit(event, 'manager.alert.escalated', category, ManagerAlertSeverity.CRITICAL, 'Alerta crítico aguarda acompanhamento', 'Um alerta crítico permanece sem reconhecimento e atingiu o prazo de escalação configurado pela academia.', 'ManagerAlert');
  }

  private emit(
    event: ManagerAlertDomainEvent,
    eventKey: string,
    category: ManagerAlertCategory,
    severity: ManagerAlertSeverity,
    title: string,
    fallbackMessage: string,
    resourceType: string,
  ) {
    const digest = createHash('sha256')
      .update(`${eventKey}:${event.eventId}`)
      .digest('hex');
    return this.alerts.ingest({
      gymId: event.gymId,
      eventKey,
      deduplicationKey: `${eventKey}:${digest}`,
      category,
      severity,
      title,
      message: event.summary?.trim().slice(0, 500) || fallbackMessage,
      resourceType: event.resourceType ?? resourceType,
      resourceId: event.resourceId,
      occurredAt: event.occurredAt,
    });
  }
}
