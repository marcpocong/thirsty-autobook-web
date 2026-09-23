/**
 * Onda's observed response for a date that has not been published yet:
 * `{ success: true, data: { dates: {}, slotsBySpace: {} } }`. The target date is
 * absent rather than flagged `false`. Only this exact empty shape counts; a
 * partial or malformed response is never treated as "not released".
 */
export function isOndaUnreleasedEmptyResponse(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const body = raw as { success?: unknown; data?: unknown };
  if (body.success !== true || !body.data || typeof body.data !== 'object') return false;
  const data = body.data as { dates?: unknown; slotsBySpace?: unknown };
  return !!data.dates && typeof data.dates === 'object' && !Array.isArray(data.dates) &&
    !!data.slotsBySpace && typeof data.slotsBySpace === 'object' && !Array.isArray(data.slotsBySpace) &&
    Object.keys(data.dates).length === 0 && Object.keys(data.slotsBySpace).length === 0;
}
