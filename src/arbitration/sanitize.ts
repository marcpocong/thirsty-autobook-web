/** Output-only guard. This intentionally rejects both key names and common value shapes. */
export function assertSanitizedOutput(value: unknown): void {
  const text = JSON.stringify(value);
  const forbidden = [/"(?:customer.?id|authorization|cookie|turnstile|fingerprint|payment(?:data)?|qr.?content|email|phone|full.?name)"\s*:/i,
    /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/];
  const match = forbidden.find(pattern => pattern.test(text));
  if (match) throw Error(`UNSANITIZED_ANALYSIS_OUTPUT:${match.source}`);
}
