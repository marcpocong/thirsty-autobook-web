export class SubmissionDispatchError extends Error {
    code;
    dispatched;
    diagnostic;
    confirmedRejected;
    constructor(code, dispatched, diagnostic, confirmedRejected = false) {
        super(code);
        this.code = code;
        this.dispatched = dispatched;
        this.diagnostic = diagnostic;
        this.confirmedRejected = confirmedRejected;
        this.name = 'SubmissionDispatchError';
    }
}
//# sourceMappingURL=submission-errors.js.map