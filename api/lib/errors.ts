/** Thrown by routes/services; app.ts turns it into `{error}` JSON. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function abort(
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): never {
  throw new HttpError(status, message, extra);
}
