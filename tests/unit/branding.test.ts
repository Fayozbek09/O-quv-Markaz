import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DICTIONARIES } from '@/lib/i18n';
import { LOCALES } from '@/lib/i18n/config';

/**
 * The product is O'QUV MARKAZ. It was Ustozly, and a rename is the kind of
 * change that looks finished long before it is: a title gets updated while a
 * favicon, an export filename, a Telegram reply and a legal page keep the old
 * name for months.
 *
 * This walks the repository rather than a list of files, so a new file carrying
 * the old branding fails the moment it is added.
 */
const ROOT = process.cwd();
const OLD_BRANDING = /ustozly|ustoziy/i;

const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', 'generated', 'test-results',
  'playwright-report', 'storage', 'dist', 'coverage',
]);

const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|md|json|prisma|sql|html)$/;

/**
 * Local development infrastructure, not branding.
 *
 * These name the Postgres container and the three databases that actually
 * exist on a developer's machine (`ustozly-pg`, `ustozly`, `ustozly_test`,
 * `ustozly_e2e`). Renaming them would mean recreating the container and
 * re-running every migration for no user-visible gain, and two of them are
 * load-bearing safety checks: `tests/setup.ts` refuses to run unless it is
 * pointed at the test database, and a header test asserts the development
 * password never reaches the client bundle.
 */
const ALLOWED = [
  /ustozly-pg/,
  /ustozly_dev_pw/,
  /ustozly_test/,
  /ustozly_e2e/,
  /POSTGRES_(USER|DB)=ustozly/,
  /localhost:5433\/ustozly/,
  /DATABASE ustozly/,
];

/**
 * The changelog is a historical record and is allowed to name the old product.
 * This file is skipped for the obvious reason that it has to spell out what it
 * is looking for.
 */
const SKIP_FILES = new Set([
  'CHANGELOG.md',
  'package-lock.json',
  'tsconfig.tsbuildinfo',
  // Both of these assert the old name is gone, so both have to spell it out.
  'branding.test.ts',
  'branding-footer.spec.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXT.test(entry) && !SKIP_FILES.has(entry)) out.push(full);
  }
  return out;
}

describe('branding', () => {
  const files = walk(ROOT);

  it('scans a real tree, so a broken path cannot pass this vacuously', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith('src/components/ui/Logo.tsx'))).toBe(true);
  });

  it('carries no trace of the old product name', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!OLD_BRANDING.test(line)) return;
        if (ALLOWED.some((rule) => rule.test(line))) return;
        offenders.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim().slice(0, 100)}`);
      });
    }

    expect(offenders, `old branding still present:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('names the product identically in all three dictionaries', () => {
    for (const locale of LOCALES) {
      expect(DICTIONARIES[locale].app.name, locale).toBe("O'quv Markaz");
    }
  });

  it('gives the favicon the same artwork as the logo component', () => {
    const layout = readFileSync(join(ROOT, 'src/app/layout.tsx'), 'utf8');
    const logo = readFileSync(join(ROOT, 'src/components/ui/Logo.tsx'), 'utf8');

    // The two pages of the open book, as a path. If the mark is redrawn and
    // the tab icon is not, this catches it.
    const spine = 'M16 11.6v12.6';
    expect(layout).toContain(spine);
    expect(logo).toContain(spine);
  });
});
