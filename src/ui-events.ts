import { z } from 'zod';

// Opt-in stdout protocol. Ordinary CLI output and buffered telemetry remain intact.
export const UiEventSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('handoff'),date:z.iso.date(),court:z.number().int().min(1).max(7),hours:z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)).min(1).max(16),amount:z.number().finite().positive(),currency:z.literal('PHP'),status:z.literal('Pending'),countdown:z.string().regex(/^\d{1,2}:[0-5]\d$/),verifiedAt:z.iso.datetime()}).strict(),
  z.object({ type: z.literal('selection'), date: z.iso.date(), court: z.number().int().min(1).max(7), hours: z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)).min(1).max(16), amount: z.number().finite().positive(), proceedReady: z.literal(true), attempts: z.number().int().min(1).max(5) }).strict(),
  z.object({ type: z.literal('telemetry'), event: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/), wall: z.iso.datetime(), value: z.number().finite().optional() }).strict(),
  z.object({ type: z.literal('inspection'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), gridToday: z.boolean(), selected: z.number().int().nonnegative().nullable(), allCourts: z.boolean(), visible: z.boolean(), verifiedAt: z.iso.datetime() }).strict(),
  z.object({ type: z.literal('plan'), targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), releaseMs: z.number().finite(), timezone: z.string().max(80) }).strict(),
  z.object({ type: z.literal('error'), code: z.string().regex(/^[A-Z_]{1,80}$/) }).strict(),
]);
export type UiEvent = z.infer<typeof UiEventSchema>;
export function emitUiEvent(event: UiEvent) {
  if (process.env.THIRSTY_UI_EVENTS === '1') process.stdout.write(`THIRSTY_EVENT ${JSON.stringify(event)}\n`);
}
