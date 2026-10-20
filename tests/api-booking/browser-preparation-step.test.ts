import { describe, expect, it } from 'vitest';
import { preparationStep, starterStepCode } from '../../src/api-booking/browser-preparation-step.js';
import { starterFailureCode } from '../../src/browser.js';
import { safeApiFailureCode } from '../../src/api-booking/run-observability.js';
import { classifyFailure } from '../../src/preparation-failure.js';

describe('browser preparation step codes (2026-10-20 00:53: both workers failed with only API_BROWSER_PREPARATION_FAILED)', () => {
  it('turns an engine message into the step code and keeps the raw text only as the cause', async () => {
    const raw = Error('browserType.connectOverCDP: connect ECONNREFUSED 127.0.0.1:19444 C:\\Users\\someone\\profile');
    const failure = await preparationStep('CDP_ENDPOINT_UNAVAILABLE', async () => { throw raw; }).catch(error => error);
    expect(failure.message).toBe('CDP_ENDPOINT_UNAVAILABLE');
    expect(failure.cause).toBe(raw);
    expect(safeApiFailureCode(failure, 'API_BROWSER_PREPARATION_FAILED')).toBe('CDP_ENDPOINT_UNAVAILABLE');
  });

  it('reports timeouts with the step timeout code and keeps an existing closed code', async () => {
    const timeout = Object.assign(Error('page.goto: Timeout 45000ms exceeded.'), { name: 'TimeoutError' });
    await expect(preparationStep('ONDA_PAGE_NAVIGATION_FAILED', async () => { throw timeout; }, 'ONDA_PAGE_LOAD_TIMEOUT')).rejects.toThrow('ONDA_PAGE_LOAD_TIMEOUT');
    await expect(preparationStep('ONDA_PAGE_NOT_READY', async () => { throw Error('WRONG_VENUE'); })).rejects.toThrow('WRONG_VENUE');
    await expect(preparationStep('ONDA_PAGE_NOT_READY', async () => 7)).resolves.toBe(7);
  });

  it('reads the starter outcome from its printed closed code, never its raw output', () => {
    const wrong = Object.assign(Error('Command failed: powershell.exe -File start-onda-chrome.ps1'),
      { stdout: 'WRONG OR UNVERIFIED CDP SESSION DETECTED. Close the conflicting debug session.\r\nCDP_WRONG_PROFILE\r\n', code: 1 });
    expect(starterStepCode(wrong, starterFailureCode(wrong))).toBe('CDP_WRONG_PROFILE');
    const silent = Object.assign(Error('Command failed: powershell.exe'), { stdout: '', stderr: 'At line:1 char:1 something', code: 1 });
    expect(starterStepCode(silent, starterFailureCode(silent))).toBe('CHROME_START_FAILED');
    const killed = Object.assign(Error('Command failed'), { killed: true, signal: 'SIGTERM' });
    expect(starterStepCode(killed, starterFailureCode(killed))).toBe('CHROME_START_TIMEOUT');
    const printed = Object.assign(Error('Command failed'), { stderr: 'CHROME_START_TIMEOUT' });
    expect(starterStepCode(printed, starterFailureCode(printed))).toBe('CHROME_START_TIMEOUT');
  });

  it('gives every step code an actionable category instead of INTERNAL_ERROR', () => {
    for (const code of ['CDP_ENDPOINT_UNAVAILABLE', 'CHROME_START_FAILED', 'CHROME_START_TIMEOUT', 'CDP_NOT_LISTENING', 'API_BROWSER_CONTEXT_MISSING'])
      expect(classifyFailure(code, { operation: 'prepare', lockPresent: false }).category).toBe('BROWSER_DISCONNECTED');
    for (const code of ['CDP_WRONG_PROFILE', 'CDP_WRONG_PORT', 'CDP_PROCESS_NOT_CHROME'])
      expect(classifyFailure(code, { operation: 'prepare', lockPresent: false }).category).toBe('WRONG_PROFILE');
    for (const code of ['ONDA_TAB_OPEN_FAILED', 'ONDA_PAGE_NAVIGATION_FAILED', 'ONDA_PAGE_LOAD_TIMEOUT', 'ONDA_PAGE_NOT_READY', 'BROWSER_PRESENTATION_FAILED'])
      expect(classifyFailure(code, { operation: 'prepare', lockPresent: false }).category).toBe('INVALID_VENUE_OR_TAB');
  });
});
