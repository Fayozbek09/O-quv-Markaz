import { describe, it, expect } from 'vitest';
import { normalizePhone } from '@/lib/validation/common';

describe('normalizePhone', () => {
  it('normalizes the shapes Uzbek users actually type', () => {
    const expected = '+998901234567';
    for (const input of [
      '+998901234567',
      '998901234567',
      '901234567',
      '+998 90 123 45 67',
      '(90) 123-45-67',
      '00998901234567',
    ]) {
      expect(normalizePhone(input)).toBe(expected);
    }
  });

  it('keeps other international numbers intact', () => {
    expect(normalizePhone('+7 495 123 45 67')).toBe('+74951234567');
  });

  it('rejects values that are not phone numbers', () => {
    for (const bad of ['', 'abc', '123', '+', '9'.repeat(20), "1' OR '1'='1"]) {
      expect(normalizePhone(bad)).toBeNull();
    }
  });
});
