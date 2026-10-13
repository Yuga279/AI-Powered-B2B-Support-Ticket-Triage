export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what) => new AppError(404, 'not_found', `${what} not found`);
export const badRequest = (message, details) => new AppError(400, 'bad_request', message, details);
export const conflict = (message) => new AppError(409, 'conflict', message);

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
