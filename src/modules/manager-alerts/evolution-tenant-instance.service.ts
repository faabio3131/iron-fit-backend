import { BadGatewayException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EvolutionTenantInstanceStatus,
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationScope,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationRuntimeEnvironmentService } from '../integrations/runtime-environment.service';
import { IntegrationSecretResolverService } from '../integrations/secrets/integration-secret-resolver.service';

const RESPONSE_LIMIT = 2 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

function hasCapability(raw: unknown, capability: string) {
  return Array.isArray(raw) && raw.some((item) => typeof item === 'string' && item.toLowerCase() === capability);
}

@Injectable()
export class EvolutionTenantInstanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly secrets: IntegrationSecretResolverService,
    private readonly audit: AuditService,
  ) {}

  async status(actor: any) {
    const gymId = this.requireGym(actor);
    const binding = await this.prisma.evolutionTenantInstance.findUnique({ where: { gymId } });
    if (!binding) return { configured: false, status: 'DISCONNECTED' };
    const connection = await this.globalConnection(binding.globalConnectionId);
    const payload = await this.request(connection, `instance/connectionState/${encodeURIComponent(binding.instanceName)}`, 'GET');
    const providerState = this.providerState(payload);
    const status = providerState === 'open'
      ? EvolutionTenantInstanceStatus.CONNECTED
      : EvolutionTenantInstanceStatus.DISCONNECTED;
    const updated = await this.prisma.evolutionTenantInstance.update({
      where: { id: binding.id },
      data: {
        status,
        providerState,
        lastStateCheckedAt: new Date(),
        ...(status === EvolutionTenantInstanceStatus.CONNECTED ? { connectedAt: new Date() } : { disconnectedAt: new Date() }),
      },
      select: { status: true, providerState: true, lastStateCheckedAt: true, connectedAt: true },
    });
    return { configured: true, ...updated };
  }

  async connect(actor: any) {
    const gymId = this.requireGym(actor);
    let binding = await this.prisma.evolutionTenantInstance.findUnique({ where: { gymId } });
    let createPayload: Record<string, unknown> | null = null;
    if (!binding) {
      const connection = await this.requireSingleGlobalConnection();
      const instanceName = `iron-${gymId.replace(/-/g, '').slice(0, 24)}`;
      try {
        createPayload = await this.request(connection, 'instance/create', 'POST', {
          instanceName,
          integration: 'WHATSAPP-BAILEYS',
          qrcode: true,
          syncFullHistory: false,
          groupsIgnore: true,
          readMessages: false,
          readStatus: false,
        });
      } catch (error) {
        // Crash-safe recovery: only adopt the deterministic tenant name if the
        // same central connection confirms that exact instance is reachable.
        await this.request(connection, `instance/connectionState/${encodeURIComponent(instanceName)}`, 'GET');
      }
      binding = await this.prisma.evolutionTenantInstance.upsert({
        where: { gymId },
        create: {
          gymId,
          globalConnectionId: connection.id,
          instanceName,
          status: EvolutionTenantInstanceStatus.QR_PENDING,
          createdByUserId: actor.id,
        },
        update: {},
      });
      await this.audit.record({ gymId, userId: actor.id, action: 'EVOLUTION_TENANT_INSTANCE_PROVISIONED', entity: 'EvolutionTenantInstance', entityId: binding.id, next: { instanceName, status: binding.status } });
    }

    const connection = await this.globalConnection(binding.globalConnectionId);
    const payload = createPayload ?? await this.request(connection, `instance/connect/${encodeURIComponent(binding.instanceName)}`, 'GET');
    const qr = this.qrPayload(payload);
    await this.prisma.evolutionTenantInstance.update({
      where: { id: binding.id },
      data: { status: EvolutionTenantInstanceStatus.QR_PENDING, providerState: 'connecting', lastStateCheckedAt: new Date() },
    });
    await this.audit.record({ gymId, userId: actor.id, action: 'EVOLUTION_QR_REQUESTED', entity: 'EvolutionTenantInstance', entityId: binding.id });
    return { configured: true, status: 'QR_PENDING', qr, expiresInSeconds: 60 };
  }

  async disconnect(actor: any) {
    const gymId = this.requireGym(actor);
    const binding = await this.prisma.evolutionTenantInstance.findUnique({ where: { gymId } });
    if (!binding) throw new NotFoundException('Instancia Evolution nao configurada');
    const connection = await this.globalConnection(binding.globalConnectionId);
    await this.request(connection, `instance/logout/${encodeURIComponent(binding.instanceName)}`, 'DELETE');
    await this.prisma.evolutionTenantInstance.update({
      where: { id: binding.id },
      data: { status: EvolutionTenantInstanceStatus.DISCONNECTED, providerState: 'close', disconnectedAt: new Date(), lastStateCheckedAt: new Date() },
    });
    await this.audit.record({ gymId, userId: actor.id, action: 'EVOLUTION_TENANT_INSTANCE_LOGGED_OUT', entity: 'EvolutionTenantInstance', entityId: binding.id });
    return { configured: true, status: 'DISCONNECTED' };
  }

  async handleWebhook(authorization: string | undefined, payload: Record<string, unknown>) {
    const instanceName = this.webhookInstanceName(payload);
    const binding = await this.prisma.evolutionTenantInstance.findUnique({ where: { instanceName } });
    if (!binding) throw new ForbiddenException('Webhook nao autorizado');
    const connection = await this.globalConnection(binding.globalConnectionId);
    const credential = await this.secrets.resolveForExternalBoundary(connection.id, { scope: 'GLOBAL' });
    const expected = `Bearer ${credential.reveal()}`;
    const received = authorization ?? '';
    const valid = expected.length === received.length && timingSafeEqual(Buffer.from(expected), Buffer.from(received));
    if (!valid) throw new ForbiddenException('Webhook nao autorizado');

    const event = typeof payload.event === 'string' ? payload.event.toUpperCase() : '';
    if (event.includes('CONNECTION')) {
      const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
      const rawState = typeof data.state === 'string' ? data.state : typeof data.statusReason === 'string' ? data.statusReason : 'unknown';
      const providerState = rawState.toLowerCase().slice(0, 40);
      const connected = providerState === 'open';
      await this.prisma.evolutionTenantInstance.update({
        where: { id: binding.id },
        data: {
          status: connected ? EvolutionTenantInstanceStatus.CONNECTED : EvolutionTenantInstanceStatus.DISCONNECTED,
          providerState,
          lastStateCheckedAt: new Date(),
          ...(connected ? { connectedAt: new Date() } : { disconnectedAt: new Date() }),
        },
      });
    }
    return { accepted: true };
  }

  private requireGym(actor: any) {
    const gymId = actor?.activeGymId ?? actor?.gymId;
    if (!gymId) throw new ForbiddenException('Selecione uma academia para configurar WhatsApp.');
    return gymId as string;
  }

  private async requireSingleGlobalConnection() {
    const candidates = await this.prisma.integrationConnection.findMany({
      where: {
        scope: IntegrationScope.GLOBAL,
        gymId: null,
        providerCode: 'evolution',
        environment: this.runtime.current() as IntegrationEnvironment,
        status: IntegrationConnectionStatus.ACTIVE,
        secretReference: { not: null },
        secretVersion: { not: null },
        secretRevokedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
    });
    const capable = candidates.filter((item) => hasCapability(item.capabilities, 'evolution.whatsapp'));
    if (capable.length !== 1) throw new BadGatewayException(capable.length ? 'Conexao Evolution global ambigua' : 'Conexao Evolution global indisponivel');
    return capable[0];
  }

  private async globalConnection(id: string) {
    const connection = await this.prisma.integrationConnection.findFirst({
      where: {
        id,
        scope: IntegrationScope.GLOBAL,
        gymId: null,
        providerCode: 'evolution',
        environment: this.runtime.current() as IntegrationEnvironment,
        status: IntegrationConnectionStatus.ACTIVE,
      },
    });
    if (!connection) throw new BadGatewayException('Conexao Evolution global indisponivel');
    return connection;
  }

  private baseUrl(configuration: unknown) {
    const raw = configuration && typeof configuration === 'object' && !Array.isArray(configuration)
      ? (configuration as Record<string, unknown>).baseUrl
      : null;
    if (typeof raw !== 'string') throw new BadGatewayException('baseUrl global da Evolution ausente');
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new BadGatewayException('baseUrl global da Evolution deve usar HTTPS');
    return url;
  }

  private async request(connection: any, path: string, method: string, body?: Record<string, unknown>) {
    const credential = await this.secrets.resolveForExternalBoundary(connection.id, { scope: 'GLOBAL' });
    const endpoint = new URL(path, this.baseUrl(connection.publicConfiguration).toString().replace(/\/?$/, '/'));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const requestBody = body && path === 'instance/create'
        ? { ...body, webhook: this.webhookConfiguration(connection.publicConfiguration, credential.reveal()) }
        : body;
      const response = await fetch(endpoint, {
        method,
        headers: { apikey: credential.reveal(), accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: requestBody ? JSON.stringify(requestBody) : undefined,
        redirect: 'error',
        signal: controller.signal,
      });
      const raw = await response.text();
      if (Buffer.byteLength(raw) > RESPONSE_LIMIT) throw new BadGatewayException('Resposta da Evolution excedeu o limite');
      let payload: Record<string, unknown> = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new BadGatewayException('Resposta invalida da Evolution'); }
      if (!response.ok) throw new BadGatewayException(`Evolution respondeu HTTP ${response.status}`);
      return payload;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('Evolution indisponivel ou timeout');
    } finally {
      clearTimeout(timeout);
    }
  }

  private providerState(payload: Record<string, unknown>) {
    const instance = payload.instance && typeof payload.instance === 'object' ? payload.instance as Record<string, unknown> : {};
    const value = instance.state;
    return typeof value === 'string' && value.length <= 40 ? value.toLowerCase() : 'unknown';
  }

  private webhookConfiguration(configuration: unknown, token: string) {
    const raw = configuration && typeof configuration === 'object' && !Array.isArray(configuration)
      ? (configuration as Record<string, unknown>).webhookUrl
      : null;
    if (typeof raw !== 'string') throw new BadGatewayException('webhookUrl global da Evolution ausente');
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new BadGatewayException('webhookUrl global da Evolution deve usar HTTPS');
    return {
      url: url.toString(),
      byEvents: true,
      base64: false,
      headers: { authorization: `Bearer ${token}` },
      events: ['CONNECTION_UPDATE', 'QRCODE_UPDATED', 'MESSAGES_UPSERT'],
    };
  }

  private webhookInstanceName(payload: Record<string, unknown>) {
    if (typeof payload.instance === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(payload.instance)) return payload.instance;
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
    if (typeof data.instanceName === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(data.instanceName)) return data.instanceName;
    throw new ForbiddenException('Webhook nao autorizado');
  }

  private qrPayload(payload: Record<string, unknown>) {
    const nested = payload.qrcode && typeof payload.qrcode === 'object' ? payload.qrcode as Record<string, unknown> : payload;
    const take = (key: string, max: number) => typeof nested[key] === 'string' && (nested[key] as string).length <= max ? nested[key] as string : undefined;
    const qr = { code: take('code', 8192), base64: take('base64', RESPONSE_LIMIT), pairingCode: take('pairingCode', 128) };
    if (!qr.code && !qr.base64 && !qr.pairingCode) throw new BadGatewayException('Evolution nao retornou QR Code');
    return qr;
  }
}
