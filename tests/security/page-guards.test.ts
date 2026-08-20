import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSIONS, type Permission } from '@/lib/rbac';
import { NAV } from '@/lib/nav';

/**
 * Every staff page must name the permission it needs.
 *
 * This is a source-level check rather than a behavioural one on purpose. The
 * bugs it exists to prevent were all the same shape: a page that simply called
 * `requireOrg()` and rendered, while the sidebar hid its link — so nothing
 * looked wrong until somebody typed the URL. `/payments` and `/reports` served
 * the whole centre's money to a teacher that way, and `/center` and `/finance`
 * served payroll to the receptionist.
 *
 * Writing a browser test per page would be slower and would still only cover
 * the roles someone thought to try. Asserting that the gate exists at all
 * covers every page and every role at once, and fails the moment a new page is
 * added without one.
 */
const APP_DIR = join(process.cwd(), 'src/app/(app)');

/**
 * Pages that legitimately have no permission of their own.
 * Each needs a reason, and the reason has to survive a reading of the file.
 */
const UNGATED: Record<string, string> = {
  'dashboard/page.tsx': 'redirects to the role landing page; renders nothing',
  'teacher/page.tsx': "the teacher's own landing page, scoped to their memberId",
  'settings/page.tsx': 'redirects into the settings sections',
  'settings/profile/page.tsx': "the caller's own profile",
  'settings/security/page.tsx': "the caller's own sessions and password",
  'settings/notifications/page.tsx': "the caller's own preferences",
  'settings/workspace/page.tsx': 'read-only for anyone without center.settings; editing is gated in the form and again in the API',
};

function pageFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...pageFiles(full, prefix ? `${prefix}/${entry}` : entry));
    } else if (entry === 'page.tsx') {
      out.push(prefix ? `${prefix}/${entry}` : entry);
    }
  }
  return out;
}

const pages = pageFiles(APP_DIR);
const gateOf = (file: string): string | null => {
  const source = readFileSync(join(APP_DIR, file), 'utf8');
  return /requirePagePermission\(ctx,\s*'([a-z.]+)'\)/.exec(source)?.[1] ?? null;
};

describe('staff pages declare the permission they need', () => {
  it('finds the pages at all, so a broken path cannot pass this vacuously', () => {
    expect(pages.length).toBeGreaterThan(20);
    expect(pages).toContain('payments/page.tsx');
    expect(pages).toContain('finance/page.tsx');
  });

  it.each(pages)('%s', (file) => {
    const gate = gateOf(file);
    if (gate === null) {
      expect(
        UNGATED[file],
        `${file} has no permission check and no recorded reason for going without one`,
      ).toBeTruthy();
      return;
    }
    expect(PERMISSIONS as readonly string[], `${file} names an unknown permission`).toContain(gate);
  });

  it('gates the money pages on something a teacher does not hold', () => {
    for (const file of ['payments/page.tsx', 'reports/page.tsx', 'finance/page.tsx', 'center/page.tsx']) {
      expect(gateOf(file), file).not.toBeNull();
    }
  });

  /**
   * The sidebar filters links by permission. If a page asked for more than its
   * link does, the link would be shown to someone the page then refuses.
   */
  it('never asks for more than the sidebar link that leads to it', () => {
    const mismatches: string[] = [];
    for (const item of NAV) {
      const file = `${item.href.replace(/^\//, '')}/page.tsx`;
      if (!pages.includes(file)) continue;
      const gate = gateOf(file) as Permission | null;
      if (gate && item.permission && gate !== item.permission) {
        mismatches.push(`${item.href}: link needs ${item.permission}, page needs ${gate}`);
      }
      if (gate && !item.permission) {
        mismatches.push(`${item.href}: link needs nothing, page needs ${gate}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
