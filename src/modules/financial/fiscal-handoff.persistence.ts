import {
  ConflictException,
} from '@nestjs/common';
import {
  FiscalHandoffStatus,
  Prisma,
} from '@prisma/client';
import {
  buildIronFiscalHandoff,
  IronFiscalHandoffInput,
} from './iron-fiscal-handoff';

function sameNullableDate(
  left: Date | null,
  rightIso: string | null,
): boolean {
  return (left?.toISOString() ?? null) === rightIso;
}

export async function materializeIronFiscalHandoff(
  tx: Prisma.TransactionClient,
  input: IronFiscalHandoffInput,
) {
  const contract = buildIronFiscalHandoff(input);
  const expected = {
    gymId: contract.source.gymId,
    chargeId: contract.source.chargeId,
    transactionId: contract.source.transactionId,
    idempotencyKey: contract.idempotencyKey,
    contractVersion: contract.contractVersion,
    hostNamespace: contract.hostNamespace,
    packId: contract.packId,
    useCaseId: contract.useCaseId,
    operationKind: contract.operationKind,
    documentKind: contract.documentKind,
    amountMinor: contract.source.amountMinor,
    currency: 'BRL',
    paymentMethod: contract.source.paymentMethod,
    settledAt: contract.source.paidAt
      ? new Date(contract.source.paidAt)
      : null,
  } as const;

  const existing = await tx.fiscalHandoff.findUnique({
    where: { chargeId: expected.chargeId },
  });

  if (existing) {
    const immutableMatches =
      existing.gymId === expected.gymId &&
      existing.transactionId === expected.transactionId &&
      existing.idempotencyKey === expected.idempotencyKey &&
      existing.contractVersion === expected.contractVersion &&
      existing.hostNamespace === expected.hostNamespace &&
      existing.packId === expected.packId &&
      existing.useCaseId === expected.useCaseId &&
      existing.operationKind === expected.operationKind &&
      existing.documentKind === expected.documentKind &&
      existing.amountMinor === expected.amountMinor &&
      existing.currency === expected.currency &&
      existing.paymentMethod === expected.paymentMethod &&
      sameNullableDate(existing.settledAt, contract.source.paidAt);

    if (!immutableMatches) {
      throw new ConflictException(
        'Handoff fiscal existente diverge do fato financeiro canonico',
      );
    }

    return {
      contract,
      record: existing,
      idempotent: true,
    };
  }

  const record = await tx.fiscalHandoff.create({
    data: {
      ...expected,
      status: FiscalHandoffStatus.PENDING_CAPABILITY,
    },
  });

  return {
    contract,
    record,
    idempotent: false,
  };
}
