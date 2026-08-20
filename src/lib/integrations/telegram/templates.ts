import { createTranslator } from '../../i18n';
import { formatMoney } from '../../money';
import { INTL_LOCALE, type AppLocale } from '../../i18n/config';

/**
 * Message bodies are built here, in all three languages, from structured data.
 * Nothing a teacher types is used as a template - only as an interpolated
 * value - so a message cannot be turned into something else.
 */
export type DebtReminderInput = {
  locale: AppLocale;
  studentName: string;
  centerName: string;
  debtMinor: bigint;
  currency: string;
  teacherName: string;
  periodLabel: string;
};

const HEADLINE: Record<AppLocale, (s: DebtReminderInput) => string> = {
  uz: (s) => `Assalomu alaykum! ${s.studentName} bo'yicha to'lov eslatmasi.`,
  ru: (s) => `Здравствуйте! Напоминание об оплате за ${s.studentName}.`,
  en: (s) => `Hello! A payment reminder for ${s.studentName}.`,
};

const BODY: Record<AppLocale, (s: DebtReminderInput, amount: string) => string> = {
  uz: (s, amount) =>
    `Davr: ${s.periodLabel}\nQarzdorlik: ${amount}\n\nSavollar bo'lsa, ${s.teacherName} bilan bog'laning.\n${s.centerName}`,
  ru: (s, amount) =>
    `Период: ${s.periodLabel}\nЗадолженность: ${amount}\n\nПо вопросам обращайтесь к ${s.teacherName}.\n${s.centerName}`,
  en: (s, amount) =>
    `Period: ${s.periodLabel}\nOutstanding: ${amount}\n\nFor questions, contact ${s.teacherName}.\n${s.centerName}`,
};

export function renderDebtReminder(input: DebtReminderInput): string {
  const amount = formatMoney(input.debtMinor, input.currency, INTL_LOCALE[input.locale]);
  const head = HEADLINE[input.locale](input);
  const body = BODY[input.locale](input, amount);
  return `${head}\n\n${body}`;
}

export type LessonReminderInput = {
  locale: AppLocale;
  studentName: string;
  centerName: string;
  groupName: string;
  when: string;
  room: string | null;
};

export function renderLessonReminder(i: LessonReminderInput): string {
  const room = i.room ? `\n${i.locale === 'ru' ? 'Кабинет' : i.locale === 'en' ? 'Room' : 'Xona'}: ${i.room}` : '';
  if (i.locale === 'ru') {
    return `Напоминание об уроке\n\nУченик: ${i.studentName}\nГруппа: ${i.groupName}\nКогда: ${i.when}${room}\n\n${i.centerName}`;
  }
  if (i.locale === 'en') {
    return `Lesson reminder\n\nStudent: ${i.studentName}\nGroup: ${i.groupName}\nWhen: ${i.when}${room}\n\n${i.centerName}`;
  }
  return `Dars eslatmasi\n\nO'quvchi: ${i.studentName}\nGuruh: ${i.groupName}\nQachon: ${i.when}${room}\n\n${i.centerName}`;
}

export type DailySummaryInput = {
  locale: AppLocale;
  centerName: string;
  lessons: Array<{ time: string; group: string; students: number }>;
  expectedTodayMinor: bigint;
  currency: string;
};

export function renderDailySummary(i: DailySummaryInput): string {
  const t = createTranslator(i.locale);
  const lines =
    i.lessons.length === 0
      ? `- ${t('dashboard.noLessonsToday')}`
      : i.lessons.map((l) => `- ${l.time} ${l.group} (${l.students})`).join('\n');
  return [
    `${t('app.name')} - ${t('telegram.templateSummary')}`,
    '',
    `${t('dashboard.todayLessons')}:`,
    lines,
    '',
    `${t('dashboard.todayExpected')}: ${formatMoney(i.expectedTodayMinor, i.currency, INTL_LOCALE[i.locale])}`,
    '',
    i.centerName,
  ].join('\n');
}
