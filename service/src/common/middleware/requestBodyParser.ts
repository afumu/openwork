import { json, urlencoded } from 'express';

export const DEFAULT_REQUEST_BODY_LIMIT = '20mb';

export function resolveRequestBodyLimit(rawLimit = process.env.REQUEST_BODY_LIMIT) {
  const limit = rawLimit?.trim();
  return limit || DEFAULT_REQUEST_BODY_LIMIT;
}

export function registerRequestBodyParsers(
  app: { use: (...handlers: any[]) => unknown },
  limit = resolveRequestBodyLimit(),
) {
  app.use(json({ limit }));
  app.use(urlencoded({ extended: true, limit }));
}
