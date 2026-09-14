export const IRON_FISCAL_CONTRACT_VERSION = 'v1' as const;
export const IRON_FISCAL_HOST_NAMESPACE = 'fm.iron' as const;
export const IRON_FISCAL_PACK_ID = 'iron' as const;
export const IRON_FISCAL_DOCUMENT_KIND = 'nfse' as const;
export const IRON_FISCAL_CAPABILITIES_PATH = '/v1/capabilities/query' as const;
export const IRON_FISCAL_ISSUANCE_PATH = '/v1/issuances' as const;
export const IRON_FISCAL_HANDOFF_STATE = 'PENDING_CAPABILITY' as const;

export type IronFiscalHandoffInput = {
  gymId: string;
  chargeId: string;
  transactionId: string;
  studentId: string;
  subscriptionId?: string | null;
  amount: number;
  paidAt: Date | null;
  paymentMethod?: string | null;
};

/**
 * Maps an authoritative paid Iron Fit charge to the certified FM Fiscal contract.
 *
 * This object is deliberately a handoff candidate, not an issuance command. Iron
 * Fit owns the commercial fact (a settled charge); FM Fiscal Core remains the
 * authority for tenant/unit binding, jurisdiction support, readiness, tax rules
 * and document issuance. A dispatcher MUST resolve the fiscal binding and query
 * capabilities before using the issuance endpoint.
 */
export function buildIronFiscalHandoff(input: IronFiscalHandoffInput) {
  const recurring = Boolean(input.subscriptionId);

  return {
    contractVersion: IRON_FISCAL_CONTRACT_VERSION,
    hostNamespace: IRON_FISCAL_HOST_NAMESPACE,
    packId: IRON_FISCAL_PACK_ID,
    useCaseId: recurring ? 'recurring-membership-billing' : 'membership-billing',
    operationKind: recurring ? 'recurring_charge' : 'membership',
    documentKind: IRON_FISCAL_DOCUMENT_KIND,
    state: IRON_FISCAL_HANDOFF_STATE,
    capabilitiesPath: IRON_FISCAL_CAPABILITIES_PATH,
    issuancePath: IRON_FISCAL_ISSUANCE_PATH,
    readinessRequiredBeforeIssuance: true,
    fiscalScopeBindingRequired: true,
    idempotencyKey: `iron:charge:${input.chargeId}:nfse:v1`,
    source: {
      gymId: input.gymId,
      chargeId: input.chargeId,
      transactionId: input.transactionId,
      studentId: input.studentId,
      subscriptionId: input.subscriptionId ?? null,
      amountMinor: input.amount,
      paidAt: input.paidAt?.toISOString() ?? null,
      paymentMethod: input.paymentMethod ?? null,
    },
  } as const;
}
