import { describe, it, expect } from 'vitest';
import { zonedTimeToUtc, zonedWeekday, zonedDateIso, dayBounds, monthBounds, eachDateIso } from '@/lib/domain/time';

describe('timezone handling', () => {
  it('converts a Tashkent wall time to the right UTC instant', () => {
    // Tashkent is UTC+5 with no DST.
    expect(zonedTimeToUtc('2026-08-20', '18:00', 'Asia/Tashkent').toISOString())
      .toBe('2026-08-20T13:00:00.000Z');
  });

  it('is correct across a DST boundary in a zone that observes it', () => {
    // London is UTC+1 in August, UTC+0 in January.
    expect(zonedTimeToUtc('2026-08-20', '12:00', 'Europe/London').toISOString())
      .toBe('2026-08-20T11:00:00.000Z');
    expect(zonedTimeToUtc('2026-01-20', '12:00', 'Europe/London').toISOString())
      .toBe('2026-01-20T12:00:00.000Z');
  });

  it('returns ISO weekdays with Monday = 1', () => {
    // 2026-08-20 is a Thursday.
    expect(zonedWeekday(new Date('2026-08-20T10:00:00Z'), 'Asia/Tashkent')).toBe(4);
  });

  it('reports the local date, not the UTC one', () => {
    // 21:00 UTC is already the next day in Tashkent.
    expect(zonedDateIso(new Date('2026-08-20T21:00:00Z'), 'Asia/Tashkent')).toBe('2026-08-21');
  });

  it('produces half-open day and month bounds', () => {
    const [start, end] = dayBounds('2026-08-20', 'Asia/Tashkent');
    expect(start.toISOString()).toBe('2026-08-19T19:00:00.000Z');
    expect(end.toISOString()).toBe('2026-08-20T19:00:00.000Z');

    const [mStart, mEnd] = monthBounds(2026, 12, 'Asia/Tashkent');
    expect(mStart.toISOString()).toBe('2026-11-30T19:00:00.000Z');
    expect(mEnd.toISOString()).toBe('2026-12-31T19:00:00.000Z');
  });

  it('caps date enumeration so a wide range cannot generate unbounded work', () => {
    expect(eachDateIso('2020-01-01', '2030-01-01').length).toBeLessThanOrEqual(400);
  });
});
