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
          Promise.all([challenge(), fingerprint()]).then(([turnstileToken, publicFingerprint]) => {
            finish(turnstileToken && publicFingerprint
              ? { turnstileToken, publicFingerprint }
              : { code: 'ONDA_SECURITY_CONTEXT_EMPTY' });
          }, () => finish({ code: 'ONDA_SECURITY_VERIFICATION_FAILED' }));
        } catch { finish({ code: 'ONDA_SECURITY_HELPER_UNAVAILABLE' }); }
      }]);
      runtime.push([path, { otherChunks: [], runtimeModuleIds: [id] }]);
    } catch { finish({ code: 'ONDA_RUNTIME_INJECTION_FAILED' }); }
  });
}
