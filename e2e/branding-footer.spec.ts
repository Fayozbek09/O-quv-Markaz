import { test, expect } from '@playwright/test';

/**
 * Branding and the public footer, in a real browser.
 *
 * The contact details used to sit in a single row of small print between a
 * copyright notice and two legal links, where they read as decoration. They now
 * have a column of their own, and these tests hold that shape: the heading
 * exists, the phone and the e-mail are real links, and none of it collapses or
 * overflows on a phone.
 */
const WIDTHS = [
  { name: 'desktop 1920', width: 1920, height: 1080 },
  { name: 'desktop 1440', width: 1440, height: 900 },
  { name: 'laptop 1024', width: 1024, height: 768 },
  { name: 'tablet 768', width: 768, height: 1024 },
  { name: 'phone 390', width: 390, height: 844 },
  { name: 'phone 360', width: 360, height: 740 },
];

test.describe('branding', () => {
  test('the product is named O\'quv Markaz, and never the old name', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/O.?quv Markaz/i);
    await expect(page.getByRole('link', { name: /O.?quv Markaz/i }).first()).toBeVisible();

    const html = await page.content();
    expect(html).not.toMatch(/ustozly|ustoziy/i);
  });

  test('the tab icon is served and is an SVG', async ({ page }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="icon"]').first().getAttribute('href');
    expect(href).toContain('image/svg+xml');
    // The open book's spine — the mark, not a leftover monogram.
    expect(decodeURIComponent(href ?? '')).toContain('M16 11.6v12.6');
  });
});

test.describe('footer', () => {
  test('gives contact details a section of their own, with working links', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');

    await expect(footer.getByRole('heading', { name: /Bog.?lanish|Контакты|Contact/i })).toBeVisible();
    await expect(footer.getByRole('heading', { name: /Platforma|Платформа|Platform/i })).toBeVisible();
    await expect(footer.getByRole('heading', { name: /Yordam|Помощь|Help/i })).toBeVisible();

    const tel = footer.locator('a[href^="tel:"]').first();
    await expect(tel).toBeVisible();
    expect(await tel.getAttribute('href')).toMatch(/^tel:\+998\d+$/);

    const mail = footer.locator('a[href^="mailto:"]').first();
    await expect(mail).toBeVisible();
    expect(await mail.getAttribute('href')).toMatch(/^mailto:.+@.+$/);

    await expect(footer.getByText(/©\s*\d{4}/)).toBeVisible();
  });

  test('never links to a Telegram handle that is not configured', async ({ page }) => {
    await page.goto('/');
    const telegram = page.locator('footer a[href*="t.me"]');
    const configured = Boolean(process.env.NEXT_PUBLIC_CONTACT_TELEGRAM);
    await expect(telegram).toHaveCount(configured ? 1 : 0);
  });

  test('translates with the rest of the page', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');

    await page.getByRole('button', { name: 'Русский' }).click();
    await expect(footer.getByRole('heading', { name: 'Контакты' })).toBeVisible();

    await page.getByRole('button', { name: 'English' }).click();
    await expect(footer.getByRole('heading', { name: 'Contact' })).toBeVisible();
  });

  for (const { name, width, height } of WIDTHS) {
    test(`lays out without overflow at ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');

      const footer = page.locator('footer');
      await expect(footer).toBeVisible();
      await expect(footer.locator('a[href^="tel:"]').first()).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${name} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
    });
  }

  test('the contact links are reachable by keyboard', async ({ page }) => {
    await page.goto('/');
    const tel = page.locator('footer a[href^="tel:"]').first();
    await tel.focus();
    await expect(tel).toBeFocused();

    // A focused link must be visibly focused, not silently outlined away.
    const outline = await tel.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });
});
