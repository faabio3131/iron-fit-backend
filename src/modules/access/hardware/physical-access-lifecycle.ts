/**
 * Physical access lifecycle separate from the existing AccessEvent decision.
 * A positive decision or an accepted open command MUST NOT count as attendance.
 * Persistence of these transitions requires a dedicated migration and worker.
 */
export type PhysicalAccessState =
  | 'REQUESTED'
  | 'DENIED'
  | 'AUTHORIZED'
  | 'RELEASE_IN_FLIGHT'
  | 'RELEASE_UNCERTAIN'
  | 'COMMAND_ACCEPTED'
  | 'PASSAGE_CONFIRMED'
  | 'PASSAGE_NOT_CONFIRMED'
  | 'EXPIRED';

export type PhysicalAccessAction =
  | 'DENY'
  | 'AUTHORIZE'
  | 'RESERVE_RELEASE'
  | 'ACK_RELEASE'
  | 'UNKNOWN_RELEASE'
  | 'CONFIRM_PASSAGE'
  | 'REJECT_PASSAGE'
  | 'EXPIRE';

const transitions: Record<PhysicalAccessState, Partial<Record<PhysicalAccessAction, PhysicalAccessState>>> = {
  REQUESTED: { DENY: 'DENIED', AUTHORIZE: 'AUTHORIZED', EXPIRE: 'EXPIRED' },
  DENIED: {},
  AUTHORIZED: { RESERVE_RELEASE: 'RELEASE_IN_FLIGHT', EXPIRE: 'EXPIRED' },
  RELEASE_IN_FLIGHT: { ACK_RELEASE: 'COMMAND_ACCEPTED', UNKNOWN_RELEASE: 'RELEASE_UNCERTAIN' },
  RELEASE_UNCERTAIN: {},
  COMMAND_ACCEPTED: { CONFIRM_PASSAGE: 'PASSAGE_CONFIRMED', REJECT_PASSAGE: 'PASSAGE_NOT_CONFIRMED', EXPIRE: 'EXPIRED' },
  PASSAGE_CONFIRMED: {},
  PASSAGE_NOT_CONFIRMED: {},
  EXPIRED: {},
};

export function nextPhysicalAccessState(
  state: PhysicalAccessState,
  action: PhysicalAccessAction,
): PhysicalAccessState {
  const next = transitions[state]?.[action];
  if (!next) {
    throw new Error(`Transicao de acesso fisico invalida: ${state} -> ${action}`);
  }
  return next;
}

export function isVerifiedPhysicalPresence(state: PhysicalAccessState): boolean {
  return state === 'PASSAGE_CONFIRMED';
}

export function isTerminalPhysicalAccessState(state: PhysicalAccessState): boolean {
  return ['DENIED', 'PASSAGE_CONFIRMED', 'PASSAGE_NOT_CONFIRMED', 'EXPIRED', 'RELEASE_UNCERTAIN'].includes(state);
}
