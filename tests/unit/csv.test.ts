import { describe, it, expect } from 'vitest';
import { parseCsv, mapHeader } from '@/lib/domain/csv';
import { toCsv } from '@/lib/domain/reports';

describe('CSV parsing', () => {
  it('handles quotes, embedded commas and escaped quotes', () => {
    const rows = parseCsv('a,b\n"x,1","he said ""hi"""\n');
    expect(rows[1]).toEqual(['x,1', 'he said "hi"']);
  });

  it('accepts semicolon separators and CRLF line endings', () => {
    const rows = parseCsv('first_name;last_name\r\nAli;Valiyev\r\n');
    expect(rows[1]).toEqual(['Ali', 'Valiyev']);
  });

  it('maps headers regardless of order or case', () => {
    const map = mapHeader(['Parent_Phone', 'FIRST_NAME', 'extra']);
    expect(map.first_name).toBe(1);
    expect(map.parent_phone).toBe(0);
  });

  it('caps the number of rows it will parse', () => {
    const rows = parseCsv('a\n'.repeat(5000), 100);
    expect(rows.length).toBeLessThanOrEqual(100);
  });
});

describe('CSV export', () => {
  it('neutralizes formula injection', () => {
    const csv = toCsv([{ name: '=cmd|/c calc' }, { name: '+1+1' }, { name: '@SUM(A1)' }], ['name']);
    expect(csv).toContain('"\'=cmd|/c calc"');
    expect(csv).toContain('"\'+1+1"');
    expect(csv).toContain('"\'@SUM(A1)"');
  });

  it('escapes embedded quotes so a cell cannot break out', () => {
    const csv = toCsv([{ name: 'a"b' }], ['name']);
    expect(csv).toContain('"a""b"');
  });
});
