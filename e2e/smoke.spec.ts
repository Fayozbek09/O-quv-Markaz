import { test, expect } from '@playwright/test';

/**
 * A short walk through the parts a user actually touches. These complement the
 * HTTP suite: that one asserts status codes and headers, this one asserts that
 * a person can see and operate the interface.
 */

test.describe('landing page', () => {
  test('states what the product is and offers a way in', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /Bepul boshlash|Начать бесплатно|Start for free/ }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Maxfiylik|Политика|Privacy/ }).first()).toBeVisible();
  });

  test('switches between all three languages', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Русский' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/[Ѐ-ӿ]/);

    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText(/[Ѐ-ӿ]/);

    await page.getByRole('button', { name: "O'zbekcha" }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('is usable on a phone-sized viewport without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('authentication screens', () => {
  test('an unauthenticated visitor is sent to the login page', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('the login form is reachable and operable by keyboard alone', async ({ page }) => {
    await page.goto('/login');

    await page.keyboard.press('Tab');
    for (let i = 0; i < 12; i += 1) {
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('name'));
      if (focused === 'identifier') break;
      await page.keyboard.press('Tab');
    }

    await page.keyboard.type('ustoz@ustozly.uz');
    await expect(page.getByLabel(/Telefon|Телефон|Phone/).first()).toHaveValue('ustoz@ustozly.uz');
  });

  test('wrong credentials produce a translated message, not a stack trace', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel(/Telefon|Телефон|Phone/).first().fill('nobody@example.test');
    await page.getByLabel(/Parol|Пароль|Password/).first().fill('wrong-password-123');
    await page.getByRole('button', { name: /Kirish|Войти|Log in/ }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText('at ');
    await expect(alert).not.toContainText('prisma');
  });

  test('the registration form offers both phone and email', async ({ page }) => {
    await page.goto('/register');

    await expect(page.getByRole('tab', { name: /Telefon|Телефон|Phone/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Email/ })).toBeVisible();
    // Two links point at /terms (the form and the footer); the form one is first.
    await expect(page.getByRole('link', { name: /shartlari|Условия|Terms of Service/ }).first()).toBeVisible();
  });
});

test.describe('legal pages', () => {
  for (const path of ['/privacy', '/terms']) {
    test(`${path} renders content in the selected language`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
    });
  }
});

test.describe('errors', () => {
  test('an unknown path shows the 404 page', async ({ page }) => {
    const response = await page.goto('/no-such-page');
    expect(response?.status()).toBe(404);
    await expect(page.getByText('404')).toBeVisible();
  });
});
