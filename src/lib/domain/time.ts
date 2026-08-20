/**
 * Timezone helpers. Lessons are entered as a local wall-clock time in the
 * workspace timezone and stored in UTC, so a schedule stays correct across DST
 * changes and across users in different regions.
 */
export function zonedTimeToUtc(dateIso: string, hhmm: string, timeZone: string): Date {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  // First guess: treat the wall time as UTC, then correct by the zone offset.
  const guess = new Date(`${dateIso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const offset = zoneOffsetMs(guess, timeZone);
  const corrected = new Date(guess.getTime() - offset);
  // A second pass settles the rare case where the correction crosses a DST edge.
  const offset2 = zoneOffsetMs(corrected, timeZone);
  return offset2 === offset ? corrected : new Date(guess.getTime() - offset2);
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/** ISO weekday (1 = Monday .. 7 = Sunday) of an instant in a timezone. */
export function zonedWeekday(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
  const index = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(name);
  return index === -1 ? 1 : index + 1;
}

/** "2026-08-20" for an instant, in a timezone. */
export function zonedDateIso(instant: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return dtf.format(instant);
}

export function zonedTimeHHMM(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(instant);
}

/** [start, end) of a local day, as UTC instants. */
export function dayBounds(dateIso: string, timeZone: string): [Date, Date] {
  const start = zonedTimeToUtc(dateIso, '00:00', timeZone);
  const next = new Date(Date.parse(`${dateIso}T00:00:00Z`) + 86_400_000);
  const nextIso = next.toISOString().slice(0, 10);
  return [start, zonedTimeToUtc(nextIso, '00:00', timeZone)];
}

/** [start, end) of a calendar month, as UTC instants. */
export function monthBounds(year: number, month: number, timeZone: string): [Date, Date] {
  const startIso = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endIso = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return [zonedTimeToUtc(startIso, '00:00', timeZone), zonedTimeToUtc(endIso, '00:00', timeZone)];
}

export function eachDateIso(fromIso: string, untilIso: string): string[] {
  const out: string[] = [];
  let cursor = Date.parse(`${fromIso}T00:00:00Z`);
  const end = Date.parse(`${untilIso}T00:00:00Z`);
  // Hard cap so a wide range cannot be used to generate unbounded work.
  for (let i = 0; cursor <= end && i < 400; i += 1) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return out;
}
