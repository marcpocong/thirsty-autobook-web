import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { z } from 'zod';
const ResultSchema = z.object({ found: z.number().int().nonnegative(), closed: z.number().int().nonnegative().optional(),
    forced: z.number().int().nonnegative().optional(), code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/) });
async function runScript(root, listOnly) {
    if (process.platform !== 'win32')
        throw Error('WINDOWS_REQUIRED');
    let stdout;
    try {
        ({ stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
            resolve(root, 'scripts/close-bot-chrome.ps1'), ...(listOnly ? ['-ListOnly'] : [])], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 45_000, maxBuffer: 4096 }));
    }
    catch (error) {
        // A timeout still prints its JSON summary before exiting non-zero.
        stdout = String(error.stdout ?? '');
        if (!stdout.trim())
            throw Error('BOT_BROWSER_CLOSE_FAILED');
    }
    const parsed = ResultSchema.safeParse((() => { try {
        return JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? '');
    }
    catch {
        return undefined;
    } })());
    if (!parsed.success)
        throw Error('BOT_BROWSER_CLOSE_FAILED');
    return parsed.data;
}
/** Number of running Chrome browsers whose profile lives in this installation's .local folder. */
export async function countBotBrowsers(root) { return (await runScript(root, true)).found; }
/** Closes only Chrome browsers launched with a bot profile; the user's own Chrome is never matched. */
export async function closeBotBrowsers(root) {
    const result = await runScript(root, false);
    if (result.code !== 'BOT_BROWSERS_CLOSED')
        throw Error(result.code);
    return { found: result.found, closed: result.closed ?? 0, forced: result.forced ?? 0 };
}
//# sourceMappingURL=browser-cleanup.js.map