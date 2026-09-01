/** Error with an API error code attached, thrown by handlers and validators. */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  static badRequest(message) {
    return new ApiError(400, 'INVALID_INPUT', message);
  }
  static unauthenticated(message = 'Authentication required') {
    return new ApiError(401, 'UNAUTHENTICATED', message);
  }
  static forbidden(message = 'Insufficient permissions') {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Not found') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(message) {
    return new ApiError(409, 'CONFLICT', message);
  }
}

/** Wrap an async handler so a rejected promise reaches the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFoundHandler(req, res) {
  // originalUrl, not path: this handler is mounted under /api, and req.path has
  // the mount prefix stripped, which would report the wrong route back.
  const url = req.originalUrl.split('?')[0];
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${url}` } });
}

/* eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity */
export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err?.name === 'ConflictError') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: err.message } });
  }
  if (err?.name === 'InvalidKeyError') {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: err.message } });
  }
  // A body-parser failure on malformed JSON.
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Malformed JSON body' } });
  }
  // A body over the configured size cap. Without this it would fall through to
  // the 500 branch below and be reported as a server fault rather than the
  // client error it is.
  if (err?.type === 'entity.too.large') {
    return res
      .status(413)
      .json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the size limit' } });
  }

  // Unexpected: log the detail, return none. Internal messages can leak schema
  // and file paths, so they never cross the wire.
  console.error('[error]', err);
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}
