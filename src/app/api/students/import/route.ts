import { z } from 'zod';
import { prisma } from '@/lib/db';
import { json, orgMutation, readJson } from '@/lib/api';
import { CSV_COLUMNS, mapHeader, parseCsv, type CsvColumn } from '@/lib/domain/csv';
import { normalizePhone } from '@/lib/validation/common';
import { assertCanAddStudent, planUsage } from '@/lib/domain/plan';
import { audit } from '@/lib/security/audit';
import { BadRequest, PlanLimit } from '@/lib/errors';

const MAX_ROWS = 500;
const MAX_CSV_BYTES = 512 * 1024;

const schema = z
  .object({ csv: z.string().max(MAX_CSV_BYTES), commit: z.boolean().default(false) })
  .strict();

const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]', 'g');
const clean = (v: string | undefined, max: number) => (v ?? '').replace(CONTROL, '').trim().slice(0, max);

type Parsed = {
  line: number;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  parentName: string | null;
  parentPhone: string | null;
  notes: string | null;
  errors: string[];
  duplicate: boolean;
};

/**
 * Two-phase import: the first call previews and reports errors and likely
 * duplicates, the second commits. The same validation runs in both phases, so
 * a client cannot skip the preview to smuggle bad rows in.
 */
export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, schema);

  const rows = parseCsv(body.csv, MAX_ROWS + 1);
  if (rows.length < 2) throw BadRequest('errors.badRequest');
  if (rows.length > MAX_ROWS + 1) throw BadRequest('errors.payloadTooLarge');

  const header = mapHeader(rows[0] ?? []);
  if (header.first_name === undefined) throw BadRequest('errors.badRequest');

  const at = (row: string[], col: CsvColumn) => {
    const index = header[col];
    return index === undefined ? undefined : row[index];
  };

  // One query for the whole existing roster, then match in memory.
  const existing = await prisma.student.findMany({
    where: { organizationId: ctx.orgId, deletedAt: null },
    select: { firstName: true, lastName: true, phone: true },
  });
  const existingPhones = new Set(existing.map((s) => s.phone).filter(Boolean) as string[]);
  const existingNames = new Set(
    existing.map((s) => `${s.firstName}|${s.lastName ?? ''}`.toLowerCase()),
  );

  const seenPhones = new Set<string>();
  const parsed: Parsed[] = rows.slice(1).map((row, index) => {
    const firstName = clean(at(row, 'first_name'), 80);
    const lastName = clean(at(row, 'last_name'), 80) || null;
    const rawPhone = clean(at(row, 'phone'), 24);
    const rawParentPhone = clean(at(row, 'parent_phone'), 24);

    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    const parentPhone = rawParentPhone ? normalizePhone(rawParentPhone) : null;

    const errors: string[] = [];
    if (!firstName) errors.push('errors.required');
    if (rawPhone && !phone) errors.push('errors.invalidPhone');
    if (rawParentPhone && !parentPhone) errors.push('errors.invalidPhone');

    const duplicate =
      (phone !== null && (existingPhones.has(phone) || seenPhones.has(phone))) ||
      existingNames.has(`${firstName}|${lastName ?? ''}`.toLowerCase());
    if (phone) seenPhones.add(phone);

    return {
      line: index + 2,
      firstName,
      lastName,
      phone,
      parentName: clean(at(row, 'parent_name'), 160) || null,
      parentPhone,
      notes: clean(at(row, 'notes'), 2000) || null,
      errors,
      duplicate,
    };
  });

  const importable = parsed.filter((r) => r.errors.length === 0 && !r.duplicate);

  if (!body.commit) {
    return json({
      columns: CSV_COLUMNS,
      total: parsed.length,
      valid: importable.length,
      invalid: parsed.filter((r) => r.errors.length > 0).length,
      duplicates: parsed.filter((r) => r.duplicate && r.errors.length === 0).length,
      rows: parsed.slice(0, 50),
    });
  }

  // The plan ceiling is checked against the whole batch, not row by row.
  const usage = await planUsage(ctx.orgId);
  if (usage.limit !== null && usage.activeStudents + importable.length > usage.limit) {
    throw PlanLimit('students.limitReached', { limit: usage.limit });
  }
  await assertCanAddStudent(ctx);

  let created = 0;
  await prisma.$transaction(async (tx) => {
    for (const row of importable) {
      const student = await tx.student.create({
        data: {
          organizationId: ctx.orgId,
          firstName: row.firstName,
          lastName: row.lastName,
          phone: row.phone,
          notes: row.notes,
          status: 'ACTIVE',
        },
      });
      if (row.parentName || row.parentPhone) {
        await tx.studentParent.create({
          data: {
            organizationId: ctx.orgId,
            studentId: student.id,
            fullName: row.parentName ?? '-',
            phone: row.parentPhone,
            isPrimary: true,
          },
        });
      }
      created += 1;
    }
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.user.userId,
    action: 'student.import',
    meta: { created, skipped: parsed.length - created },
  });

  return json({ created, skipped: parsed.length - created }, { status: 201 });
});
