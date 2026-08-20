/**
 * Minimal RFC 4180 parser. Written here rather than pulled in as a dependency
 * because the import format is fixed and small - and because a parser that
 * runs on untrusted input is worth being able to read end to end.
 */
export function parseCsv(input: string, maxRows = 2000): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',' || char === ';') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length >= maxRows) return rows;
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export const CSV_COLUMNS = [
  'first_name',
  'last_name',
  'phone',
  'parent_name',
  'parent_phone',
  'notes',
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

export const CSV_TEMPLATE = `first_name,last_name,phone,parent_name,parent_phone,notes
Ali,Valiyev,+998901234567,Valijon Valiyev,+998901112233,
Nodira,Karimova,+998939876543,Dilnoza Karimova,+998935556677,IELTS 6.5 target
`;

/** Maps a header row to column indices, tolerating order and extra columns. */
export function mapHeader(header: string[]): Partial<Record<CsvColumn, number>> {
  const map: Partial<Record<CsvColumn, number>> = {};
  header.forEach((raw, index) => {
    const key = raw.trim().toLowerCase().replace(/\s+/g, '_');
    if ((CSV_COLUMNS as readonly string[]).includes(key)) map[key as CsvColumn] = index;
  });
  return map;
}
