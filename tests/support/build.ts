import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * `next start` needs a production build, and running `next dev` replaces `.next`
 * with a development one. Rather than failing with an opaque startup error, the
 * test harnesses call this to make sure a usable production build exists.
 *
 * A sentinel records the newest source timestamp at build time, so a rebuild
 * happens when the code changed and is skipped when it did not.
 */
const SENTINEL = path.join('.next', '.ustozly-prod-build');

function newestSourceMtime(dir = 'src'): number {
  let newest = 0;
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'generated') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  walk(dir);
  for (const file of ['next.config.ts', 'package.json', 'prisma/schema.prisma']) {
    if (existsSync(file)) newest = Math.max(newest, statSync(file).mtimeMs);
  }
  return newest;
}

/**
 * `next dev` writes into the same directory and leaves `static/development`
 * behind. Serving that mixture with `next start` fails at runtime with an
 * unhelpful error, so treat its presence as "this is not a production build".
 */
const touchedByDev = () => existsSync(path.join('.next', 'static', 'development'));

export function ensureProductionBuild(): void {
  const newest = newestSourceMtime();

  if (!touchedByDev() && existsSync(SENTINEL) && existsSync('.next/BUILD_ID')) {
    const recorded = Number(readFileSync(SENTINEL, 'utf8'));
    if (Number.isFinite(recorded) && recorded >= newest) return;
  }

  // Build from a clean directory: a half-dev, half-production .next is worse
  // than no build at all.
  rmSync('.next', { recursive: true, force: true });

  const result = spawnSync('npx', ['next', 'build'], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error('next build failed; the HTTP and end-to-end suites need a production build');
  }
  writeFileSync(SENTINEL, String(newest));
}
