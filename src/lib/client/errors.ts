'use client';

import { ApiFailure } from './api';
import type { TKey, Translator } from '@/lib/i18n';

/**
 * Turns any thrown value into a translated, user-safe sentence. Server messages
 * arrive as translation keys, never as prose, so nothing untranslated or
 * internal is ever rendered.
 */
export function messageFor(t: Translator, err: unknown): string {
  if (err instanceof ApiFailure) {
    const key = err.payload.messageKey;
    if (key) return t(key as TKey, (err.payload as { meta?: Record<string, string> }).meta);
    return t('errors.server');
  }
  if (err instanceof TypeError) return t('errors.network');
  return t('errors.server');
}

/** Field-level messages from a 422 response, already translated. */
export function fieldErrorsFor(t: Translator, err: unknown): Record<string, string> {
  if (!(err instanceof ApiFailure) || !err.payload.fields) return {};
  return Object.fromEntries(
    Object.entries(err.payload.fields).map(([field, key]) => [
      field,
      key.includes('.') ? t(key as TKey) : t('errors.validation'),
    ]),
  );
}
