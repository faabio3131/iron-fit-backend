import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IntegrationEnvironment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IntegrationRuntimeEnvironmentService } from '../integrations/runtime-environment.service';
import { normalizeTrialCnpj } from '../commercial/trial-cnpj';
import { FiscalBridgeDispatchService } from './fiscal-bridge-dispatch.service';
import { FiscalBridgeHttpTransport } from './fiscal-bridge.contract';

/** Exact NFCore contract for direct-to-Vault delegated enrollment.
 * IRON owns neither A1 bytes/password nor the fiscal issuer/profile authority.
 */
const TOKEN = /^[A-Za-z0-9_-]{40,128}$/;
const DIRECT_UPLOAD_PATH = '/v1/iron/a1/upload';
const TTL_MS = 5 * 60 * 1000;

@Injectable()
export class FiscalA1DelegationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly dispatch: FiscalBridgeDispatchService,
    private readonly http: FiscalBridgeHttpTransport,
    private readonly audit: AuditService,
  ) {}

  private async issuer(gymId: string): Promise<string> {
    const profile = await this.prisma.financialProfile.findUnique({
      where: { gymId }, select: { taxID: true },
    });
    const cnpj = normalizeTrialCnpj(profile?.taxID ?? '');
    if (!cnpj) {
      throw new ConflictException('CNPJ fiscal da academia nao verificado');
    }
    const trial = await this.prisma.commercialTrialProvisioning.findFirst({
      where: { gymId, cnpj: { not: null } }, select: { cnpj: true },
    });
    if (trial?.cnpj && normalizeTrialCnpj(trial.cnpj) !== cnpj) {
      throw new ConflictException('CNPJ diverge do cadastro comercial');
    }
    // NFCore checks this value independently against its ACTIVE fiscal profile.
    return cnpj;
  }

  private async connection(gymId: string) {
    if (this.runtime.current() !== IntegrationEnvironment.HOMOLOG) {
      throw new ServiceUnavailableException(
        'Cadastro A1 delegado permitido apenas em homologacao',
      );
    }
    try {
      return await this.dispatch.resolveBridgeContext(gymId);
    } catch {
      throw new ServiceUnavailableException(
        'Conexao fiscal canônica indisponivel',
      );
    }
  }

  async prepare(gymId: string, actorUserId: string) {
    if (!actorUserId || actorUserId.length > 128) {
      throw new ConflictException('Usuario autorizado invalido');
    }
    const cnpj = await this.issuer(gymId);
    const connection = await this.connection(gymId);
    let response: Record<string, unknown>;
    try {
      response = await this.http.post(
        '/v1/iron/a1/delegations',
        { issuer_cnpj: cnpj, actor_user_id: actorUserId },
        connection.context, randomUUID(),
      );
    } catch {
      throw new ServiceUnavailableException(
        'NFCore nao confirmou a delegacao segura A1',
      );
    }
    const token = response.delegation_token;
    const expires = response.expires_at;
    if (response.status !== 'PENDING_UPLOAD' ||
        response.upload_path !== DIRECT_UPLOAD_PATH ||
        typeof token !== 'string' || !TOKEN.test(token) ||
        typeof expires !== 'string') {
      throw new ServiceUnavailableException('Contrato de delegacao A1 invalido');
    }
    const expiresAt = Date.parse(expires);
    const now = Date.now();
    if (!Number.isFinite(expiresAt) || expiresAt <= now ||
        expiresAt > now + TTL_MS + 30_000) {
      throw new ServiceUnavailableException('Delegacao A1 expirada ou divergente');
    }

    const baseUrl = connection.context.configuration.baseUrl;
    const uploadUrl = new URL(DIRECT_UPLOAD_PATH.replace(/^\//, ''), baseUrl);
    const base = new URL(baseUrl);
    if (uploadUrl.protocol !== 'https:' || uploadUrl.origin !== base.origin ||
        uploadUrl.pathname !== DIRECT_UPLOAD_PATH ||
        uploadUrl.search || uploadUrl.hash) {
      throw new ServiceUnavailableException('Destino de cofre A1 invalido');
    }
    // Deliberately exclude token from audit/event/DB. It is returned only over
    // authenticated TLS to the requesting step-up OWNER, never as a URL query.
    await this.audit.record({
      gymId, userId: actorUserId,
      action: 'FISCAL_A1_DELEGATION_PREPARED',
      entity: 'IntegrationConnection', entityId: connection.connectionId,
      next: { environment: IntegrationEnvironment.HOMOLOG, pendingHumanUpload: true },
    });
    return {
      status: 'PENDING_UPLOAD' as const,
      delegationToken: token,
      expiresAt: new Date(expiresAt).toISOString(),
      uploadUrl: uploadUrl.toString(),
      credentialCustody: 'NFCORE_DIRECT_VAULT' as const,
      officialHomologation: 'NOT_VERIFIED' as const,
    };
  }

  /** Withdrawal removes only the NFCore homologation Vault record. It does not
   * revoke an ICP-Brasil certificate or modify already authorized documents. */
  async withdraw(gymId: string, actorUserId: string, requestId: string) {
    if (!actorUserId || actorUserId.length > 128 ||
        typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new ConflictException('Solicitacao de retirada A1 invalida');
    }
    const cnpj = await this.issuer(gymId);
    const connection = await this.connection(gymId);
    let response: Record<string, unknown>;
    try {
      response = await this.http.post(
        '/v1/iron/a1/withdraw',
        { issuer_cnpj: cnpj, actor_user_id: actorUserId, request_id: requestId.toLowerCase() },
        connection.context, requestId.toLowerCase(),
      );
    } catch {
      // Do not retry a destructive operation on an uncertain network outcome.
      throw new ServiceUnavailableException('Retirada A1 nao confirmada; consulte o cofre antes de nova solicitacao');
    }
    if (response.status !== 'WITHDRAWN' || response.official_revocation !== 'NOT_PERFORMED' ||
        response.official_homologation !== 'NOT_VERIFIED') {
      throw new ServiceUnavailableException('Contrato de retirada A1 invalido');
    }
    await this.audit.record({
      gymId, userId: actorUserId, action: 'FISCAL_A1_VAULT_WITHDRAWN',
      entity: 'IntegrationConnection', entityId: connection.connectionId,
      next: { environment: IntegrationEnvironment.HOMOLOG, requestId: requestId.toLowerCase(), officialRevocation: 'NOT_PERFORMED' },
    });
    return {
      status: 'WITHDRAWN' as const,
      officialRevocation: 'NOT_PERFORMED' as const,
      officialHomologation: 'NOT_VERIFIED' as const,
    };
  }

  async status(gymId: string) {
    const cnpj = await this.issuer(gymId);
    const connection = await this.connection(gymId);
    let response: Record<string, unknown>;
    try {
      response = await this.http.post(
        '/v1/iron/a1/status', { issuer_cnpj: cnpj },
        connection.context, randomUUID(),
      );
    } catch {
      throw new ServiceUnavailableException('Leitura A1 no NFCore indisponivel');
    }
    const expires = response.expires_at;
    if ((response.status !== 'STORED' && response.status !== 'ABSENT') ||
        response.official_homologation !== 'NOT_VERIFIED' ||
        (response.status === 'STORED' &&
          (typeof expires !== 'string' || !Number.isFinite(Date.parse(expires)))) ||
        (response.status === 'ABSENT' && expires !== null)) {
      throw new ServiceUnavailableException('Readback fiscal A1 inconsistente');
    }
    return {
      status: response.status,
      expiresAt: response.status === 'STORED' ? expires : null,
      source: 'NFCORE_VAULT_READBACK' as const,
      officialHomologation: 'NOT_VERIFIED' as const,
    };
  }
}
