import { ServiceUnavailableException } from '@nestjs/common';
import { FM_FISCAL_SCHEMA_VERSION } from './fiscal-bridge.contract';

export interface FiscalHandoffPayloadSource {
  contractVersion: string;
  hostNamespace: string;
  packId: string;
  useCaseId: string;
  operationKind: string;
  documentKind: string;
  chargeId: string;
  transactionId: string;
  amountMinor: number;
  paymentMethod: string | null;
  settledAt: Date | null;
}

function money(amountMinor: number) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new ServiceUnavailableException(
      'Fiscal handoff possui amountMinor invalido',
    );
  }
  return {
    amount: (amountMinor / 100).toFixed(2),
    currency: 'BRL',
  } as const;
}

function paymentMethod(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || value.length > 64) {
    throw new ServiceUnavailableException(
      'Fiscal handoff sem paymentMethod valido',
    );
  }
  return value;
}

export function assertCanonicalFiscalHandoff(
  row: FiscalHandoffPayloadSource,
) {
  if (
    row.hostNamespace !== 'fm.iron' ||
    row.packId !== 'iron' ||
    row.documentKind !== 'nfse' ||
    row.contractVersion !== 'v1'
  ) {
    throw new ServiceUnavailableException(
      'Fiscal handoff diverge do contrato IRON certificado',
    );
  }
  if (
    row.operationKind !== 'membership' &&
    row.operationKind !== 'recurring_charge'
  ) {
    throw new ServiceUnavailableException(
      'Fiscal handoff possui operationKind nao suportado',
    );
  }
  if (!(row.settledAt instanceof Date)) {
    throw new ServiceUnavailableException(
      'Fiscal handoff sem settlement autoritativo',
    );
  }
}

export function buildFiscalOperation(
  row: FiscalHandoffPayloadSource,
) {
  assertCanonicalFiscalHandoff(row);
  const amount = money(row.amountMinor);
  const method = paymentMethod(row.paymentMethod);
  const settledAt = row.settledAt!.toISOString();

  return {
    operation_reference: {
      type: 'iron_charge',
      id: row.chargeId,
    },
    operation_kind: row.operationKind,
    occurred_at: settledAt,
    settled_at: settledAt,
    totals: {
      gross_amount: amount,
      discount_amount: {
        amount: '0.00',
        currency: 'BRL',
      },
      surcharge_amount: {
        amount: '0.00',
        currency: 'BRL',
      },
      net_amount: amount,
    },
    payments: [
      {
        method,
        amount,
        reference: row.transactionId,
      },
    ],
    change_amount: {
      amount: '0.00',
      currency: 'BRL',
    },
  };
}

export function buildFiscalIssuanceRequest(
  row: FiscalHandoffPayloadSource,
) {
  const operation = buildFiscalOperation(row);
  const amount = money(row.amountMinor);

  return {
    contract_version: FM_FISCAL_SCHEMA_VERSION,
    operation,
    document: {
      kind: 'nfse',
      items: [
        {
          line_id: row.chargeId,
          item_reference: {
            type: 'iron_membership',
            id: row.chargeId,
          },
          description:
            row.operationKind === 'recurring_charge'
              ? 'IRON recurring membership charge'
              : 'IRON membership charge',
          quantity: '1',
          unit_price: amount,
          discount_amount: {
            amount: '0.00',
            currency: 'BRL',
          },
          surcharge_amount: {
            amount: '0.00',
            currency: 'BRL',
          },
        },
      ],
    },
  };
}
