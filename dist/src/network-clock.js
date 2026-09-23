import { createSocket } from 'node:dgram';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
const NTP_UNIX_EPOCH_SECONDS = 2_208_988_800;
const STATE_PATH = resolve('.local/network-clock.json');
export const NETWORK_CLOCK_MAX_AGE_MS = 2 * 60 * 60_000;
const ClockStateSchema = z.object({ source: z.string().regex(/^time(?:[1-4])?\.google\.com$/), offsetMs: z.number().finite(), roundTripMs: z.number().finite().nonnegative(), synchronizedAt: z.iso.datetime() }).strict();
function writeTimestamp(packet, offset, unixMs) {
    const seconds = Math.floor(unixMs / 1000) + NTP_UNIX_EPOCH_SECONDS;
    const fraction = Math.floor(((unixMs % 1000) / 1000) * 0x1_0000_0000);
    packet.writeUInt32BE(seconds >>> 0, offset);
    packet.writeUInt32BE(fraction >>> 0, offset + 4);
}
function readTimestamp(packet, offset) {
    const seconds = packet.readUInt32BE(offset) - NTP_UNIX_EPOCH_SECONDS;
    const fraction = packet.readUInt32BE(offset + 4) / 0x1_0000_0000;
    return (seconds + fraction) * 1000;
}
export function calculateNtpOffset(t1, t2, t3, t4) {
    const offsetMs = ((t2 - t1) + (t3 - t4)) / 2, roundTripMs = Math.max(0, (t4 - t1) - (t3 - t2));
    if (![offsetMs, roundTripMs].every(Number.isFinite))
        throw Error('NETWORK_CLOCK_RESPONSE_INVALID');
    return { offsetMs, roundTripMs };
}
async function sample(host, timeoutMs = 2500) {
    return new Promise((resolveSample, reject) => {
        const socket = createSocket('udp4'), packet = Buffer.alloc(48);
        packet[0] = 0x23;
        const t1 = Date.now();
        writeTimestamp(packet, 40, t1);
        let settled = false;
        const timer = setTimeout(() => finish(Error('NETWORK_CLOCK_TIMEOUT')), timeoutMs);
        const finish = (error, value) => { if (settled)
            return; settled = true; clearTimeout(timer); socket.close(); error ? reject(error) : resolveSample(value); };
        socket.once('error', () => finish(Error('NETWORK_CLOCK_TRANSPORT_FAILED')));
        socket.once('message', message => {
            const t4 = Date.now();
            if (message.length < 48 || (message[0] & 7) !== 4) {
                finish(Error('NETWORK_CLOCK_RESPONSE_INVALID'));
                return;
            }
            try {
                const t2 = readTimestamp(message, 32), t3 = readTimestamp(message, 40), timing = calculateNtpOffset(t1, t2, t3, t4);
                if (Math.abs(timing.offsetMs) > 5 * 60_000 || timing.roundTripMs > 5000)
                    throw Error('NETWORK_CLOCK_RESPONSE_INVALID');
                finish(undefined, { source: host, offsetMs: timing.offsetMs, roundTripMs: timing.roundTripMs, synchronizedAt: new Date(t4 + timing.offsetMs).toISOString() });
            }
            catch (error) {
                finish(error instanceof Error ? error : Error('NETWORK_CLOCK_RESPONSE_INVALID'));
            }
        });
        socket.send(packet, 123, host, error => { if (error)
            finish(Error('NETWORK_CLOCK_TRANSPORT_FAILED')); });
    });
}
export async function queryGoogleNetworkClock() {
    const settled = await Promise.allSettled(['time.google.com', 'time1.google.com', 'time2.google.com'].map(host => sample(host)));
    const values = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []).sort((a, b) => a.roundTripMs - b.roundTripMs);
    if (!values.length)
        throw Error('NETWORK_CLOCK_SYNC_FAILED');
    return ClockStateSchema.parse(values[0]);
}
export async function synchronizeNetworkClock(path = STATE_PATH) {
    const state = await queryGoogleNetworkClock();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, path);
    return state;
}
export function readNetworkClock(path = STATE_PATH) {
    try {
        return ClockStateSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    }
    catch {
        return null;
    }
}
export function networkNowMs(path = STATE_PATH, systemNow = Date.now()) {
    const state = readNetworkClock(path);
    return state ? systemNow + state.offsetMs : systemNow;
}
export function networkClockFresh(state, nowMs = networkNowMs()) {
    return !!state && nowMs - Date.parse(state.synchronizedAt) >= 0 && nowMs - Date.parse(state.synchronizedAt) <= NETWORK_CLOCK_MAX_AGE_MS;
}
//# sourceMappingURL=network-clock.js.map