import { test, expect, type Page } from '@playwright/test';

/**
 * Role separation, seen through a real browser.
 *
 * One login page, five destinations. Each block signs in as a different seeded
 * account and checks both what that role reaches and what it is refused —
 * refusal by URL, not by a hidden link.
 */
const PASSWORD = 'Demo-Markaz-2026!';

async function signIn(page: Page, username: string, expectPath: string) {
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(username);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /Kirish|Войти|Log in/ }).click();
  await page.waitForURL(`**${expectPath}`);
}

test.describe('the login page routes by role, server-side', () => {
  test('an owner lands on the centre dashboard', async ({ page }) => {
    await signIn(page, 'owner.karimova', '/center');
    await expect(page).toHaveURL(/\/center/);
  });

  test('a receptionist lands on the reception desk', async ({ page }) => {
    await signIn(page, 'reception.tosheva', '/reception');
    await expect(page).toHaveURL(/\/reception/);
  });

  test('a teacher lands on the teaching area', async ({ page }) => {
    await signIn(page, 'teacher.saidova', '/teacher');
    await expect(page).toHaveURL(/\/teacher/);
  });

  test('a student lands on the student portal', async ({ page }) => {
    await signIn(page, 'student.valiyev', '/student');
    await expect(page).toHaveURL(/\/student/);
  });
});

test.describe('receptionist', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'reception.tosheva', '/reception');
  });

  test('gets the fast desk tools', async ({ page }) => {
    await expect(page.getByRole('searchbox').first()).toBeVisible();
    for (const path of ['/students', '/groups', '/payments', '/calendar']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
    }
  });

  test('is refused the pages its role does not hold, by URL', async ({ page }) => {
    for (const path of ['/salaries', '/expenses', '/finance', '/billing']) {
      await page.goto(path);
      // A forbidden page renders the refusal, never the content.
      await expect(page.locator('body'), path).not.toContainText(/Maosh modeli|Salary model|Модель зарплаты/);
    }
  });

  test('sees no salary column on the staff list', async ({ page }) => {
    await page.goto('/teachers');
    await expect(page.locator('body')).not.toContainText(/6 500 000|6500000/);
  });
});

test.describe('teacher', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'teacher.saidova', '/teacher');
  });

  test('sees their own groups and lessons', async ({ page }) => {
    await expect(page.getByRole('heading').first()).toBeVisible();
    for (const path of ['/homework', '/grades', '/attendance', '/salaries']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
    }
  });

  test('sees only their own salary, described as such', async ({ page }) => {
    await page.goto('/salaries');
    await expect(
      page.getByText(/faqat o'z maoshingizni|только свою зарплату|only see your own salary/i),
    ).toBeVisible();
  });

  test('cannot reach the payments ledger', async ({ page }) => {
    await page.goto('/payments');
    await expect(page.locator('body')).not.toContainText(/To'lov qabul qilindi|Платёж принят/);
  });
});

test.describe('student portal', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'student.valiyev', '/student');
  });

  test('shows their own attendance, grades, homework and balance', async ({ page }) => {
    await expect(page.getByText(/Mening balansim|Мой баланс|My balance/).first()).toBeVisible();
    await expect(page.getByText(/Mening baholarim|Мои оценки|My grades/).first()).toBeVisible();
    await expect(page.getByText(/Uyga vazifalarim|Мои домашние|My homework/).first()).toBeVisible();
  });

  test('has no staff navigation at all', async ({ page }) => {
    await expect(page.getByRole('link', { name: /Maoshlar|Зарплаты|Salaries/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Xodimlar|Сотрудники|Staff/ })).toHaveCount(0);
  });

  test('is bounced out of the staff area', async ({ page }) => {
    await page.goto('/center');
    await expect(page).not.toHaveURL(/\/center$/);
  });
});

test.describe('platform administration', () => {
  test('a centre user typing /admin is sent to the admin login', async ({ page }) => {
    await signIn(page, 'owner.karimova', '/center');
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('the admin login is its own page, not the centre one', async ({ page }) => {
    await page.goto('/admin/login');
    await expect(page.locator('input[name="username"]')).toBeVisible();
    // No "register a centre" affordance here.
    await expect(page.getByRole('link', { name: /Ro'yxatdan|Регистрация|Register/ })).toHaveCount(0);
  });

  test('a centre password is refused at the admin login', async ({ page }) => {
    await page.goto('/admin/login');
    await page.locator('input[name="username"]').fill('owner.karimova');
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: /Kirish|Войти|Log in/ }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

test.describe('tenant isolation in the browser', () => {
  test('a second centre cannot open the first centre records', async ({ page }) => {
    await signIn(page, 'owner.karimova', '/center');
    await page.goto('/students');
    const href = await page.getByRole('link').filter({ hasText: /Ali|Nodira|Sardor/ }).first().getAttribute('href');
    expect(href).toBeTruthy();

    // Sign out, sign in as the unrelated centre, then request that exact URL.
    await page.goto('/login');
    await page.context().clearCookies();
    await signIn(page, 'owner.aliyev', '/center');

    const response = await page.goto(href!);
    expect(response?.status()).toBe(404);
  });
});

/**
 * Announcements, followed all the way through a real browser: an owner posts
 * one, and the student it is addressed to sees it on their own dashboard.
 */
test.describe('announcements', () => {
  test('an owner posts a notice and a student reads it', async ({ page, browser }) => {
    const title = `Imtihon jadvali ${Date.now()}`;

    await signIn(page, 'owner.karimova', '/center');
    await page.goto('/announcements');
    await page.getByRole('button', { name: /E'lon qo'shish|Создать объявление|Post an announcement/ }).click();

    await page.getByLabel(/Sarlavha|Заголовок|Title/).fill(title);
    await page.getByLabel(/Matn|Текст|Message/).fill('Imtihonlar keyingi hafta boshlanadi.');
    await page.getByLabel(/Kimga|Кому|Audience/).selectOption('STUDENTS');
    await page.getByRole('button', { name: /Yaratish|Создать|Create/ }).click();

    await expect(page.getByText(title).first()).toBeVisible();

    // Now as the student it was addressed to, in a session of their own.
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await signIn(studentPage, 'student.valiyev', '/student');
    // Twice over: once in the announcements card, once in the notification feed.
    await expect(studentPage.getByText(title).first()).toBeVisible();
    await expect(studentPage.getByText(title)).toHaveCount(2);
    await studentContext.close();
  });

  test('a teacher does not get the staff announcement tool', async ({ page }) => {
    await signIn(page, 'teacher.saidova', '/teacher');
    await page.goto('/announcements');
    await expect(page.locator('body')).not.toContainText(
      /E'lon qo'shish|Создать объявление|Post an announcement/,
    );
  });
});
