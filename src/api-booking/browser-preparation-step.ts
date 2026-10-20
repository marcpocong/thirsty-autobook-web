/**
 * Each browser-preparation step reports its own closed code. A Playwright or child-process message never
 * collapses into the generic API_BROWSER_PREPARATION_FAILED (2026-10-20 00:53: both workers failed in
 * 3.96 s and the underlying reason was lost). Raw engine text is kept only as the Error cause, never logged.
 */
const safeCode = /^[A-Z][A-Z0-9_]{0,79}$/;

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || /\btimeout\b.*\bexceeded\b/i.test(error.message));
}

export async function preparationStep<T>(failureCode: string, run: () => Promise<T>, timeoutCode = failureCode): Promise<T> {
  try { return await run(); }
  catch (error) {
    if (error instanceof Error && safeCode.test(error.message)) throw error;
    throw Error(isTimeoutError(error) ? timeoutCode : failureCode, { cause: error });
  }
}

/** A rejected start-onda-chrome.ps1: the closed code it printed, else whether it timed out or failed. */
export function starterStepCode(error: unknown, printed: string | undefined): string {
  if (printed) return printed;
  return (error as { killed?: unknown } | null)?.killed === true ? 'CHROME_START_TIMEOUT' : 'CHROME_START_FAILED';
}
