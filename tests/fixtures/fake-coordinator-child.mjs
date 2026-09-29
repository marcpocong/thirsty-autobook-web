// Stand-in for dispatch-coordinator-child.ts speaking the same IPC protocol, without Chrome.
// FAKE_COORDINATOR_MODE: conflict (every attempt answered 409, confirmed rejection) | unsent (refused before transport)
// | crash (exits after acknowledging the arm, without reporting) | init-fail (never becomes ready).
const mode = process.env.FAKE_COORDINATOR_MODE ?? 'conflict';
const send = message => process.send?.(message);
process.on('message', message => {
  if (message.type === 'init') { if (mode !== 'init-fail') send({ type: 'ready', pageCount: message.pageCount }); else send({ type: 'fatal', code: 'COORDINATOR_TAB_NOT_FOUND' }); return; }
  if (message.type === 'arm') {
    send({ type: 'armed', count: message.attempts.length });
    if (mode === 'crash') { setTimeout(() => process.exit(3), 20); return; }
    for (const attempt of message.attempts) {
      send({ type: 'prewarm', attemptId: attempt.attemptId, ok: true, startedMs: -900, readyMs: -800 });
      if (mode === 'unsent') send({ type: 'result', attemptId: attempt.attemptId, outcome: { kind: 'unsent', code: 'DIRECT_RELEASE_WINDOW_MISSED' } });
      else send({ type: 'result', attemptId: attempt.attemptId, outcome: { kind: 'error', code: 'ONDA_HTTP_STATUS_INVALID', dispatched: true, confirmedRejected: true,
        diagnostic: { status: 409, category: 'http-rejection', contentKind: 'json', responseSource: 'application', errorHint: 'availability' } } });
    }
    send({ type: 'telemetry', rows: [] });
    return;
  }
  if (message.type === 'shutdown') process.exit(0);
});
process.on('disconnect', () => process.exit(0));
