import { test, expect, type Page } from '@playwright/test';
import { clearLoginThrottle } from './support/limits';

/**
 * The browser console, on every screen each role reaches.
 *
 * A page can render correctly and still be broken: a failed request, a
 * hydration mismatch or a React key warning shows up here and nowhere else.
 * This asserts the console stays empty, so the next one is noticed the day it
 * appears rather than months later.
 */
const PASSWORD = 'Demo-Markaz-2026!';

/**
 * Noise from the development toolchain rather than from the application. Kept
 * deliberately short — anything not listed here fails the test.
 */
const IGNORED = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /favicon\.ico/i,
];

type Collected = { errors: string[]; failures: string[] };

function watch(page: Page): Collected {
  const collected: Collected = { errors: [], failures: [] };

  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    const text = message.text();
    if (IGNORED.some((rule) => rule.test(text))) return;
    collected.errors.push(`${message.type()}: ${text}`);
  });

  page.on('pageerror', (error) => {
    collected.errors.push(`uncaught: ${error.message}`);
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'failed';
    if (/ERR_ABORTED/.test(failure)) return; // navigation cancelled a prefetch
    collected.failures.push(`${request.method()} ${request.url()} — ${failure}`);
  });

  return collected;
}

async function signIn(page: Page, username: string, expectPath: string) {
  await clearLoginThrottle();
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(username);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /Kirish|Войти|Log in/ }).click();
  await page.waitForURL(`**${expectPath}`);
}

test('the public pages log nothing', async ({ page }) => {
  const seen = watch(page);
  for (const path of ['/', '/login', '/register', '/privacy', '/terms', '/forgot-password']) {
    await page.goto(path);
    await expect(page.locator('#main')).toBeVisible();
  }
  expect(seen.errors, seen.errors.join('\n')).toEqual([]);
  expect(seen.failures, seen.failures.join('\n')).toEqual([]);
});

const JOURNEYS: Array<[string, string, string, string[]]> = [
  ['owner', 'owner.karimova', '/center',
    ['/center', '/students', '/groups', '/courses', '/calendar', '/attendance', '/grades',
     '/homework', '/payments', '/finance', '/expenses', '/salaries', '/reports',
     '/announcements', '/billing', '/settings/profile', '/settings/security']],
  ['receptionist', 'reception.tosheva', '/reception',
    ['/reception', '/students', '/groups', '/payments', '/calendar', '/announcements']],
  ['teacher', 'teacher.saidova', '/teacher',
    ['/teacher', '/students', '/groups', '/attendance', '/grades', '/homework', '/salaries']],
  ['student', 'student.valiyev', '/student', ['/student']],
];

for (const [role, user, home, pages] of JOURNEYS) {
  test(`the ${role} area logs nothing`, async ({ page }) => {
    const seen = watch(page);
    await signIn(page, user, home);

    for (const path of pages) {
      await page.goto(path);
      await expect(page.locator('#main')).toBeVisible();
    }

    expect(seen.errors, `console output in the ${role} area:\n${seen.errors.join('\n')}`).toEqual([]);
    expect(seen.failures, `failed requests in the ${role} area:\n${seen.failures.join('\n')}`).toEqual([]);
  });
}
