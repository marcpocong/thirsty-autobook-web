import { emitUiEvent } from './ui-events.js';
import { DateTime } from 'luxon';
import { loadConfig } from './config.js';
import { Safety } from './safety.js';
import { Telemetry } from './telemetry.js';
import { runDual } from './dual-runtime.js';
import { DualPracticeSchema, practicePair, requireDualFullAuthorization } from './dual-practice.js';
export function parseDualCommand(mode, args) {
    if (!mode || !['readiness', 'dry', 'practice', 'full', 'race:dry'].includes(mode))
        throw Error('MODE_REQUIRED');
    const flags = new Set(['--armed', '--authorize-terms', '--noncompetitive']);
    const values = new Set(mode === 'readiness' || mode === 'race:dry' ? [] : mode === 'dry' ? ['--date'] : ['--date', '--court-a', '--court-b', '--start', '--duration', '--maximum-per-court']);
    const parsed = new Map();
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (parsed.has(arg))
            throw Error('DUPLICATE_ARGUMENT');
        if (flags.has(arg))
            parsed.set(arg, true);
        else if (values.has(arg) && args[i + 1] && !args[i + 1].startsWith('--'))
            parsed.set(arg, args[++i]);
        else
            throw Error('UNKNOWN_ARGUMENT');
    }
    if ((mode === 'race:dry' || mode === 'full') && !parsed.has('--armed'))
        throw Error('ARMED_FLAG_REQUIRED');
    if (mode === 'full' && !parsed.has('--authorize-terms'))
        throw Error('TERMS_AUTHORIZATION_REQUIRED');
    if (mode === 'full' && !parsed.has('--noncompetitive'))
        throw Error('NONCOMPETITIVE_TARGET_REQUIRED');
    if (mode === 'readiness' || mode === 'race:dry')
        return { mode: mode };
    const date = parsed.get('--date');
    if (typeof date !== 'string' || DateTime.fromISO(date).toISODate() !== date)
        throw Error('EXPLICIT_DATE_REQUIRED');
    if (mode === 'dry')
        return { mode: mode, date };
    const input = DualPracticeSchema.parse({ target: { date, court: parsed.get('--court-a'), start: parsed.get('--start'), duration: parsed.get('--duration') },
        courtB: parsed.get('--court-b'), ...(parsed.has('--maximum-per-court') ? { maximum: Number(parsed.get('--maximum-per-court')) } : {}),
        noncompetitive: true, authorizeTerms: parsed.has('--authorize-terms'), armed: parsed.has('--armed') });
    if (mode === 'full')
        requireDualFullAuthorization(input);
    return { mode: mode, date, exact: practicePair(input), maximum: parsed.has('--maximum-per-court') ? input.maximum : undefined, authorizeTerms: input.authorizeTerms };
}
// Keeping parsing importable lets tests exercise authorization without attaching a browser.
export async function dualMain() {
    const safety = new Safety(), telemetry = new Telemetry();
    const stop = () => { safety.stop('USER_ABORT'); process.exit(130); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    if (process.env.THIRSTY_UI_EVENTS === '1' && process.env.THIRSTY_UI_PARENT_PID && !process.connected)
        throw Error('USER_ABORT');
    if (process.connected) {
        process.on('message', m => { if (m && typeof m === 'object' && 'type' in m && m.type === 'abort')
            stop(); });
        process.once('disconnect', stop);
    }
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', d => { if (/[qQ\u0003]/.test(d.toString()))
            stop(); });
    }
    let code = 0;
    try {
        const [mode, ...args] = process.argv.slice(2), command = parseDualCommand(mode, args);
        const config = { ...loadConfig(), COURT_COUNT: 2 };
        if (command.mode === 'full')
            console.log('THIS TEST CAN CREATE TWO REAL TEMPORARY RESERVATION HOLDS.\nPAYMENT WILL NOT BE AUTOMATED.');
        await runDual(config, command.mode, safety, telemetry, command);
    }
    catch (error) {
        code = 1;
        const reason = error instanceof Error ? /^[A-Z_]{1,80}(?=:|$)/.exec(error.message)?.[0] : undefined;
        emitUiEvent({ type: 'error', code: reason ?? 'INVALID_DUAL_ARGUMENTS_OR_OPERATION_FAILED' });
        console.error(reason ?? 'INVALID_DUAL_ARGUMENTS_OR_OPERATION_FAILED');
        telemetry.mark('dualFailed');
    }
    finally {
        await telemetry.flush();
        if (process.stdin.isTTY)
            process.stdin.setRawMode(false);
    }
    process.exit(code);
}
//# sourceMappingURL=dual-cli.js.map