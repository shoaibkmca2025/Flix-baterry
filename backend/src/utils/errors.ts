// The only error type services are allowed to throw (rules.md §5). Never throw a plain string.
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field?: string;
  readonly nextAction?: string;
  readonly details?: unknown;

  constructor(
    code: string,
    status: number,
    message: string,
    opts?: { field?: string; nextAction?: string; details?: unknown },
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.field = opts?.field;
    this.nextAction = opts?.nextAction;
    this.details = opts?.details;
  }
}
