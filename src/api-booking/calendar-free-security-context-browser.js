async ({ sitekey, action }) => {
  const fingerprint = window.FingerprintJS;
  if (!fingerprint?.load) return { code: 'FINGERPRINT_LIBRARY_UNAVAILABLE' };
  const fingerprintPromise = fingerprint.load({ monitoring: false }).then(agent => agent.get()).then(value => value.visitorId);
  const challenge = async () => {
    let turnstile = window.turnstile;
    if (!turnstile) {
      turnstile = await new Promise((resolve, reject) => {
        const existing = document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]');
        const script = existing ?? document.createElement('script');
        const timer = setTimeout(() => reject(Error('CHALLENGE_SCRIPT_TIMEOUT')), 15000);
        script.addEventListener('load', () => { clearTimeout(timer); window.turnstile ? resolve(window.turnstile) : reject(Error('CHALLENGE_SCRIPT_INVALID')); }, { once: true });
        script.addEventListener('error', () => { clearTimeout(timer); reject(Error('CHALLENGE_SCRIPT_FAILED')); }, { once: true });
        if (!existing) { script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          script.async = true; document.head.appendChild(script); }
        else if (window.turnstile) { clearTimeout(timer); resolve(window.turnstile); }
      });
    }
    const container = document.createElement('div');
    container.setAttribute('aria-label', 'Booking verification');
    Object.assign(container.style, { position: 'fixed', bottom: '16px', left: '16px', zIndex: '2147483647',
      background: 'white', padding: '12px', borderRadius: '12px' });
    document.body.appendChild(container);
    let widget;
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('CHALLENGE_TIMEOUT')), 60000);
        const finish = token => { clearTimeout(timer); token ? resolve(token) : reject(Error('CHALLENGE_EMPTY_TOKEN')); };
        widget = turnstile.render(container, { sitekey, action, size: 'flexible', execution: 'execute',
          appearance: 'execute', callback: token => finish(token),
          'error-callback': code => {
            clearTimeout(timer);
            reject(Error(typeof code === 'string' && /^\d{3,6}$/.test(code) ? `CHALLENGE_ERROR_${code}` : 'CHALLENGE_ERROR'));
            return true;
          },
          'expired-callback': () => { clearTimeout(timer); reject(Error('CHALLENGE_EXPIRED')); },
          'timeout-callback': () => { clearTimeout(timer); reject(Error('CHALLENGE_WIDGET_TIMEOUT')); } });
        turnstile.execute(widget);
      });
    } finally { if (widget !== undefined) turnstile.remove(widget); container.remove(); }
  };
  const [challengeResult, fingerprintResult] = await Promise.allSettled([challenge(), fingerprintPromise]);
  if (challengeResult.status === 'rejected') {
    const code = challengeResult.reason instanceof Error ? challengeResult.reason.message : '';
    return { code: ['CHALLENGE_SCRIPT_TIMEOUT', 'CHALLENGE_SCRIPT_INVALID', 'CHALLENGE_SCRIPT_FAILED',
      'CHALLENGE_TIMEOUT', 'CHALLENGE_EMPTY_TOKEN', 'CHALLENGE_ERROR', 'CHALLENGE_EXPIRED',
      'CHALLENGE_WIDGET_TIMEOUT'].includes(code) || /^CHALLENGE_ERROR_\d{3,6}$/.test(code)
      ? code : 'CHALLENGE_UNKNOWN_FAILURE' };
  }
  if (fingerprintResult.status === 'rejected') return { code: 'FINGERPRINT_GENERATION_FAILED' };
  return { turnstileToken: challengeResult.value, publicFingerprint: fingerprintResult.value };
}
