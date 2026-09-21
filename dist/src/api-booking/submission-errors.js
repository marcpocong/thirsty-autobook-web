export class SubmissionDispatchError extends Error {
    code;
    dispatched;
    diagnostic;
    constructor(code, dispatched, diagnostic) {
        super(code);
        this.code = code;
        this.dispatched = dispatched;
        this.diagnostic = diagnostic;
        this.name = 'SubmissionDispatchError';
    }
}
//# sourceMappingURL=submission-errors.js.map