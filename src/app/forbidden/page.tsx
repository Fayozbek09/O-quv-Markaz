import Link from 'next/link';
import { getTranslator } from '@/lib/i18n/server';
import { Logo } from '@/components/ui/Logo';

export default async function ForbiddenPage() {
  const t = await getTranslator();
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <Logo size={34} />
      <p className="text-[64px] font-semibold leading-none text-line-strong">403</p>
      <h1 className="text-lg font-semibold">{t('pages.forbiddenTitle')}</h1>
      <p className="max-w-sm text-sm text-ink-soft">{t('pages.forbiddenText')}</p>
      <Link
        href="/dashboard"
        className="mt-2 rounded-[var(--radius-field)] bg-brand-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
      >
        {t('pages.goHome')}
      </Link>
    </main>
  );
}
