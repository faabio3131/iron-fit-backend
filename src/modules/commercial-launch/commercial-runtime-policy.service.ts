import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CommercialLaunchService } from './commercial-launch.service';

export interface RuntimeTrialPolicy {
  matrixId: string;
  matrixVersion: number;
  snapshotHash: string;
  trialPlanVersionId: string;
  trialDays: number;
}

export interface RuntimeBillingPolicy {
  matrixId: string;
  matrixVersion: number;
  snapshotHash: string;
  launchPriceIds: ReadonlySet<string>;
  invoiceDueDays: number;
  dunningGraceDays: number;
  upgradePolicy: 'IMMEDIATE_PRORATED';
  downgradePolicy: 'NEXT_PERIOD_NO_IMMEDIATE_REFUND';
  cancellationPolicy: 'IMMEDIATE_OR_PERIOD_END';
  refundPolicy: 'SUPER_ADMIN_MANUAL';
  fiscalMode: 'PROVIDER_NFSE' | 'EXTERNAL_HANDOFF' | 'OUT';
}

@Injectable()
export class CommercialRuntimePolicyService {
  constructor(private readonly launch: CommercialLaunchService) {}

  private async approved() {
    return this.launch.currentApproved();
  }

  async trialPolicy(): Promise<RuntimeTrialPolicy> {
    const current = await this.approved();
    const policy = current.policy;

    if (
      !policy ||
      policy.trialEnabled !== true ||
      typeof policy.trialPlanVersionId !== 'string' ||
      !policy.trialPlanVersionId ||
      !Number.isInteger(policy.trialDays) ||
      (policy.trialDays ?? 0) < 1 ||
      (policy.trialDays ?? 0) > 90
    ) {
      throw new ServiceUnavailableException(
        'Trial comercial nao habilitado/configurado na Launch Matrix APPROVED',
      );
    }

    return {
      matrixId: current.id,
      matrixVersion: current.version,
      snapshotHash: current.snapshotHash,
      trialPlanVersionId: policy.trialPlanVersionId,
      trialDays: policy.trialDays,
    };
  }

  async billingPolicy(): Promise<RuntimeBillingPolicy> {
    const current = await this.approved();
    const policy = current.policy;

    if (
      !policy ||
      !Number.isInteger(policy.invoiceDueDays) ||
      (policy.invoiceDueDays ?? -1) < 0 ||
      (policy.invoiceDueDays ?? 31) > 30 ||
      !Number.isInteger(policy.dunningGraceDays) ||
      (policy.dunningGraceDays ?? 0) < 1 ||
      (policy.dunningGraceDays ?? 31) > 30 ||
      policy.upgradePolicy !== 'IMMEDIATE_PRORATED' ||
      policy.downgradePolicy !== 'NEXT_PERIOD_NO_IMMEDIATE_REFUND' ||
      policy.cancellationPolicy !== 'IMMEDIATE_OR_PERIOD_END' ||
      policy.refundPolicy !== 'SUPER_ADMIN_MANUAL' ||
      !['PROVIDER_NFSE', 'EXTERNAL_HANDOFF', 'OUT'].includes(
        policy.fiscalMode as string,
      )
    ) {
      throw new ServiceUnavailableException(
        'Politica de billing incompleta/incompativel na Launch Matrix APPROVED',
      );
    }

    const launchPriceIds = new Set(
      current.offerings.map((offering) => offering.priceId),
    );
    if (launchPriceIds.size === 0) {
      throw new ServiceUnavailableException(
        'Launch Matrix APPROVED sem offering vendavel',
      );
    }

    return {
      matrixId: current.id,
      matrixVersion: current.version,
      snapshotHash: current.snapshotHash,
      launchPriceIds,
      invoiceDueDays: policy.invoiceDueDays,
      dunningGraceDays: policy.dunningGraceDays,
      upgradePolicy: policy.upgradePolicy,
      downgradePolicy: policy.downgradePolicy,
      cancellationPolicy: policy.cancellationPolicy,
      refundPolicy: policy.refundPolicy,
      fiscalMode: policy.fiscalMode as
        | 'PROVIDER_NFSE'
        | 'EXTERNAL_HANDOFF'
        | 'OUT',
    };
  }
}
