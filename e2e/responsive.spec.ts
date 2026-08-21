import { test, expect, type Page } from '@playwright/test';
import { clearLoginThrottle } from './support/limits';

/**
 * Every role's own area, at every width the product claims to support.
 *
 * A page that scrolls sideways on a phone is not a cosmetic problem in this
 * product: a teacher marks a register on a phone between lessons, and a parent
 * reads a debt on one. The check is deliberately blunt — the document must not
 * be wider than the viewport — because that is the failure people actually hit.
 */
const PASSWORD = 'Demo-Markaz-2026!';

const WIDTHS = [
  { name: 'desktop 1920', width: 1920, height: 1080 },
  { name: 'desktop 1280', width: 1280, height: 800 },
  { name: 'laptop 1024', width: 1024, height: 768 },
  { name: 'tablet 768', width: 768, height: 1024 },
  { name: 'phone 390', width: 390, height: 844 },
  { name: 'phone 360', width: 360, height: 740 },
];

async function signIn(page: Page, username: string, expectPath: string) {
  await clearLoginThrottle();
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(username);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /Kirish|Войти|Log in/ }).click();
  await page.waitForURL(`**${expectPath}`);
}

async function overflowOf(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

const JOURNEYS: Array<{ role: string; user: string; home: string; pages: string[] }> = [
  {
    role: 'owner',
    user: 'owner.karimova',
    home: '/center',
    pages: ['/center', '/students', '/groups', '/payments', '/finance', '/reports', '/salaries'],
  },
  {
    role: 'receptionist',
    user: 'reception.tosheva',
    home: '/reception',
    pages: ['/reception', '/students', '/groups', '/payments', '/calendar'],
  },
  {
    role: 'teacher',
    user: 'teacher.saidova',
    home: '/teacher',
    pages: ['/teacher', '/students', '/attendance', '/grades', '/homework', '/salaries'],
  },
  { role: 'student', user: 'student.valiyev', home: '/student', pages: ['/student'] },
];

for (const journey of JOURNEYS) {
  test.describe(`${journey.role} area`, () => {
    for (const { name, width, height } of WIDTHS) {
      test(`fits ${name}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await signIn(page, journey.user, journey.home);

        for (const path of journey.pages) {
          await page.goto(path);
          await expect(page.locator('#main')).toBeVisible();

          const overflow = await overflowOf(page);
          expect(overflow, `${path} at ${name} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
        }
      });
    }
  });
}

test.describe('the public pages', () => {
  for (const { name, width, height } of WIDTHS) {
    test(`fit ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      for (const path of ['/', '/login', '/register', '/privacy', '/terms']) {
        await page.goto(path);
        const overflow = await overflowOf(page);
        expect(overflow, `${path} at ${name} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
      }
    });
  }
});
