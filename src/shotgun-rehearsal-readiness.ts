/** Token values never leave the installed browser transport. */
export const REHEARSAL_READY_MAX_AGE_MS = 15_000;
export interface RehearsalSecurityTransport {
  prepareCheckoutContext(forceRefresh?: boolean, reuseWithinMs?: number): Promise<void>;
  preparedContextAgeMs(): number | undefined;
}
export function assertRehearsalSecurityReady(transport: Pick<RehearsalSecurityTransport,'preparedContextAgeMs'>) {
  const age = transport.preparedContextAgeMs();
  if (age === undefined || !Number.isFinite(age) || age < 0 || age > REHEARSAL_READY_MAX_AGE_MS)
    throw Error('REHEARSAL_SECURITY_NOT_READY');
}
/** Genuine bounded acquisition before a rehearsal anchor exists. No reservation imports. */
export async function prepareRehearsalSecurity(transport: RehearsalSecurityTransport, show: () => Promise<void>,
  onState: (state:'PREPARING'|'READY'|'FAILED') => void = () => {}) {
  onState('PREPARING');
  try {
    await show();
    await transport.prepareCheckoutContext();
    assertRehearsalSecurityReady(transport);
    onState('READY');
  } catch (error) { onState('FAILED'); throw error; }
}
/** The dispatcher reuses verified context; a stale context is refused rather than reacquired at its deadline. */
export async function reuseRehearsalSecurity(transport:RehearsalSecurityTransport) {
  assertRehearsalSecurityReady(transport);
  await transport.prepareCheckoutContext(false,20_000);
  assertRehearsalSecurityReady(transport);
}
