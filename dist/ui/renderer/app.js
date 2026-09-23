import { bookingSetupProblem, reconcileFallbackTimes } from '../../src/booking-setup.js';
const byId = (id) => document.getElementById(id);
let latest;
let renderedLogs = '';
let renderedPreviousHolds = '';
let selectedRunId;
let timingReadyKey = '';
let timingReadyStartedMono = 0;
let timingReadyInitialMs = 0;
let dirty = false, loadedPlan = '';
let courtOrder = [7, 6, 5, 4, 3, 2, 1], fallbackTimes = [];
const input = (id) => byId(id);
let workflow = 'release';
let currentView = 'release';
const browserFocusMessages = {};
const browserFocusPending = {};
// Electron prefixes IPC rejections, so match the known codes anywhere in the message.
// A wrong reason here sends the operator looking in the wrong place.
function browserFocusFailure(worker, error) {
    const text = error instanceof Error ? error.message : String(error);
    const code = ['CDP_NOT_LISTENING', 'CDP_ENDPOINT_UNAVAILABLE', 'CDP_WRONG_PROFILE', 'CDP_WRONG_PORT', 'CDP_PROCESS_NOT_CHROME',
        'CDP_PROFILE_MISSING', 'CDP_UNSAFE_BIND', 'CDP_AMBIGUOUS_LISTENER', 'CDP_IDENTITY_MISMATCH', 'CDP_PROCESS_METADATA_UNAVAILABLE',
        'ONDA_TAB_AMBIGUOUS_OR_MISSING', 'ONDA_TAB_MISSING'].find(known => text.includes(known));
    if (code === 'CDP_NOT_LISTENING' || code === 'CDP_ENDPOINT_UNAVAILABLE')
        return `Browser ${worker} is not running. Its Chrome window was closed.`;
    if (code === 'ONDA_TAB_MISSING')
        return `Browser ${worker} has no Onda tab open.`;
    if (code === 'ONDA_TAB_AMBIGUOUS_OR_MISSING')
        return `Browser ${worker} has more than one Onda tab; open the right one in Chrome.`;
    if (code)
        return `Browser ${worker} could not be verified (${code.replaceAll('_', ' ').toLowerCase()}).`;
    return `Browser ${worker} could not be brought to the front. ${text.replace(/^Error invoking remote method '[^']*':\s*/, '').slice(0, 140)}`;
}
function runDetail(run) {
    const detail = document.createElement('div');
    detail.className = 'run-detail';
    const facts = document.createElement('dl');
    facts.className = 'run-detail-facts';
    const fact = (name, value) => { const item = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = name; dd.textContent = value; item.append(dt, dd); return item; };
    const players = playersByWorker(latest?.playerStatus);
    facts.append(fact('Run ID', run.runId), fact('Started', `${new Date(run.startedAt).toLocaleString('en-GB', { timeZone: 'Asia/Manila' })} Manila`), fact('Browser ready', run.readyAt ? `${new Date(run.readyAt).toLocaleString('en-GB', { timeZone: 'Asia/Manila' })} Manila` : 'Not recorded'), fact('Finished', `${new Date(run.endedAt).toLocaleString('en-GB', { timeZone: 'Asia/Manila' })} Manila`), fact('Measured time', `${((run.readyElapsedMs ?? 0) / 1000).toFixed(3)} seconds · browser ready to finish`), fact('Whole process', `${(run.totalElapsedMs / 1000).toFixed(3)} seconds · includes startup/preparation`), fact('Outcome', run.outcome.toUpperCase()));
    for (const hold of run.qrHandoffs ?? []) {
        const player = hold.checkout ? players[hold.checkout] : undefined;
        const who = hold.checkout ? `${player?.fullName || `Browser ${hold.checkout}`}` : 'Player';
        facts.append(fact(`Booking${hold.checkout ? ` (Browser ${hold.checkout})` : ''}`, `${who} · Court${hold.courts.length === 1 ? '' : 's'} ${hold.courts.join(' + ')} · ${hold.date} · ${hold.startTime}–${hold.endTime} · ₱${hold.amount.toLocaleString()}`));
    }
    const timeline = document.createElement('div');
    timeline.className = 'run-detail-events';
    if (run.activities?.length)
        timeline.replaceChildren(...run.activities.map(activity => { const event = document.createElement('div'); event.className = `run-detail-event ${activity.level}`; const time = document.createElement('time'); time.textContent = new Date(activity.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 }); const message = document.createElement('span'); message.textContent = activity.text; const timing = document.createElement('span'); timing.className = 'run-detail-event-timing'; timing.textContent = activity.elapsedMs === undefined ? '' : `${(activity.elapsedMs / 1000).toFixed(3)}s total · ${((activity.deltaMs ?? 0) / 1000).toFixed(3)}s step`; event.append(time, message, timing); return event; }));
    else
        timeline.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'No detailed activity was recorded for this older run.' }));
    detail.append(facts);
    if (run.qrHandoffs?.length) {
        const booking = document.createElement('div');
        booking.className = 'qr-summary-list';
        const note = document.createElement('p');
        note.className = 'small';
        note.textContent = 'Full booking detail cards, expanded from the summary above. Player name/email reflect the currently saved profile.';
        for (const hold of run.qrHandoffs)
            booking.append(buildHandoffCard(hold, players));
        detail.append(Object.assign(document.createElement('h3'), { textContent: 'Booking details' }), note, booking);
    }
    detail.append(Object.assign(document.createElement('h3'), { textContent: 'Activity timeline' }), timeline);
    return detail;
}
function showRunDetail(run) {
    selectedRunId = run.runId;
    byId('run-detail-title').textContent = run.label.replaceAll('·', ' / ').toUpperCase();
    byId('run-detail-content').replaceChildren(runDetail(run));
    byId('run-detail-modal').hidden = false;
    byId('run-detail-close').focus();
}
function closeRunDetail() { selectedRunId = undefined; byId('run-detail-modal').hidden = true; byId('run-detail-content').replaceChildren(); }
let confirmActiveId;
function settleConfirm(confirmed) {
    if (!confirmActiveId)
        return;
    const id = confirmActiveId;
    confirmActiveId = undefined;
    byId('confirm-modal').hidden = true;
    void window.thirsty.confirmResponse(id, confirmed);
}
window.thirsty.onConfirmRequest(request => {
    confirmActiveId = request.id;
    byId('confirm-dialog').dataset.tone = request.tone;
    byId('confirm-badge').textContent = request.tone === 'warning' ? 'CAUTION' : 'CONFIRM';
    byId('confirm-title').textContent = request.title;
    byId('confirm-message').textContent = request.message;
    byId('confirm-detail').textContent = request.detail;
    byId('confirm-cancel').textContent = request.cancelLabel ?? 'Cancel';
    byId('confirm-ok').textContent = request.confirmLabel;
    byId('confirm-modal').hidden = false;
    byId('confirm-cancel').focus();
});
const requiredWorkers = (strategy, count) => ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].slice(0, (strategy === 'extended' ? 2 : 1) * Math.ceil(count / 2));
const workerLabel = (worker) => worker === 'A' ? 'Primary player' : `Player ${'ABCDEFGH'.indexOf(worker) + 1}`;
const SPECIAL_SESSION_WORKERS_UI = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
let testDraft, releaseDraft, testDirty = false, releaseDirty = false;
let releaseAdjustment;
byId('simple-status').append(byId('readiness'));
const primary = byId('primary-actions');
primary.prepend(byId('prepare'), byId('terms').parentElement);
primary.append(byId('api-dry-controls'), byId('arm'), byId('blocked-reason'), byId('selection-result'), byId('handoff-result'));
const advanced = byId('advanced-extra');
advanced.append(document.querySelector('.mode-options'));
byId('setup-fields').append(document.querySelector('.editors'), byId('attempts').parentElement, byId('save-booking'), byId('edit-status'));
const releaseView = byId('view-release'), planView = byId('view-plan'), testsView = byId('view-tests'), runsView = byId('view-runs');
releaseView.prepend(byId('release-schedule'), document.querySelector('.hero'), byId('simple-status'));
releaseView.append(byId('release-readiness-card'), byId('block-audit-card'), primary);
releaseView.querySelector('.release-action').after(byId('lock-card'));
planView.append(document.querySelector('.setup'));
const testAction = testsView.querySelector('.test-action'), testResults = byId('test-results');
const releaseAction = releaseView.querySelector('.release-action');
releaseAction.append(byId('terms').parentElement);
testsView.querySelector('.test-date-card').append(byId('test-date-label'));
testAction.append(byId('test-booking'));
byId('test-availability').append(byId('api-dry-controls'));
runsView.append(document.querySelector('.run-history'), document.querySelector('.activity'), byId('previous-holds'), byId('advanced'));
const legacyControls = document.querySelector('.controls');
runsView.querySelector('#advanced-extra').append(legacyControls.parentElement, ...document.querySelectorAll('main > .practice'), byId('performance-card'));
function showView(view) {
    if (latest && latest.operation !== 'idle' && latest.operation !== 'scheduled' && view !== 'runs' && !(view === 'tests' && workflow === 'test'))
        return;
    currentView = view;
    for (const id of ['release', 'plan', 'tests', 'runs']) {
        byId(`view-${id}`).hidden = id !== view;
        document.querySelector(`[data-view="${id}"]`).setAttribute('aria-current', id === view ? 'page' : 'false');
    }
    const nextWorkflow = view === 'tests' ? 'test' : view === 'runs' ? workflow : 'release';
    if (nextWorkflow !== workflow) {
        storeDraft();
        workflow = nextWorkflow;
        if (workflow === 'test' && latest?.booking) {
            const s = latest.booking.setup;
            applyDraft({ sessionMode: s.SESSION_MODE ?? 'normal', method: s.BOOKING_METHOD, strategy: s.BOOKING_TYPE, date: testDraft?.date ?? input('test-date').value, courtCount: s.COURT_COUNT, start: s.START_TIME, duration: s.DURATION_HOURS, attempts: s.MAX_SELECTION_ATTEMPTS, courtOrder: [...s.PREFERRED_COURTS], fallbackTimes: [...s.FALLBACK_TIMES], exactA: '', exactB: '' });
            testDirty = false;
        }
        if (workflow === 'release' && releaseDraft)
            applyDraft(releaseDraft);
        dirty = workflow === 'test' ? testDirty : releaseDirty;
        input('terms').checked = false;
        void window.thirsty.setWorkflow(workflow).then(() => window.thirsty.getStatus()).then(render);
    }
    const terms = byId('terms').parentElement;
    (view === 'tests' ? testAction : releaseAction).append(terms);
    (view === 'tests' ? testResults : primary).append(byId('observed-price'), byId('selection-result'), byId('handoff-result'));
    (view === 'tests' ? testsView : releaseView).append(byId('lock-card'));
    if (latest)
        render(latest);
}
for (const button of document.querySelectorAll('[data-view]'))
    button.onclick = () => showView(button.dataset.view);
input('test-date').value = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const friendly = (h) => `${Number(h.slice(0, 2)) % 12 || 12}:00 ${Number(h.slice(0, 2)) < 12 ? 'AM' : 'PM'}`;
const endFriendly = (start, duration) => Number(start.slice(0, 2)) + duration === 24 ? '12:00 MN' : friendly(`${String(Number(start.slice(0, 2)) + duration).padStart(2, '0')}:00`);
const hours = Array.from({ length: 16 }, (_, i) => `${String(i + 8).padStart(2, '0')}:00`);
for (const id of ['start-time', 'fallback-time', 'practice-start', 'full-start', 'dual-start'])
    byId(id).replaceChildren(...hours.map(h => new Option(friendly(h), h)));
byId('practice-court').replaceChildren(...Array.from({ length: 7 }, (_, i) => new Option(`Court ${i + 1}`, String(i + 1))));
input('practice-date').value = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
byId('full-court').replaceChildren(...Array.from({ length: 7 }, (_, i) => new Option(`Court ${i + 1}`, String(i + 1))));
input('full-date').value = input('practice-date').value;
input('dual-date').value = input('practice-date').value;
for (const id of ['dual-court-a', 'dual-court-b'])
    byId(id).replaceChildren(...Array.from({ length: 7 }, (_, i) => new Option(`Court ${i + 1}`, String(i + 1))));
input('dual-court-a').value = '7';
input('dual-court-b').value = '6';
function formDraft() { return { sessionMode: input('session-mode').value, method: input('booking-method').value, strategy: input('booking-type').value, date: input('test-date').value, courtCount: Number(input('court-count').value), start: input('start-time').value, duration: Number(input('duration').value), attempts: Number(input('attempts').value), courtOrder: [...courtOrder], fallbackTimes: [...fallbackTimes], exactA: input('exact-a').value, exactB: input('exact-b').value }; }
function applyDraft(d) { input('session-mode').value = d.sessionMode; input('booking-method').value = d.method; input('booking-type').value = d.strategy; input('test-date').value = d.date; input('court-count').value = String(d.courtCount); input('start-time').value = d.start; input('duration').value = String(d.duration); input('attempts').value = String(d.attempts); courtOrder = [...d.courtOrder]; fallbackTimes = [...d.fallbackTimes]; input('exact-a').value = d.exactA; input('exact-b').value = d.exactB; editors(); syncSpecialSessionControls(); }
function storeDraft() { const d = formDraft(); if (workflow === 'test')
    testDraft = d;
else
    releaseDraft = d; }
function reconcileReleaseDraft() {
    if (workflow !== 'release')
        return;
    const reconciliation = reconcileFallbackTimes(input('start-time').value, Number(input('duration').value), fallbackTimes);
    if (reconciliation.removed.length) {
        fallbackTimes = [...reconciliation.valid];
        releaseAdjustment = reconciliation;
        editors();
    }
}
function changed() { input('terms').checked = false; reconcileReleaseDraft(); if (workflow === 'test')
    testDirty = true;
else
    releaseDirty = true; dirty = true; storeDraft(); void window.thirsty.invalidatePreparation?.().catch(() => { }); byId('edit-status').textContent = 'SETTINGS CHANGED · Press Reset & Prepare.'; if (latest)
    render(latest); }
function syncViableControls() {
    const duration = Number(input('duration').value), start = input('start-time').value, extended = input('booking-type').value === 'extended';
    input('duration').min = extended ? '4' : '1';
    input('duration').max = extended ? '6' : '3';
    for (const option of [...byId('start-time').options])
        option.disabled = Number(option.value.slice(0, 2)) + duration > 24;
    const viable = hours.filter(h => h !== start && !fallbackTimes.includes(h) && Number(h.slice(0, 2)) + duration <= 24);
    const picker = byId('fallback-time'), previous = picker.value;
    picker.replaceChildren(...viable.map(h => new Option(friendly(h), h)));
    if (viable.includes(previous))
        picker.value = previous;
    byId('add-fallback').disabled = !viable.length;
}
function editors() {
    const draw = (id, items, fallback) => byId(id).replaceChildren(...items.map((item, index) => {
        const li = document.createElement('li'), label = document.createElement('span');
        label.textContent = fallback ? friendly(String(item)) : `Court ${item}`;
        li.append(label);
        for (const [text, offset] of [['↑', -1], ['↓', 1]]) {
            const button = document.createElement('button');
            button.textContent = text;
            button.setAttribute('aria-label', `Move ${label.textContent} ${offset < 0 ? 'up' : 'down'}`);
            button.disabled = index + offset < 0 || index + offset >= items.length;
            button.onclick = () => { const other = index + offset; [items[index], items[other]] = [items[other], items[index]]; editors(); changed(); };
            li.append(button);
        }
        if (fallback) {
            const remove = document.createElement('button');
            remove.textContent = 'Remove';
            remove.onclick = () => { fallbackTimes.splice(index, 1); editors(); changed(); };
            li.append(remove);
        }
        return li;
    }));
    draw('court-order', courtOrder, false);
    draw('fallback-order', fallbackTimes, true);
}
editors();
testDraft = formDraft();
const dateLabel = (date) => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
function renderBlockAudit(target, audit, date) {
    target.replaceChildren();
    if (!audit) {
        const empty = document.createElement('div');
        empty.className = 'audit-empty';
        const title = document.createElement('strong');
        title.textContent = 'No audit for this date';
        const note = document.createElement('span');
        note.textContent = date ? `Check ${dateLabel(date)} to see confirmed blocks and schedule coverage.` : 'Choose a date, then check all courts.';
        empty.append(title, note);
        target.append(empty);
        return;
    }
    const statusInfo = {
        OPEN: { label: 'Open', symbol: '✓', detail: 'Published by Onda as available' },
        BLOCKED: { label: 'Blocked', symbol: '×', detail: 'Confirmed booking record or published unavailable cell' },
        UNRELEASED: { label: 'Unreleased', symbol: '—', detail: 'Schedule is not published and no public booking record exists' },
        UNKNOWN: { label: 'Unknown', symbol: '?', detail: 'No authoritative state; never treated as open' },
    };
    const top = document.createElement('div');
    top.className = 'audit-overview';
    const heading = document.createElement('div'), eyebrow = document.createElement('span'), title = document.createElement('strong');
    eyebrow.className = 'audit-target-label';
    eyebrow.textContent = 'AUDIT TARGET';
    title.textContent = dateLabel(audit.date);
    heading.append(eyebrow, title);
    const source = document.createElement('span');
    source.className = 'audit-source';
    source.textContent = '112 hourly cells · Courts 1–7 · 8 AM–12 MN';
    top.append(heading, source);
    const counts = document.createElement('div');
    counts.className = 'audit-counts';
    for (const status of ['BLOCKED', 'OPEN', 'UNRELEASED', 'UNKNOWN']) {
        const count = audit.cells.filter(cell => cell.status === status).length, card = document.createElement('div');
        card.className = `audit-count audit-${status.toLowerCase()}`;
        const value = document.createElement('strong'), label = document.createElement('span');
        value.textContent = String(count);
        label.textContent = statusInfo[status].label;
        card.append(value, label);
        counts.append(card);
    }
    const warning = document.createElement('p');
    warning.className = 'audit-guidance';
    warning.textContent = 'UNKNOWN and UNRELEASED are not proof that a court is open. Only green OPEN cells are confirmed available; red BLOCKED cells must be avoided.';
    const publicBlocks = audit.cells.filter(cell => cell.status === 'BLOCKED' && cell.source === 'PUBLIC_BOOKING');
    const confirmed = document.createElement('section');
    confirmed.className = 'audit-confirmed';
    const confirmedTitle = document.createElement('div');
    confirmedTitle.className = 'audit-subtitle';
    const confirmedHeading = document.createElement('strong');
    confirmedHeading.textContent = 'Confirmed public-record blocks';
    const confirmedCount = document.createElement('span');
    confirmedCount.textContent = `${publicBlocks.length} cell${publicBlocks.length === 1 ? '' : 's'}`;
    confirmedTitle.append(confirmedHeading, confirmedCount);
    confirmed.append(confirmedTitle);
    const chips = document.createElement('div');
    chips.className = 'audit-block-chips';
    if (publicBlocks.length)
        for (const court of Array.from({ length: 7 }, (_, index) => index + 1)) {
            const cells = publicBlocks.filter(cell => cell.court === court);
            if (!cells.length)
                continue;
            const chip = document.createElement('span');
            chip.textContent = `Court ${court} · ${cells.map(cell => friendly(cell.hour)).join(', ')}`;
            chips.append(chip);
        }
    else {
        const clear = document.createElement('span');
        clear.className = 'audit-no-blocks';
        clear.textContent = 'No confirmed public booking records were returned for this date.';
        chips.append(clear);
    }
    confirmed.append(chips);
    const legend = document.createElement('div');
    legend.className = 'audit-legend';
    for (const status of ['OPEN', 'BLOCKED', 'UNRELEASED', 'UNKNOWN']) {
        const item = document.createElement('span'), mark = document.createElement('i');
        item.className = `audit-${status.toLowerCase()}`;
        mark.textContent = statusInfo[status].symbol;
        item.append(mark, document.createTextNode(`${statusInfo[status].label} · ${statusInfo[status].detail}`));
        legend.append(item);
    }
    const matrixSection = document.createElement('section');
    matrixSection.className = 'audit-matrix-section';
    const matrixTitle = document.createElement('div');
    matrixTitle.className = 'audit-subtitle';
    matrixTitle.append(Object.assign(document.createElement('strong'), { textContent: 'Court-by-hour matrix' }), Object.assign(document.createElement('span'), { textContent: 'Scroll horizontally to inspect every hour' }));
    const scroll = document.createElement('div');
    scroll.className = 'audit-matrix-scroll';
    scroll.tabIndex = 0;
    const table = document.createElement('table');
    table.className = 'audit-matrix';
    const thead = document.createElement('thead'), header = document.createElement('tr');
    header.append(Object.assign(document.createElement('th'), { textContent: 'Court' }));
    for (const hour of hours) {
        const th = document.createElement('th');
        th.textContent = friendly(hour).replace(':00 ', '');
        th.title = friendly(hour);
        header.append(th);
    }
    thead.append(header);
    table.append(thead);
    const tbody = document.createElement('tbody');
    for (const court of Array.from({ length: 7 }, (_, index) => index + 1)) {
        const row = document.createElement('tr'), courtHeading = document.createElement('th');
        courtHeading.scope = 'row';
        courtHeading.textContent = `C${court}`;
        courtHeading.title = `Court ${court}`;
        row.append(courtHeading);
        for (const hour of hours) {
            const cell = audit.cells.find(value => value.court === court && value.hour === hour), td = document.createElement('td');
            td.className = `audit-cell audit-${cell.status.toLowerCase()}`;
            td.textContent = statusInfo[cell.status].symbol;
            td.title = `Court ${court} · ${friendly(hour)} · ${statusInfo[cell.status].label} · ${cell.source.replaceAll('_', ' ').toLowerCase()}`;
            td.setAttribute('aria-label', td.title);
            row.append(td);
        }
        tbody.append(row);
    }
    table.append(tbody);
    scroll.append(table);
    matrixSection.append(matrixTitle, scroll);
    target.append(top, counts, warning, confirmed, legend, matrixSection);
}
function hourlySlots(start, end) { const first = Number(start.slice(0, 2)), last = Number(end.slice(0, 2)); return Array.from({ length: Math.max(0, last - first) }, (_, i) => `${String(first + i).padStart(2, '0')}:00–${String(first + i + 1).padStart(2, '0')}:00`); }
const holdExpired = (hold) => !!hold.holdExpiresAt && Date.parse(hold.holdExpiresAt) <= Date.now();
function activeHandoffs(state) { return (state.qrHandoffs ?? []).filter(hold => !holdExpired(hold)); }
function playersByWorker(details) { return { A: details?.primaryDetails, B: details?.extendedDetails, C: details?.thirdDetails, D: details?.fourthDetails, E: details?.fifthDetails, F: details?.sixthDetails, G: details?.seventhDetails, H: details?.eighthDetails }; }
function buildHandoffCard(hold, players) {
    const card = document.createElement('div');
    card.className = 'qr-summary-item';
    const worker = hold.checkout, player = worker ? players[worker] : undefined;
    const heading = document.createElement('strong');
    heading.textContent = worker ? `Browser ${worker} · ${player?.fullName || `Player ${worker}`}` : 'QR checkout';
    const phase = document.createElement('div');
    phase.className = `qr-summary-phase ${(hold.status ?? 'qr-ready') === 'qr-ready' ? 'ready' : 'pending'}`;
    phase.textContent = (hold.status ?? 'qr-ready') === 'qr-ready' ? 'QR READY · VERIFY DETAILS BEFORE PAYING' : 'PAYMENT HOLD ACTIVE · OPENING QR PAGE';
    const identity = document.createElement('div');
    identity.className = 'qr-summary-email';
    identity.textContent = player?.email || 'Player email unavailable';
    const booking = document.createElement('div');
    booking.className = 'qr-summary-booking';
    booking.textContent = `Court${hold.courts.length === 1 ? '' : 's'} ${hold.courts.join(' + ')}\nDate: ${dateLabel(hold.date)} (${hold.date})\nTime: ${hold.startTime}–${hold.endTime}\nSlots: ${hourlySlots(hold.startTime, hold.endTime).join(' · ')}`;
    const amount = document.createElement('div');
    amount.className = 'qr-summary-amount';
    amount.textContent = `Amount: ₱${hold.amount.toLocaleString()} · ${holdExpired(hold) ? 'Recorded hold timer elapsed; check Chrome' : 'Payment pending'}`;
    card.append(heading, phase, identity, booking, amount);
    if (hold.bookingNo) {
        const reference = document.createElement('div');
        reference.className = 'small';
        reference.textContent = `Booking reference: ${hold.bookingNo}`;
        card.append(reference);
    }
    if (hold.holdExpiresAt && Number.isFinite(Date.parse(hold.holdExpiresAt))) {
        const expiry = document.createElement('div');
        expiry.className = 'small';
        expiry.textContent = `Recorded hold expiry: ${new Date(hold.holdExpiresAt).toLocaleString('en-GB', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })} Manila`;
        card.append(expiry);
    }
    if (worker) {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'show-browser secondary';
        action.textContent = `Show Browser ${worker}`;
        const result = document.createElement('span');
        result.className = 'show-browser-result';
        result.setAttribute('role', 'status');
        result.textContent = browserFocusMessages[worker] ?? '';
        action.disabled = !!browserFocusPending[worker];
        action.onclick = () => {
            if (browserFocusPending[worker])
                return;
            browserFocusPending[worker] = true;
            action.disabled = true;
            browserFocusMessages[worker] = result.textContent = `Opening Browser ${worker}…`;
            if (latest)
                render(latest);
            void window.thirsty.focusBrowser({ workerId: worker, ...(hold.bookingId ? { bookingId: hold.bookingId } : {}) })
                .then(result => {
                browserFocusMessages[worker] = result === 'focused'
                    ? `Browser ${worker} is now in front, maximized on its screen.`
                    : `Browser ${worker} was restored on its screen, but Windows kept another window in front. Check the taskbar.`;
            })
                .catch((error) => { browserFocusMessages[worker] = browserFocusFailure(worker, error); })
                .finally(() => { browserFocusPending[worker] = false; if (latest)
                render(latest); });
        };
        card.append(action, result);
    }
    return card;
}
const renderedQrSummary = {};
function renderQrSummary(state) {
    const handoffs = activeHandoffs(state);
    const qrReady = handoffs.filter(hold => (hold.status ?? 'qr-ready') === 'qr-ready').length;
    const players = playersByWorker(state.playerStatus);
    // Signature includes hold-expiry and the Show Browser pending/message state so a rebuild
    // still happens on those transitions, but routine polling with nothing actually changed
    // must not tear down an in-flight Show Browser button/click.
    const signature = JSON.stringify({ handoffs: handoffs.map(hold => ({ ...hold, expired: holdExpired(hold) })), players, browserFocusPending, browserFocusMessages });
    for (const id of ['qr-summary-release', 'qr-summary-test']) {
        const container = byId(id);
        container.hidden = !handoffs.length;
        if (!handoffs.length) {
            container.replaceChildren();
            renderedQrSummary[id] = '';
            continue;
        }
        if (renderedQrSummary[id] === signature)
            continue;
        renderedQrSummary[id] = signature;
        const title = document.createElement('strong');
        title.className = 'qr-summary-title';
        title.textContent = qrReady === handoffs.length ? `All QR pages reached · ${qrReady} checkout${qrReady === 1 ? '' : 's'}` : `Live checkout status · ${qrReady} of ${handoffs.length} QR page${handoffs.length === 1 ? '' : 's'} ready`;
        const note = document.createElement('p');
        note.className = 'small';
        note.textContent = 'Confirm every court and time slot below against the visible Onda QR pages before scanning or paying. A hold is not final booking confirmation.';
        const list = document.createElement('div');
        list.className = 'qr-summary-list';
        for (const hold of handoffs)
            list.append(buildHandoffCard(hold, players));
        container.replaceChildren(title, note, list);
    }
}
function syncSpecialSessionControls() {
    const special = input('session-mode').value === 'special-friday';
    byId('special-session-note').hidden = !special;
    if (special && workflow === 'release') {
        input('booking-method').value = 'api-first';
        input('booking-type').value = 'extended';
        input('court-count').value = '4';
        input('start-time').value = '17:00';
        input('duration').value = '5';
        fallbackTimes = [];
        courtOrder = [6, 7, 1, 2, 3, 4, 5];
        editors();
    }
    for (const id of ['booking-method', 'booking-type', 'court-count', 'start-time', 'duration', 'attempts', 'fallback-time', 'add-fallback'])
        input(id).disabled = special;
    document.querySelector('.editors').classList.toggle('session-locked', special);
}
function status(id, text, tone) { const el = byId(id); el.textContent = text; el.dataset.tone = tone; }
function render(state) {
    latest = state;
    renderQrSummary(state);
    byId('headline').textContent = state.headline;
    byId('detail').textContent = state.detail;
    const armed = !!state.scheduledRelease;
    const busy = state.operation !== 'idle' && state.operation !== 'scheduled';
    const playerStatus = state.playerStatus ?? { primary: !!state.booking?.playerConfigured, extended: !!state.booking?.extendedPlayerConfigured, third: !!state.booking?.thirdPlayerConfigured, fourth: !!state.booking?.fourthPlayerConfigured, fifth: !!state.booking?.fifthPlayerConfigured, sixth: !!state.booking?.sixthPlayerConfigured, seventh: !!state.booking?.seventhPlayerConfigured, eighth: !!state.booking?.eighthPlayerConfigured };
    const dual = state.booking?.setup.BOOKING_TYPE === 'standard' && state.booking.setup.COURT_COUNT === 2;
    // Keep the dual practice entry point visible in the safe single-court
    // default; actions stay disabled until count 2 is explicitly saved.
    byId('dual-panel').hidden = false;
    byId('dual-fields').disabled = busy;
    byId('dual-prepare').disabled = busy || state.lock || dirty || !dual;
    byId('dual-dry').disabled = busy || state.lock || dirty || !dual || !state.cdp;
    byId('dual-selection').disabled = busy || state.lock || dirty || !dual || !state.cdp || !input('dual-noncompetitive').checked;
    byId('dual-full').disabled = busy || state.lock || dirty || !dual || !state.cdp || !input('dual-noncompetitive').checked || !input('dual-terms').checked;
    byId('dual-readiness').textContent = dual
        ? ['A', 'B'].map(id => { const w = state.dualWorkers?.[id]; return `Browser ${id}: ${w ? `${w.state.toUpperCase()} (last observed ${new Date(w.verifiedAt).toLocaleTimeString()})` : 'NOT VERIFIED'}`; }).join('\n') + `\nDual selection: ${state.dualValidation?.selection ? 'READY' : 'NOT READY'}\n${state.dualValidation?.full ? 'DUAL FULL FLOW VERIFIED' : 'FULL DUAL HOLD NOT YET VERIFIED'}`
        : 'Legacy dual practice only: Set Courts to book to 2 with Standard saved settings. Use the main controls for Standard / Extended bookings.';
    const dualResult = state.dualResult;
    byId('dual-result').hidden = !dualResult;
    byId('dual-result').textContent = dualResult ? `${dualResult.status.replaceAll('_', ' ')}\n${dualResult.date} / ${dualResult.hours.join(', ')}\nBrowser A: Court ${dualResult.courtA}\nBrowser B: Court ${dualResult.courtB}\nSource: ${dualResult.candidateSource}` : '';
    const full = workflow === 'release' || state.mode === 'full', fullReady = state.capabilities.selectionReady && state.capabilities.checkoutReady && state.capabilities.paymentBoundaryReady;
    input('mode-full').checked = full;
    input('mode-selection').checked = !full;
    input('mode-full').disabled = busy || !fullReady;
    input('mode-selection').disabled = busy;
    input('terms').disabled = armed || busy || state.lock || dirty || !full || !fullReady;
    byId('mode-label').textContent = full ? 'FULL BOOKING TO QR' : 'SELECTION ONLY';
    byId('prepare').firstChild.textContent = dual ? 'Prepare Selected Dual Run ' : full ? 'Prepare Full Booking ' : 'Prepare Selection ';
    byId('arm').textContent = full ? 'Arm Full Booking' : 'Arm Booking Selection';
    byId('arm-description').textContent = full ? 'Per-run terms + confirmation required · stops at QR Checkout · payment stays manual' : 'Explicit confirmation · leaves selected slots · stops before Proceed';
    byId('full-gate').textContent = fullReady ? 'VERIFIED / AVAILABLE' : 'LOCKED / NOT READY';
    for (const id of ['inspect', 'prepare', 'arm', 'dry', 'observe'])
        byId(id).disabled = busy || state.lock;
    byId('chrome').disabled = busy;
    byId('setup-fields').disabled = busy;
    // A retained lock blocks browser-changing practice actions, but operators can
    // still prepare the next exact target and its one-run Terms authorization.
    for (const id of ['practice-fields', 'full-practice-fields'])
        byId(id).disabled = busy;
    byId('lock-card').hidden = !state.lock;
    const unresolvedCheckout = state.retainedLockStage === 'FINAL_ACTION_DISPATCHING';
    byId('lock-note').textContent = unresolvedCheckout ? 'The previous checkout ended with a retained safety lock. Reset & Prepare will inspect every required browser and recover only when they are conclusively clean.' : state.canPrepareOverHold ? 'The previous payment hold remains recorded. Prepare New Run opens a fresh schedule for another run in this bot. Payment stays manual.' : 'Booking actions are blocked. You can still edit and save your next booking plan locally.';
    byId('review-lock').disabled = busy;
    byId('clear-lock').hidden = !state.lockReview?.canClear;
    byId('clear-lock').disabled = busy;
    byId('reset-practice').disabled = busy;
    const review = state.lockReview;
    byId('lock-review').textContent = review ? `Run ID: ${review.runID}\nPID: ${review.pid ?? 'Unknown'}\nProcess: ${review.alive === null ? 'Unknown' : review.alive ? 'Running' : 'Not running'}\nUI-owned worker: ${review.owned ? 'Running' : 'None'}\nBrowser state: ${review.canClear ? 'Safe at last review' : 'Needs verification'}\nCurrent page: ${review.page}\nSelected slots: ${review.selected ?? 'Unknown'}\nPayment hold: ${review.hold}\nReason: ${review.reason}\nChecked: ${review.verifiedAt}` : 'Browser state: Needs verification. Use Review Lock.';
    if (review?.mode === 'dual')
        byId('lock-review').textContent = `Mode: DUAL\nCoordinator PID: ${review.pid ?? 'Unknown'} / ${review.alive === false ? 'Not running' : review.alive ? 'Running' : 'Unknown'}\n${review.workers?.map(w => `Browser ${w.id}: PID ${w.pid ?? 'Unknown'} / ${w.alive === false ? 'Not running' : w.alive ? 'Running' : 'Unknown'} / ${w.page} / selected ${w.selected ?? 'Unknown'} / hold ${w.hold} / recorded ${w.recordedState}`).join('\n')}\nReason: ${review.reason}`;
    const reason = busy ? 'An operation is running.' : state.lock ? 'Reset & Prepare will inspect the retained session safely.' : !playerStatus.primary ? 'Primary player configuration is missing.' : !state.ready ? 'Press Reset & Prepare for the current settings.' : !state.termsAuthorized ? 'Authorize Terms for this run.' : '';
    byId('blocked-reason').textContent = reason;
    for (const id of ['inspect', 'prepare', 'arm', 'dry', 'observe'])
        byId(id).title = reason;
    byId('chrome').title = state.lock ? 'Starts or reuses dedicated Chrome for read-only lock review.' : 'Starts or reuses dedicated Chrome.';
    byId('full-practice').disabled = busy || state.lock || !state.cdp || !state.booking?.playerConfigured || !fullReady || !input('full-terms').checked;
    byId('practice').disabled = busy || state.lock || !state.cdp;
    byId('practice-blocked').textContent = state.lock ? 'Use Reset Practice Session to inspect and safely restart the dedicated practice environment.' : !state.cdp ? 'Start / Attach Chrome first.' : !state.booking?.playerConfigured ? 'Player information is missing.' : !fullReady ? 'Full Booking capability is not verified.' : !input('full-terms').checked ? 'Terms authorization is required for this practice run.' : '';
    byId('prepare').disabled = armed || busy || state.lock || dirty || !state.booking;
    byId('arm').disabled = armed ? false : busy || state.lock || !state.booking || !state.capabilities.selectionReady || !state.cdp || (full && (!fullReady || !state.termsAuthorized));
    byId('dry').disabled = busy || dirty || state.lock || !state.booking || !state.clock?.canArmToday;
    byId('observe').disabled = busy || state.lock || !state.clock?.canArmToday;
    input('terms').checked = state.termsAuthorized || armed;
    byId('player-status').textContent = `Player information · ${state.booking?.playerConfigured ? 'Configured ✓' : 'Missing / configuration invalid'}`;
    byId('capability-status').textContent = `Selection ${state.capabilities.selectionReady ? 'ready' : 'unverified'} · checkout ${state.capabilities.checkoutReady ? 'verified' : 'unverified'} · payment handoff ${state.capabilities.paymentBoundaryReady ? 'verified' : 'unverified'}`;
    const b = state.booking;
    if (b) {
        if (!releaseDirty && loadedPlan !== b.fingerprint) {
            loadedPlan = b.fingerprint;
            releaseDraft = { sessionMode: b.setup.SESSION_MODE ?? 'normal', method: b.setup.BOOKING_METHOD ?? 'browser', strategy: b.setup.BOOKING_TYPE ?? 'standard', date: testDraft?.date ?? input('test-date').value, courtCount: b.setup.COURT_COUNT, start: b.setup.START_TIME, duration: b.setup.DURATION_HOURS, attempts: b.setup.MAX_SELECTION_ATTEMPTS, courtOrder: [...b.setup.PREFERRED_COURTS], fallbackTimes: [...b.setup.FALLBACK_TIMES], exactA: '', exactB: '' };
            if (b.fallbackReconciliation.removed.length) {
                releaseAdjustment = b.fallbackReconciliation;
                releaseDirty = true;
            }
            if (workflow === 'release') {
                applyDraft(releaseDraft);
                dirty = releaseDirty;
            }
        }
        byId('booking-preview').textContent = `${dual ? '2 COURTS / SAME TIME BLOCK\n' : ''}TARGET  ${dateLabel(b.targetDate)}\nREQUIRED SLOTS  ${b.slots.join(' · ')}\nCOURT ORDER  ${b.setup.PREFERRED_COURTS.join(' → ')}\nFALLBACK STARTS  ${b.setup.FALLBACK_TIMES.map(friendly).join(' → ') || 'None'}\n${b.setup.MAX_SELECTION_ATTEMPTS} candidate attempts · No price ceiling\nPLAYER  Configured ✓`;
    }
    const result = state.selection;
    byId('selection-result').hidden = !result || !!state.handoff;
    if (result)
        byId('selection-result').textContent = `SLOTS SELECTED\nCourt ${result.court} · ${result.date}\nHours: ${result.hours.join(', ')} · ${result.hours.length} slots\n₱${result.amount.toLocaleString()} · Proceed READY\n${full ? 'Selection is not yet a hold. See current checkout stage above.' : 'AUTOMATION STOPPED BEFORE PROCEED\nUSER CONTROL RESTORED'}`;
    byId('handoff-result').hidden = !state.handoff;
    byId('readiness').className = `readiness ${state.ready ? 'ready' : state.operation === 'observe' ? 'armed' : ''}`;
    status('cdp', state.cdp ? 'Reachable locally' : 'Not connected', state.cdp ? 'good' : 'warn');
    status('lock', state.lock ? (busy ? 'Active' : 'Exists · check manually') : 'Clear', state.lock ? 'warn' : 'good');
    const i = state.inspection;
    const fresh = !!i && state.cdp && Date.now() - Date.parse(i.verifiedAt) < 60000;
    const clock = state.clock;
    byId('release-strategy').textContent = clock ? `Pre-open calendar: ${clock.preopenCalendar ? 'ON' : 'OFF'}\nRelease trigger: ${clock.releaseTime}.000 ${clock.timezone}\nRelease lead: ${clock.leadMs} ms\n${clock.preopenCalendar ? '1. Check already-open target\n2. If enabled: click without refresh\n3. Otherwise: immediate reload fallback' : 'At release: bounded reload, minimal shell, strict target grid'}\nAuto-enable at 08:00: UNVERIFIED` : 'Configuration unavailable';
    byId('next-readiness').textContent = `Chrome/CDP: ${state.cdp ? 'REACHABLE' : 'NOT READY'}\nOnda: ${fresh && i?.gridToday && i.allCourts && i.visible ? 'READY (last inspection)' : 'NEEDS INSPECTION'}\nBooking plan: ${state.booking && !dirty ? 'READY' : 'NOT READY'}\nPlayer: ${state.booking?.playerConfigured ? 'READY' : 'NOT READY'}\nPre-open strategy: ${clock ? clock.preopenCalendar ? 'ON' : 'OFF' : 'UNKNOWN'}\nNo existing selections: ${fresh && i?.selected === 0 ? 'YES (last inspection)' : 'NOT VERIFIED'}\nAutomation lock: ${state.lock ? 'BLOCKED' : 'CLEAR'}\nTerms authorization: required per run\nRelease: ${clock ? `${clock.releaseTime} ${clock.timezone}` : 'UNKNOWN'}\nTarget: ${clock?.targetDate ?? 'UNKNOWN'}`;
    if (dual)
        byId('next-readiness').textContent = `2 courts / SAME TIME BLOCK\n${byId('dual-readiness').textContent}\nBooking plan: ${state.booking && !dirty ? 'SAVED' : 'NOT READY'}\nAutomation lock: ${state.lock ? 'BLOCKED' : 'CLEAR'}\nTerms authorization: required per run\nRelease: ${clock ? `${clock.releaseTime} ${clock.timezone}` : 'UNKNOWN'}\nTarget: ${clock?.targetDate ?? 'UNKNOWN'}`;
    const performance = state.releasePerformance, ms = (value) => value === null ? 'N/A' : `${value} ms`;
    const workerPerformance = (label, p) => p ? `${label}\nBranch: ${p.branch}\nTrigger → target enabled: ${ms(p.triggerToTargetEnabledMs)}\nTarget enabled → click: ${ms(p.targetEnabledToClickMs)}\nTarget click → grid ready: ${ms(p.targetClickToGridReadyMs)}\nGrid ready → snapshot: ${ms(p.gridReadyToSnapshotCompletedMs)}\nSnapshot → preference: ${ms(p.snapshotToPreferenceResolvedMs)}\n\nSELECTION\nPreference → first click: ${ms(p.preferenceToFirstSlotClickMs)}\nFirst click → last confirmed: ${ms(p.firstSlotClickToLastStateConfirmedMs)}\nLast confirmed → verification: ${ms(p.lastSlotConfirmedToSelectionVerificationMs)}\nVerification → Proceed: ${ms(p.selectionVerificationToBookingProceedMs)}\n\nCHECKOUT\nProceed → Review: ${ms(p.proceedToReviewDetectedMs)}\nReview detect → validate: ${ms(p.reviewDetectedToValidatedMs)}\nReview → Player form: ${ms(p.reviewValidatedToPlayerFormDetectedMs)}\nPlayer form → fill: ${ms(p.playerFormDetectedToFillCompletedMs)}\nFill → player Proceed: ${ms(p.fillCompletedToPlayerProceedMs)}\nPlayer Proceed → Payment: ${ms(p.playerProceedToPaymentSummaryDetectedMs)}\nPayment detect → validate: ${ms(p.paymentSummaryDetectedToValidatedMs)}\nPayment → Terms: ${ms(p.paymentValidatedToTermsControlMs)}\nTerms → checked: ${ms(p.termsControlToTermsCheckedMs)}\nChecked → final actionable: ${ms(p.termsCheckedToFinalButtonActionableMs)}\n\nHANDOFF\nFinal action → click: ${ms(p.finalActionStartedToClickedMs)}\nFinal click → Checkout: ${ms(p.finalClickToCheckoutPageMs)}\nCheckout → hold: ${ms(p.checkoutPageToHoldStatusMs)}\nHold → QR verified: ${ms(p.holdStatusToQrHandoffMs)}\n\nTOTAL\nTrigger → selection: ${ms(p.triggerToSelectionVerifiedMs)}\nTrigger → Proceed: ${ms(p.triggerToBookingProceedMs)}\nTrigger → final click: ${ms(p.triggerToFinalClickMs)}\nTrigger → QR hold: ${ms(p.triggerToQrHandoffMs)}\n\nCounters:\nSelection full-grid reads: ${p.counters.selectionFullGridReads}\nPre-Proceed grid reads: ${p.counters.preProceedGridReads}\nFull guards: ${p.counters.fullGuards}\nLight guards: ${p.counters.lightGuards}\nSlot clicks: ${p.counters.slotClicks}\nSelection summary reads: ${p.counters.selectionSummaryReads}\nReview parses: ${p.counters.reviewParses}\nPayment parses: ${p.counters.paymentSummaryParses}\nTerms acquisitions: ${p.counters.termsControlAcquisitions}` : `${label}\nN/A`;
    const overall = performance ? `OVERALL\nTrigger → both selections: ${ms(performance.overall.triggerToBothSelectionsVerifiedMs)}\nTrigger → both final clicks: ${ms(performance.overall.triggerToBothFinalClicksMs)}\nTrigger → both QR holds: ${ms(performance.overall.triggerToBothQrHandoffsMs)}` : 'OVERALL\nN/A';
    byId('release-performance').textContent = performance ? [workerPerformance('BROWSER A', performance.workers.A), workerPerformance('BROWSER B', performance.workers.B), overall].join('\n\n') : 'No release measurements in this session.';
    status('onda', i ? (fresh ? 'Verified' : 'Last inspection') : 'Not inspected', fresh ? 'good' : 'muted');
    status('venue', i ? 'Thirsty Pickle | SM Seaside' : 'Not verified', fresh ? 'good' : 'muted');
    status('filter', i ? (i.allCourts ? 'All Courts' : 'Check in Chrome') : 'Unknown', fresh && i?.allCourts ? 'good' : 'muted');
    status('displayed-date', i?.date ?? 'Unknown', fresh && i?.gridToday ? 'good' : 'warn');
    status('selected', i?.selected === null || !i ? 'Unknown' : String(i.selected), fresh && i?.selected === 0 ? 'good' : 'warn');
    byId('checked-at').textContent = i ? `Checked ${new Date(i.verifiedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila' })}` : 'Not inspected';
    if (state.clock) {
        byId('clock').textContent = state.clock.manilaTime;
        byId('clock-date').textContent = state.clock.manilaDate;
        byId('clock-source').textContent = state.clock.networkSynced ? `${state.clock.clockSource} · offset ${state.clock.clockOffsetMs.toFixed(1)} ms · RTT ${state.clock.clockRoundTripMs?.toFixed(1) ?? '?'} ms` : 'NETWORK CLOCK REQUIRED BEFORE RELEASE';
        byId('release-time').textContent = state.clock.releaseTime;
        byId('release-zone').textContent = state.clock.timezone;
        const activePlan = state.operation === 'observe' ? state.plan : null;
        byId('target-date').textContent = dateLabel(['observe', 'dry', 'selection', 'full'].includes(state.operation) && state.plan ? state.plan.targetDate : state.clock.targetDate);
        byId('safe-config').textContent = `Horizon ${state.clock.horizon} days · lead ${state.clock.leadMs} ms · max ${state.clock.maxReloads} reloads`;
    }
    const signature = JSON.stringify(state.logs);
    if (signature !== renderedLogs) {
        renderedLogs = signature;
        const log = byId('log');
        const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
        if (state.logs.length)
            log.replaceChildren(...state.logs.map(line => {
                const p = document.createElement('div');
                p.className = `activity-row ${line.level}`;
                const time = document.createElement('time');
                time.textContent = new Date(line.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
                const message = document.createElement('span');
                message.className = 'activity-message';
                message.textContent = line.text;
                const metrics = document.createElement('span');
                metrics.className = 'activity-metrics';
                if (line.elapsedMs !== undefined) {
                    for (const [label, value] of [['TOTAL', line.elapsedMs], ['STEP', Number(line.deltaMs ?? 0)]]) {
                        const chip = document.createElement('span');
                        chip.className = 'timing-chip';
                        chip.textContent = `${label} ${(value / 1000).toFixed(3)}s`;
                        metrics.append(chip);
                    }
                }
                p.append(time, message, metrics);
                return p;
            }));
        if (atBottom)
            log.scrollTop = log.scrollHeight;
    }
    byId('activity-state').textContent = busy ? `${state.operation.toUpperCase()} · PROCESS ACTIVE` : state.runTiming?.logPath ? 'TIMING LOG SAVED LOCALLY' : 'LOCAL PROCESS OUTPUT';
    const history = byId('run-history-list');
    const completed = (state.runHistory ?? []).filter(run => run.readyElapsedMs !== undefined && !/\bprepare\b/i.test(run.label));
    if (!completed.length)
        history.replaceChildren(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'No completed browser-ready runs recorded yet.' }));
    else
        history.replaceChildren(...completed.map(run => {
            const row = document.createElement('div');
            row.className = 'run-history-item';
            row.dataset.outcome = run.outcome;
            const summary = document.createElement('button');
            summary.type = 'button';
            summary.className = 'run-history-toggle';
            summary.setAttribute('aria-haspopup', 'dialog');
            const summaryGrid = document.createElement('span');
            summaryGrid.className = 'run-summary-grid';
            const label = document.createElement('strong');
            label.textContent = run.label.replaceAll('·', ' / ').toUpperCase();
            const duration = document.createElement('span');
            duration.className = 'run-time';
            duration.textContent = `${(run.readyElapsedMs / 1000).toFixed(3)} seconds`;
            const meta = document.createElement('span');
            meta.className = 'run-meta';
            meta.textContent = `${new Date(run.startedAt).toLocaleString('en-GB', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'medium' })} Manila · ${run.outcome.toUpperCase()} · browser-ready → finish · preparation excluded`;
            const disclosure = document.createElement('span');
            disclosure.className = 'run-disclosure';
            disclosure.textContent = 'View details';
            summaryGrid.append(label, duration, meta, disclosure);
            summary.append(summaryGrid);
            summary.onclick = () => showRunDetail(run);
            row.append(summary);
            return row;
        }));
    if (selectedRunId) {
        const selected = completed.find(run => run.runId === selectedRunId);
        if (selected)
            showRunDetail(selected);
        else
            closeRunDetail();
    }
    const previousHolds = state.previousHolds ?? [];
    byId('previous-holds').hidden = !previousHolds.length;
    // Every log line republishes the state. Rebuilding this list each time reset its scroll
    // position, so an operator could not read older holds while a run was writing output.
    const previousHoldsSignature = JSON.stringify(previousHolds);
    if (previousHoldsSignature !== renderedPreviousHolds) {
        renderedPreviousHolds = previousHoldsSignature;
        byId('previous-holds-list').replaceChildren(...previousHolds.map(hold => {
            const row = document.createElement('div');
            row.className = 'previous-hold-item';
            const label = document.createElement('strong');
            label.textContent = `Run ${hold.runID}`;
            const detail = document.createElement('span');
            detail.textContent = `Recorded expiry: ${hold.expiresAt ? new Date(hold.expiresAt).toLocaleString('en-GB', { timeZone: 'Asia/Manila' }) : 'Unknown'} Manila · Retained ${new Date(hold.archivedAt).toLocaleString('en-GB', { timeZone: 'Asia/Manila' })}`;
            row.append(label, detail);
            return row;
        }));
    }
    byId('mode-label').textContent = workflow === 'test' ? 'TEST NOW' : 'RELEASE BOOKING';
    byId('prepare').firstChild.textContent = 'RESET & PREPARE ';
    const methodValue = input('booking-method').value, apiFirst = ['api-first', 'proofless'].includes(methodValue), proofless = methodValue === 'proofless';
    byId('test-booking').textContent = proofless ? 'RUN PROOFLESS TEST TO QR' : apiFirst ? 'RUN API TEST TO QR' : 'RUN TEST TO QR';
    const specialDraft = input('session-mode').value === 'special-friday';
    byId('api-dry-controls').hidden = !apiFirst || workflow !== 'test' || specialDraft;
    byId('test-availability').hidden = !apiFirst || specialDraft;
    byId('api-preview').disabled = busy || state.lock || !state.apiFirstReady;
    const draftProblem = workflow === 'release' ? bookingSetupProblem(currentSetup()) : undefined;
    byId('configuration-status').hidden = workflow !== 'release';
    byId('configuration-status').textContent = draftProblem ? `CONFIGURATION: NEEDS ATTENTION\n${draftProblem}` : 'CONFIGURATION: VALID';
    byId('configuration-status').dataset.tone = draftProblem ? 'warn' : 'good';
    const adjustment = releaseAdjustment ?? state.bookingAdjustment ?? b?.fallbackReconciliation;
    byId('booking-adjustment').hidden = workflow !== 'release' || !adjustment?.removed.length;
    if (adjustment?.removed.length)
        byId('booking-adjustment').textContent = `BOOKING SETTINGS ADJUSTED\n${adjustment.removed.length} invalid fallback start${adjustment.removed.length === 1 ? ' was' : 's were'} removed because ${adjustment.removed.length === 1 ? 'it no longer fits' : 'they no longer fit'} the current primary booking.`;
    if (adjustment?.removed.length)
        byId('booking-adjustment').textContent = `BOOKING SETTINGS ADJUSTED\n${adjustment.removed.length} invalid fallback start${adjustment.removed.length === 1 ? ' was' : 's were'} removed.\nRemoved:\n${adjustment.removed.map(r => `${friendly(r.time)} - ${r.reason === 'CROSSES_MIDNIGHT' ? `${Number(input('duration').value)} hours would end after midnight` : r.reason === 'DUPLICATES_PRIMARY_START' ? 'duplicates the primary start' : r.reason === 'DUPLICATE_FALLBACK' ? 'duplicate fallback' : 'invalid time'}`).join('\n')}\nPrimary booking unchanged:\n${friendly(input('start-time').value)} -> ${endFriendly(input('start-time').value, Number(input('duration').value))}`;
    input('prepare').disabled = ['prepare', 'stopping', 'saving', 'resetting'].includes(state.operation) || !!draftProblem;
    byId('arm').textContent = armed ? 'CANCEL ARMED RELEASE' : 'ARM NEXT RELEASE';
    byId('arm').hidden = workflow === 'test';
    byId('test-booking').hidden = workflow === 'release';
    byId('test-date-label').hidden = workflow === 'release';
    input('test-booking').disabled = busy || dirty || state.lock || !state.ready || !input('terms').checked;
    input('terms').disabled = armed || busy || dirty || state.lock || !state.ready;
    byId('terms').parentElement.lastChild.textContent = workflow === 'test' ? ' I authorize accepting Onda Terms for this test' : ' I authorize accepting Onda Terms for this booking';
    if (workflow === 'release' && armed)
        byId('terms').parentElement.lastChild.textContent = ' AUTHORIZED FOR THIS EXACT SCHEDULED RUN';
    byId('workflow-test').setAttribute('aria-pressed', String(workflow === 'test'));
    byId('workflow-release').setAttribute('aria-pressed', String(workflow === 'release'));
    input('workflow-test').disabled = busy;
    input('workflow-release').disabled = busy;
    input('save-booking').disabled = busy || workflow === 'test';
    if (workflow === 'release') {
        input('arm').disabled ||= dirty || !state.ready || !input('terms').checked || !state.clock?.networkSynced || (!apiFirst && !fullReady);
        byId('blocked-reason').textContent = state.lock ? 'RESET REQUIRED' : dirty ? 'SETTINGS CHANGED · Press Reset & Prepare.' : !state.clock?.networkSynced ? 'Sync with Google Time before arming.' : !state.ready ? 'Reset & Prepare before arming.' : !input('terms').checked ? 'Authorize Terms, then Arm Next Release.' : '';
    }
    if (workflow === 'test')
        byId('blocked-reason').textContent = state.lock ? 'RESET REQUIRED' : dirty ? 'SETTINGS CHANGED · Press Reset & Prepare.' : !state.ready ? 'Reset & Prepare before running a test.' : !input('terms').checked ? 'Authorize Terms, then run your test.' : '';
    if (workflow === 'release' && armed) {
        input('arm').disabled = false;
        byId('blocked-reason').textContent = '';
    }
    if (state.bookingResult) {
        byId('handoff-result').hidden = false;
        byId('handoff-result').textContent = state.bookingResult.description + '\n' + state.bookingResult.outcomes.map((v, i) => `Checkout ${i + 1}: ${v}`).join('\n');
    }
    const duration = Number(input('duration').value), start = Number(input('start-time').value.slice(0, 2)), strategy = input('booking-type').value;
    const specialSession = input('session-mode').value === 'special-friday';
    const count = Number(input('court-count').value), releaseText = state.clock ? new Date(state.clock.releaseMs).toLocaleString('en-US', { timeZone: state.clock.timezone, month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Calculating';
    const method = input('booking-method').value === 'browser' ? 'NORMAL BROWSER' : input('booking-method').value === 'hybrid' ? 'HYBRID AVAILABILITY' : proofless ? 'PROOFLESS DIRECT' : 'API-FIRST · WITH PROOFS';
    const workers = specialSession ? SPECIAL_SESSION_WORKERS_UI : requiredWorkers(strategy, count), checkoutCount = workers.length;
    byId('booking-preview').textContent = specialSession
        ? `SPECIAL FRIDAY SESSION\nRelease: ${releaseText}\nTarget: ${state.clock ? dateLabel(state.clock.targetDate) : 'Not configured'}\n8 browsers/players A-H · up to 8 independent temporary QR holds · 4 distinct intended courts.\nA/B proof-based: Court 6 · 5:00–10:00 PM (A 5-8 PM + B 8-10 PM).\nC/D proof-based: Court 7 · 7:00–11:00 PM (C 7-9 PM + D 9-11 PM).\nE/F ADAPTIVE: Court 5 · 5:00–10:00 PM (E 5-8 PM + F 8-10 PM) — proof-based if fresh availability appears before 8:00 AM, otherwise the existing proofless direct attempt exactly at 8:00 AM. Never both.\nG/H proof-based bonus: Court 4 · 5:00–10:00 PM (G 5-8 PM + H 8-10 PM) — skipped entirely when no fourth distinct court has complete availability. Never proofless.\nCourt priority when a preferred court is unavailable follows a fallback search; all four assigned courts are always distinct.\nE/F's proofless-fallback hidden price assumes ₱700/hour and is UNVERIFIED.\nA hold is not a completed booking. Unknown outcomes are never retried. Payment: MANUAL`
        : `${workflow === 'release' ? `RELEASE PLAN\nRelease: ${releaseText}\nTarget: ${state.clock ? dateLabel(state.clock.targetDate) : 'Not configured'}\n` : ''}${method}\n${strategy.toUpperCase()} | ${count} COURT${count === 1 ? '' : 'S'}\n${friendly(input('start-time').value)} -> ${endFriendly(input('start-time').value, duration)} | ${duration} hours\nFallback starts: ${fallbackTimes.map(friendly).join(' -> ') || 'None'}\nCourt priority: ${courtOrder.join(' -> ')}\n${strategy === 'extended' ? `Extended split: ${duration === 4 ? '3h + 1h (alternatives 2h + 2h, 1h + 3h)' : duration === 5 ? '3h + 2h (alternative 2h + 3h)' : '3h + 3h'}\n` : ''}${workers.length} browser${workers.length === 1 ? '' : 's'} | ${checkoutCount} checkout${checkoutCount === 1 ? '' : 's'} | Players: ${workers.join(' + ')}\nNo price ceiling\nAttempts: ${input('attempts').value} | Payment: MANUAL${proofless ? '\nProofless Direct: Reset & Prepare audits all court/hour blocks; the armed run refreshes them at 7:30, selects the first unblocked saved fallback, and submits without availability proofs. Proofless tests require your manual confirmation that the exact cells are open.' : input('booking-method').value === 'api-first' ? '\nAPI first: availability and fresh per-hour proofs are acquired before checkout.' : ''}`;
    if (duration > 6) {
        byId('booking-preview').textContent = 'Extended booking supports up to 6 consecutive hours.';
        input('test-booking').disabled = true;
        input('arm').disabled = true;
    }
    const runWorkers = specialSession ? SPECIAL_SESSION_WORKERS_UI : requiredWorkers(strategy, count), playerReadyByWorker = { A: playerStatus.primary, B: playerStatus.extended, C: playerStatus.third, D: playerStatus.fourth, E: playerStatus.fifth, F: playerStatus.sixth, G: playerStatus.seventh, H: playerStatus.eighth };
    const playersReady = runWorkers.every(worker => playerReadyByWorker[worker]);
    byId('player-status').textContent = runWorkers.map(worker => `${workerLabel(worker)}: ${playerReadyByWorker[worker] ? 'Configured' : 'Missing'}`).join(' | ');
    const profile = (label, p) => { const card = document.createElement('div'); const heading = document.createElement('strong'); heading.textContent = label; card.append(heading, document.createElement('br'), document.createTextNode(p ? `${p.fullName}\n${p.phone}\n${p.email}` : 'Missing or invalid configuration')); card.style.whiteSpace = 'pre-line'; return card; };
    const profiles = { A: playerStatus.primaryDetails, B: playerStatus.extendedDetails, C: playerStatus.thirdDetails, D: playerStatus.fourthDetails, E: playerStatus.fifthDetails, F: playerStatus.sixthDetails, G: playerStatus.seventhDetails, H: playerStatus.eighthDetails };
    byId('player-details').replaceChildren(...runWorkers.map(worker => profile(`${workerLabel(worker)} · Checkout ${worker}`, profiles[worker])));
    input('test-booking').disabled ||= !playersReady;
    input('arm').disabled ||= !playersReady;
    const releaseMode = workflow === 'release';
    byId('release-schedule').hidden = !releaseMode;
    byId('release-readiness-card').hidden = !releaseMode;
    byId('block-audit-card').hidden = !releaseMode;
    if (!input('block-audit-date').value && state.clock?.targetDate)
        input('block-audit-date').value = state.clock.targetDate;
    const blockAuditDate = input('block-audit-date').value;
    byId('check-release-blocks').disabled = busy || !blockAuditDate;
    const audit = state.blockAudit?.date === blockAuditDate ? state.blockAudit : null;
    renderBlockAudit(byId('block-audit-result'), audit, blockAuditDate);
    if (releaseMode && state.clock) {
        byId('release-passed').textContent = state.clock.todayReleasePassed ? `TODAY'S ${friendly(state.clock.releaseTime.slice(0, 5))} RELEASE HAS PASSED` : '';
        byId('next-release').textContent = new Date(armed ? state.scheduledRelease.releaseMs : state.clock.releaseMs).toLocaleString('en-US', { timeZone: state.clock.timezone, month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        byId('next-target').textContent = dateLabel(armed ? state.scheduledRelease.targetDate : state.clock.targetDate);
        const finalAt = (armed ? state.scheduledRelease.releaseMs : state.clock.releaseMs) - state.clock.preflightSecondsBefore * 1000;
        byId('schedule-meta').textContent = `Final preflight: ${new Date(finalAt).toLocaleTimeString('en-US', { timeZone: state.clock.timezone, hour: 'numeric', minute: '2-digit', second: '2-digit' })} | System: ${state.scheduleStatus ?? (armed ? 'WAITING' : 'NOT ARMED')}`;
    }
    const apiPrepared = !!state.apiFirstReady && !!state.ready && !!state.booking && ['api-first', 'proofless'].includes(state.booking.setup.BOOKING_METHOD) && !state.lock;
    const prepared = apiPrepared || !!state.preparedContext && state.preparedContext.workflow === 'release' && state.preparedContext.configFingerprint === state.booking?.fingerprint;
    const required = specialSession ? SPECIAL_SESSION_WORKERS_UI : requiredWorkers(strategy, count);
    const verificationGates = apiFirst
        ? [['Onda venue verified', apiPrepared], [proofless ? 'Court/hour block audit complete' : 'Availability checked', proofless ? state.assumedPrice !== undefined && state.assumedPrice !== null : state.apiStage?.stage === 'CANDIDATE_READY' || !!state.observedPrice]]
        : [['Onda verified', prepared], ['All Courts verified', prepared], ['Selected slots: 0', prepared], ['Payment holds: none', prepared && !state.lock]];
    const gates = [['Configuration valid', !draftProblem], ['Google network clock synchronized', !!state.clock?.networkSynced], ['Next release calculated', !!state.clock], ['Booking target calculated', !!state.clock?.targetDate], ...required.map(id => [`${workerLabel(id)} configured`, !!playerReadyByWorker[id]]), ...required.map(id => [`Browser ${id} prepared`, apiFirst ? apiPrepared && !!state.browserHealth?.[id] : prepared && !!state.preparedContext?.browsers.some(b => b.id === id)]), ...verificationGates, ['Automation lock clear', !state.lock], ['Prepared fingerprint matches', prepared], ['Terms authorized for this run', state.termsAuthorized || armed], ['Armed for next release', armed || state.apiStage?.stage === 'WAITING_FOR_RELEASE']];
    const readiness = byId('release-readiness');
    readiness.replaceChildren(...gates.map(([label, ok]) => { const e = document.createElement('div'); e.className = `gate ${ok ? 'good' : 'warn'}`; e.textContent = `${ok ? 'OK' : '--'} ${label}`; return e; }));
    readiness.className = 'gate-list';
    byId('release-readiness-card').dataset.state = armed ? 'armed' : prepared ? 'prepared' : 'draft';
    byId('sleep-warning').hidden = !armed;
    byId('sleep-warning').textContent = `Sleep protection: ${state.sleepProtection ? 'ACTIVE' : 'NOT AVAILABLE'} | Keep the PC powered on. Do not hibernate or close the laptop lid if Windows sleeps on lid close.`;
    byId('saved-plan-summary').textContent = state.booking ? (state.booking.setup.SESSION_MODE === 'special-friday' ? `SPECIAL FRIDAY SESSION\nA/B proof-based · preferred Court 6 · 5:00–10:00 PM\nC/D proof-based · preferred Court 7 · 7:00–11:00 PM\nE/F adaptive · preferred Court 5 · 5:00–10:00 PM (proof-based on early availability, else proofless exactly at 8:00 AM)\nG/H proof-based bonus · preferred Court 4 · 5:00–10:00 PM (skipped if no fourth distinct court)\nPlayers/Browsers A–H · up to 8 independent QR holds across 4 distinct courts\nTarget: ${dateLabel(state.booking.targetDate)}` : `${state.booking.setup.BOOKING_METHOD.toUpperCase()} · ${state.booking.setup.BOOKING_TYPE.toUpperCase()} · ${state.booking.setup.COURT_COUNT} court${state.booking.setup.COURT_COUNT === 1 ? '' : 's'}\n${friendly(state.booking.setup.START_TIME)}–${endFriendly(state.booking.setup.START_TIME, state.booking.setup.DURATION_HOURS)} · ${state.booking.setup.DURATION_HOURS} hours\nCourt priority: ${state.booking.setup.PREFERRED_COURTS.join(' → ')}\nFallback starts: ${state.booking.setup.FALLBACK_TIMES.map(friendly).join(', ') || 'None'}\nTarget: ${dateLabel(state.booking.targetDate)}`) : 'No saved plan available.';
    const actualAmount = state.handoff?.amount ?? state.observedPrice ?? state.selection?.amount;
    byId('observed-price').hidden = (actualAmount === undefined || actualAmount === null) && (state.assumedPrice === undefined || state.assumedPrice === null);
    byId('observed-price').textContent = [actualAmount !== undefined && actualAmount !== null ? `Observed booking price: ₱${actualAmount.toLocaleString()} · Review the amount in Onda before final booking authorization.` : '',
        state.assumedPrice !== undefined && state.assumedPrice !== null ? `Direct-lane estimated total: ₱${state.assumedPrice.toLocaleString()} · UNVERIFIED prior-rate assumption; Friday's actual price may differ.` : '',
        'Payment stays manual.'].filter(Boolean).join('\n');
    const action = input('main-action'), hold = !!state.handoff || !!state.lock, blockedHold = hold && !state.canPrepareOverHold;
    const apiWaiting = state.operation === 'full' && state.apiStage?.stage === 'WAITING_FOR_RELEASE';
    const actionState = apiWaiting ? 'armed' : busy ? 'running' : blockedHold ? 'hold' : armed ? 'armed' : state.ready && !dirty ? 'review' : 'prepare';
    action.textContent = actionState === 'prepare' && unresolvedCheckout ? 'Reset & Prepare' : actionState === 'prepare' && state.canPrepareOverHold ? 'Prepare New Run' : { hold: 'Review Hold', running: 'Running', armed: 'Armed', review: 'Review & Arm', prepare: 'Prepare' }[actionState];
    action.disabled = actionState === 'running' || actionState === 'armed' || actionState === 'prepare' && !!input('prepare').disabled;
    byId('main-action-hint').textContent = unresolvedCheckout ? 'Inspects every required browser; it will not clear the lock unless the old worker is dead and all Onda state is clean.' : state.canPrepareOverHold ? 'The verified hold stays recorded. Prepare a fresh schedule in the same bot before another run.' : blockedHold ? 'Review the retained lock before any new action.' : actionState === 'review' ? 'Review Terms and authorize this exact run before arming.' : actionState === 'armed' ? 'Release is scheduled. Use Emergency Stop to cancel.' : actionState === 'running' ? 'Current booking operation is in progress.' : 'Check the plan, then prepare the required browser or browsers.';
    byId('primary-actions').hidden = currentView !== 'tests' && !state.selection && !state.handoff && !state.bookingResult && !armed;
    const testDate = input('test-date').value;
    input('test-date').disabled = busy;
    const testPrepared = !!state.ready && !testDirty && state.workflow === 'test' && !!b && (['api-first', 'proofless'].includes(b.setup.BOOKING_METHOD) && !!state.apiFirstReady ||
        !!state.preparedContext && state.preparedContext.workflow === 'test' && state.preparedContext.date === testDate);
    const testBrowsers = b ? requiredWorkers(b.setup.BOOKING_TYPE, b.setup.COURT_COUNT) : ['A'];
    const testGates = [
        ['Test date selected', !!testDate], ['Saved booking plan', !!b], ...testBrowsers.map(id => [`${workerLabel(id)} configured`, !!playerReadyByWorker[id]]),
        ...testBrowsers.map(id => [`Browser ${id} prepared`, testPrepared && !!state.browserHealth?.[id]]),
        ['Automation lock clear', !state.lock], ['Preparation matches this date and plan', testPrepared],
        ['Terms authorized for this test', !!state.termsAuthorized]
    ];
    byId('test-readiness').replaceChildren(...testGates.map(([label, ok]) => { const row = document.createElement('div'); row.className = `gate ${ok ? 'good' : 'warn'}`; row.textContent = `${ok ? 'OK' : '--'} ${label}`; return row; }));
    const specialSaved = b?.setup.SESSION_MODE === 'special-friday';
    byId('test-plan-summary').textContent = specialSaved ? 'SPECIAL FRIDAY SESSION is release-only. Use Next Release to prepare and arm it.' : b ? `${b.setup.BOOKING_METHOD.toUpperCase()} · ${b.setup.BOOKING_TYPE.toUpperCase()} · ${b.setup.COURT_COUNT} court${b.setup.COURT_COUNT === 1 ? '' : 's'}\n${friendly(b.setup.START_TIME)}–${endFriendly(b.setup.START_TIME, b.setup.DURATION_HOURS)} · ${b.setup.DURATION_HOURS} hours\nCourt priority: ${b.setup.PREFERRED_COURTS.join(' → ')}\nFallback starts: ${b.setup.FALLBACK_TIMES.map(friendly).join(', ') || 'None'}\nTest date: ${testDate ? dateLabel(testDate) : 'Choose a date'}${input('exact-a').value.trim() || input('exact-b').value.trim() ? `\nAdvanced exact court override: ${[input('exact-a').value, input('exact-b').value].filter(Boolean).join(' / ')}` : ''}` : 'No saved booking plan available.';
    const liveTestHandoffs = workflow === 'test' && state.workflow === 'test' ? activeHandoffs(state) : [];
    const readyTestHandoffs = liveTestHandoffs.filter(hold => (hold.status ?? 'qr-ready') === 'qr-ready').length;
    const expectedTestHandoffs = Math.max(testBrowsers.length, liveTestHandoffs.length);
    byId('test-headline').textContent = liveTestHandoffs.length
        ? readyTestHandoffs === expectedTestHandoffs ? 'CONFIRM BOOKING DETAILS BEFORE PAYING' : `CHECKOUTS REACHING QR · ${readyTestHandoffs}/${expectedTestHandoffs}`
        : workflow === 'test' && state.workflow === 'test' ? state.headline : state.lock ? 'Review retained hold' : testPrepared ? 'Ready to test' : 'Prepare to test';
    const baseTestDetail = liveTestHandoffs.length
        ? `${readyTestHandoffs} of ${expectedTestHandoffs} required QR page${expectedTestHandoffs === 1 ? ' is' : 's are'} verified. Check the player, courts, date, every hourly slot, amount, and booking reference below before scanning any QR code.`
        : specialSaved ? 'This special session can only run through Next Release.' : workflow === 'test' && state.workflow === 'test' ? state.detail : state.lock ? 'Review the existing browser and payment hold before testing again.' : testPrepared ? 'Review Terms, then run the saved plan.' : 'Choose a date, then prepare the saved booking plan.';
    byId('test-detail').textContent = baseTestDetail;
    const testState = busy ? 'running' : blockedHold ? 'hold' : testPrepared ? 'review' : 'prepare';
    const testButton = input('test-main-action');
    testButton.textContent = testState === 'prepare' && unresolvedCheckout ? 'Reset & Prepare' : testState === 'prepare' && state.canPrepareOverHold ? 'Prepare New Run' : { running: 'Running', hold: 'Review Hold', review: 'Review & Test', prepare: 'Prepare' }[testState];
    testButton.disabled = !!specialSaved || testState === 'running' || testState === 'prepare' && (!b || !testDate || blockedHold);
    input('test-booking').disabled ||= !!specialSaved;
    byId('test-main-action-hint').textContent = specialSaved ? 'Release-only safety mode: prepare and arm this session from Next Release.' : unresolvedCheckout ? 'Inspects both API browsers and clears the retained safety lock only after clean-state verification.' : state.canPrepareOverHold ? 'The verified hold stays recorded. Preparing opens a fresh schedule in the same bot.' : blockedHold ? 'Review the retained lock before another test.' : testState === 'review' ? 'This test can create real temporary payment holds. Review Terms and confirm the test before continuing.' : testState === 'running' ? 'The current test is in progress.' : 'Prepare the required browser or browsers for the selected date.';
    testResults.hidden = !!byId('observed-price').hidden && !!byId('selection-result').hidden && !!byId('handoff-result').hidden;
    syncViableControls();
    syncSpecialSessionControls();
    tick();
}
byId('main-action').onclick = () => { if (!latest)
    return; if ((latest.lock || latest.handoff) && !latest.canPrepareOverHold) {
    void window.thirsty.reviewLock().catch(() => { });
    return;
} if (latest.ready && !dirty) {
    if (input('terms').checked)
        input('arm').click();
    else
        byId('terms').focus();
}
else
    input('prepare').click(); };
byId('test-main-action').onclick = () => { if (!latest)
    return; if ((latest.lock || latest.handoff) && !latest.canPrepareOverHold) {
    void window.thirsty.reviewLock().catch(() => { });
    return;
} if (input('test-main-action').textContent === 'Review & Test') {
    if (input('terms').checked)
        input('test-booking').click();
    else
        byId('terms').focus();
}
else
    input('prepare').click(); };
function tick() {
    // Display only; never launches a command. Authoritative release plan comes from main/CLI.
    const effectiveNow = Date.now() + (latest?.clock?.clockOffsetMs ?? 0), now = new Date(effectiveNow);
    byId('clock').textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Manila', hourCycle: 'h23' }).format(now);
    byId('clock-date').textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(now);
    if (!latest)
        return;
    renderQrSummary(latest);
    if (latest.clock) {
        const remaining = Math.max(0, Math.ceil(((latest.scheduledRelease?.releaseMs ?? latest.clock.releaseMs) - effectiveNow) / 1000));
        byId('next-release-countdown').textContent = [Math.floor(remaining / 3600), Math.floor(remaining / 60) % 60, remaining % 60].map(v => String(v).padStart(2, '0')).join(':');
    }
    byId('run-timing').textContent = latest.runTiming?.readyAt ? `${((latest.runTiming.endedAt ? latest.runTiming.readyElapsedMs ?? 0 : Math.max(0, Date.now() - Date.parse(latest.runTiming.readyAt))) / 1000).toFixed(3)} seconds · ${latest.runTiming.endedAt ? 'finished' : 'running'}` : latest.runTiming ? 'Waiting for browser ready' : 'No browser-ready run active';
    if (latest.runTiming && (!latest.runTiming.endedAt || latest.runTiming.readyAt)) {
        const run = latest.runTiming;
        if (!run.readyAt) {
            byId('countdown').textContent = '--:--:--.---';
            byId('countdown-label').textContent = run.endedAt ? 'READY TIMING UNAVAILABLE' : `${run.label.toUpperCase()} · WAITING FOR BROWSER`;
            byId('release-time').textContent = 'Timing starts when browser is ready';
            byId('release-zone').textContent = 'startup excluded';
            return;
        }
        const readyKey = `${run.runId}:${run.readyAt}`;
        if (timingReadyKey !== readyKey) {
            timingReadyKey = readyKey;
            timingReadyStartedMono = performance.now();
            timingReadyInitialMs = Math.max(0, Date.now() - Date.parse(run.readyAt));
        }
        const elapsed = run.endedAt ? run.readyElapsedMs ?? 0 : Math.max(0, timingReadyInitialMs + performance.now() - timingReadyStartedMono);
        const seconds = Math.floor(elapsed / 1000);
        byId('countdown').textContent = `${[Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(v => String(v).padStart(2, '0')).join(':')}.${String(Math.floor(elapsed % 1000)).padStart(3, '0')}`;
        byId('countdown-label').textContent = run.endedAt ? 'LAST RUN · BROWSER READY → FINISH' : `${run.label.toUpperCase()} · BROWSER READY`;
        byId('release-time').textContent = `${(elapsed / 1000).toFixed(3)} seconds`;
        byId('release-zone').textContent = `${Math.round(elapsed)} milliseconds · preparation excluded`;
        return;
    }
    if (!latest.clock)
        return;
    const release = latest.scheduledRelease?.releaseMs ?? (latest.plan && ['observe', 'dry', 'selection', 'full'].includes(latest.operation) ? latest.plan.releaseMs : latest.clock.releaseMs);
    const seconds = Math.max(0, Math.ceil((release - effectiveNow) / 1000));
    byId('countdown').textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(v => String(v).padStart(2, '0')).join(':');
    byId('next-release-countdown').textContent = byId('countdown').textContent;
    byId('countdown-label').textContent = latest.operation === 'observe' ? 'SCHEDULED RELEASE IN' : 'NEXT RELEASE IN';
    const hold = latest.bookingResult ? null : latest.handoff;
    if (hold) {
        const [m, s] = hold.countdown.split(':').map(Number);
        const elapsed = (Date.now() - Date.parse(hold.verifiedAt)) / 1000;
        const active = elapsed < m * 60 + s;
        byId('handoff-result').textContent = `${active ? 'PAYMENT HOLD ACTIVE — VERIFIED AT HANDOFF' : 'HOLD NEEDS MANUAL REVIEW'}\nVenue: Thirsty Pickle | SM Seaside\nCourt ${hold.court} · ${hold.date}\nTime: ${hold.hours[0]}–${String(Number(hold.hours.at(-1).slice(0, 2)) + 1).padStart(2, '0')}:00\nAmount: ₱${hold.amount.toLocaleString()}\nLast observed status: Pending\nHold countdown at verification: ${hold.countdown}\nVerified: ${new Date(hold.verifiedAt).toLocaleString('en-GB', { timeZone: 'Asia/Manila' })}\n${active ? 'Complete payment manually in Chrome.' : 'The observed countdown has elapsed. Check Chrome manually.'}\nAUTOMATION STOPPED · AUTOMATION LOCK RETAINED`;
    }
}
for (const [id, action] of Object.entries({ 'sync-clock': () => window.thirsty.syncClock(), 'review-lock': () => window.thirsty.reviewLock(), 'clear-lock': () => window.thirsty.clearLock(), 'reset-practice': () => window.thirsty.resetPractice(), 'dual-prepare': () => window.thirsty.prepareDual(), 'api-preview': () => window.thirsty.apiPreview(input('test-date').value), 'full-practice': async () => { const authorized = input('full-terms').checked; input('full-terms').checked = false; await window.thirsty.runFullPractice({ target: { date: input('full-date').value, court: Number(input('full-court').value), start: input('full-start').value, duration: Number(input('full-duration').value) }, authorizeTerms: authorized }); }, chrome: () => window.thirsty.startChrome(), inspect: () => window.thirsty.inspectOnda(), prepare: async () => { input('terms').checked = false; storeDraft(); await window.thirsty.resetPrepare(workflow === 'test' ? { workflow: 'test', ...testRequest() } : { workflow: 'release', strategy: input('booking-type').value, setup: currentSetup() }); const state = await window.thirsty.getStatus(); if (state.ready) {
        if (workflow === 'test')
            testDirty = false;
        else
            releaseDirty = false;
        dirty = false;
    } render(state); }, arm: () => window.thirsty.armFullBooking(), dry: () => window.thirsty.dryRace(), observe: () => window.thirsty.armObservation(), stop: () => window.thirsty.abortAutomation(), practice: () => window.thirsty.runPractice({ date: input('practice-date').value, court: Number(input('practice-court').value), start: input('practice-start').value, duration: Number(input('practice-duration').value) }) })) {
    byId(id).addEventListener('click', () => { void action().catch(async () => { render(await window.thirsty.getStatus()); }); });
}
byId('check-release-blocks').addEventListener('click', () => { void window.thirsty.checkReleaseBlocks(input('block-audit-date').value).catch(async () => { render(await window.thirsty.getStatus()); }); });
byId('block-audit-date').addEventListener('change', () => { if (latest)
    render(latest); });
byId('full-terms').addEventListener('change', () => { if (latest)
    render(latest); });
for (const id of ['full-date', 'full-court', 'full-start', 'full-duration'])
    byId(id).addEventListener('change', () => { input('full-terms').checked = false; if (latest)
        render(latest); });
byId('mode-full').addEventListener('change', () => { void window.thirsty.setMode('full').catch(() => { }); });
byId('mode-selection').addEventListener('change', () => { void window.thirsty.setMode('selection').catch(() => { }); });
byId('terms').addEventListener('change', () => { void window.thirsty.authorizeTerms(input('terms').checked).catch(() => { input('terms').checked = false; }); });
for (const id of ['booking-method', 'test-date', 'court-count', 'start-time', 'duration', 'attempts', 'exact-a', 'exact-b'])
    byId(id).addEventListener('change', changed);
byId('session-mode').addEventListener('change', () => { syncSpecialSessionControls(); syncViableControls(); syncSpecialSessionControls(); changed(); });
byId('booking-type').addEventListener('change', () => { const extended = input('booking-type').value === 'extended', d = Number(input('duration').value); if (extended && d < 4)
    input('duration').value = '4'; if (!extended && d > 3)
    input('duration').value = '3'; syncViableControls(); changed(); });
byId('add-fallback').onclick = () => { const h = input('fallback-time').value; if (h === input('start-time').value || fallbackTimes.includes(h)) {
    byId('edit-status').textContent = 'Choose a different fallback start.';
    return;
} if (workflow === 'release') {
    const reconciliation = reconcileFallbackTimes(input('start-time').value, Number(input('duration').value), [...fallbackTimes, h]);
    if (reconciliation.removed.length) {
        releaseAdjustment = reconciliation;
        byId('edit-status').textContent = bookingSetupProblem({ ...currentSetup(), FALLBACK_TIMES: [...fallbackTimes, h] }) ?? 'That fallback does not fit the current booking.';
        if (latest)
            render(latest);
        return;
    }
} fallbackTimes.push(h); editors(); changed(); };
byId('save-booking').onclick = () => {
    void (async () => {
        const setup = { SESSION_MODE: input('session-mode').value, BOOKING_METHOD: input('booking-method').value, BOOKING_TYPE: input('booking-type').value, COURT_COUNT: Number(input('court-count').value), START_TIME: input('start-time').value, DURATION_HOURS: Number(input('duration').value), PREFERRED_COURTS: courtOrder, FALLBACK_COURTS: [], FALLBACK_TIMES: fallbackTimes, MAX_SELECTION_ATTEMPTS: Number(input('attempts').value) };
        await window.thirsty.saveBooking(setup);
        const state = await window.thirsty.getStatus();
        if (state.headline === 'Booking plan saved') {
            releaseDirty = false;
            if (workflow === 'release')
                dirty = false;
            loadedPlan = '';
            byId('edit-status').textContent = 'BOOKING PLAN SAVED';
            render(state);
        }
        else
            byId('edit-status').textContent = 'Plan rejected. Check duration and unique times.';
    })().catch(() => { byId('edit-status').textContent = 'Could not save booking setup.'; });
};
byId('dual-dry').onclick = () => { void window.thirsty.runDualPractice({ kind: 'dualDry', date: input('dual-date').value }).catch(() => { }); };
for (const [id, kind] of [['dual-selection', 'dualPractice'], ['dual-full', 'dualFullPractice']])
    byId(id).onclick = () => {
        const authorized = input('dual-terms').checked;
        input('dual-terms').checked = false;
        void window.thirsty.runDualPractice({ kind, input: { target: { date: input('dual-date').value, court: Number(input('dual-court-a').value), start: input('dual-start').value, duration: Number(input('dual-duration').value) }, courtB: Number(input('dual-court-b').value), noncompetitive: input('dual-noncompetitive').checked, authorizeTerms: kind === 'dualFullPractice' && authorized, armed: kind === 'dualFullPractice' } }).catch(() => { });
    };
for (const id of ['dual-date', 'dual-court-a', 'dual-court-b', 'dual-start', 'dual-duration', 'dual-noncompetitive'])
    byId(id).addEventListener('change', () => { input('dual-terms').checked = false; if (latest)
        render(latest); });
byId('dual-terms').addEventListener('change', () => { if (latest)
    render(latest); });
for (const [id, mode] of [['workflow-test', 'test'], ['workflow-release', 'release']])
    byId(id).onclick = () => { storeDraft(); workflow = mode; if (mode === 'test' && testDraft)
        applyDraft(testDraft); if (mode === 'release' && releaseDraft)
        applyDraft(releaseDraft); dirty = mode === 'test' ? testDirty : releaseDirty; input('terms').checked = false; void window.thirsty.setWorkflow(mode); if (latest)
        render(latest); };
function testRequest() {
    const setup = latest?.booking?.setup;
    if (!setup)
        throw Error('BOOKING_PLAN_MISSING');
    const exactA = input('exact-a').value.trim(), exactB = input('exact-b').value.trim();
    const exact = exactA || exactB ? { exact: (setup.BOOKING_TYPE === 'extended' ? [exactA, exactB] : [exactA]).map(value => value.split(',').map(court => Number(court.trim()))) } : {};
    return { method: setup.BOOKING_METHOD, request: { strategy: setup.BOOKING_TYPE, date: input('test-date').value, start: setup.START_TIME, duration: setup.DURATION_HOURS, courtCount: setup.COURT_COUNT, priority: [...setup.PREFERRED_COURTS], fallbackStarts: [...setup.FALLBACK_TIMES], ...exact } };
}
function currentSetup() { return { SESSION_MODE: input('session-mode').value, BOOKING_METHOD: input('booking-method').value, BOOKING_TYPE: input('booking-type').value, COURT_COUNT: Number(input('court-count').value), START_TIME: input('start-time').value, DURATION_HOURS: Number(input('duration').value), PREFERRED_COURTS: courtOrder, FALLBACK_COURTS: [], FALLBACK_TIMES: fallbackTimes, MAX_SELECTION_ATTEMPTS: Number(input('attempts').value) }; }
byId('test-booking').onclick = () => { const authorized = input('terms').checked; input('terms').checked = false; void window.thirsty.testBooking({ ...testRequest(), authorizeTerms: authorized }).catch(() => { byId('detail').textContent = 'Check booking fields and Terms authorization.'; }); };
window.thirsty.onStatus(render);
void window.thirsty.getStatus().then(render);
setInterval(tick, 100);
const activity = document.querySelector('.activity');
const expand = byId('activity-expand');
function setActivityExpanded(value) { activity.classList.toggle('expanded', value); expand.setAttribute('aria-expanded', String(value)); expand.textContent = value ? 'Restore' : 'Maximize'; }
expand.addEventListener('click', () => setActivityExpanded(!activity.classList.contains('expanded')));
byId('run-detail-close').addEventListener('click', closeRunDetail);
byId('run-detail-modal').addEventListener('click', event => { if (event.target === byId('run-detail-modal'))
    closeRunDetail(); });
byId('confirm-cancel').addEventListener('click', () => settleConfirm(false));
byId('confirm-ok').addEventListener('click', () => settleConfirm(true));
document.addEventListener('keydown', event => { if (event.key !== 'Escape')
    return; if (!byId('confirm-modal').hidden)
    settleConfirm(false);
else if (!byId('run-detail-modal').hidden)
    closeRunDetail();
else if (activity.classList.contains('expanded'))
    setActivityExpanded(false); });
//# sourceMappingURL=app.js.map