async () => {
  const runtime = window.TURBOPACK;
  if (!runtime || typeof runtime.push !== 'function') return { code: 'ONDA_RUNTIME_UNAVAILABLE' };
  return new Promise(resolve => {
    const id = 900000000 + Math.floor(Math.random() * 10000000);
    const path = `/_next/static/immutable/chunks/booking-context-${id}.js`;
    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ code: 'ONDA_SECURITY_HELPER_TIMEOUT' }), 90_000);
    try {
      runtime.push([path, id, module => {
        try {
          const challenge = module.i(709892).getPublicBookingTurnstileToken;
          const fingerprint = module.i(139691).getPublicFingerprintId;
          if (typeof challenge !== 'function' || typeof fingerprint !== 'function') {
            finish({ code: 'ONDA_SECURITY_HELPER_UNAVAILABLE' });
            return;
          }
          // Same concurrent invocation and settlement as Promise.all: the first rejection fails, success needs both.
          // Diagnostics only: which helper rejected (never its reason or any value).
          const pending = [[challenge(), 'challenge'], [fingerprint(), 'fingerprint']], values = [];
          let remaining = pending.length;
          pending.forEach(([value, failedHelper], index) => Promise.resolve(value).then(result => {
            values[index] = result;
            if (--remaining === 0) finish(values[0] && values[1]
              ? { turnstileToken: values[0], publicFingerprint: values[1] }
              : { code: 'ONDA_SECURITY_CONTEXT_EMPTY' });
          }, () => finish({ code: 'ONDA_SECURITY_VERIFICATION_FAILED', failedHelper })));
        } catch { finish({ code: 'ONDA_SECURITY_HELPER_UNAVAILABLE' }); }
      }]);
      runtime.push([path, { otherChunks: [], runtimeModuleIds: [id] }]);
    } catch { finish({ code: 'ONDA_RUNTIME_INJECTION_FAILED' }); }
  });
}
