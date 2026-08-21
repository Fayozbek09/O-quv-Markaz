import Link from 'next/link';
import type { Metadata } from 'next';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { getPricing } from '@/lib/domain/settings';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: `${t('app.name')} — ${t('app.tagline')}`, description: t('landing.heroSubtitle') };
}

const FeatureIcon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="size-5 text-brand-600" fill="none" aria-hidden="true">
    <path d={d} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default async function LandingPage() {
  const t = await getTranslator();
  const locale = await getLocale();
  const money = (v: bigint) => formatMoney(v, 'UZS', INTL_LOCALE[locale]);
  // The advertised price is the live platform setting, so the landing page and
  // the billing screen can never drift apart.
  const pricing = await getPricing();
  const price = formatMoney(pricing.monthlyPriceMinor, pricing.currency, INTL_LOCALE[locale]);

  const features = [
    { key: 'f1', d: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 19c0-3 2.7-5 6-5s6 2 6 5M17 14.5c2.3.5 4 1.8 4 4.5' },
    { key: 'f2', d: 'M4 6.5h16v14H4zM4 11h16M8 3.5v3M16 3.5v3M9 15.5l2 2 4-4' },
    { key: 'f3', d: 'M3 8h18v9H3zM3 11.5h18M6.5 14.5h3.5' },
    { key: 'f4', d: 'M21 4 3 11l6 2.5L11.5 20 21 4ZM9 13.5 21 4' },
    { key: 'f5', d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3.5 9h17M3.5 15h17M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18' },
    { key: 'f6', d: 'M12 3 4 6.5v5c0 4.5 3.3 8.5 8 9.5 4.7-1 8-5 8-9.5v-5L12 3ZM9 12l2 2 4-4' },
  ] as const;

  const steps = ['s1', 's2', 's3'] as const;
  const faqs = [
    ['landing.q1', 'landing.a1'],
    ['landing.q2', 'landing.a2'],
    ['landing.q3', 'landing.a3'],
  ] as const;

  return (
    <>
      {/* hero */}
      <section className="border-b border-line bg-gradient-to-b from-brand-50/50 to-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-2xl">
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-[12px] font-medium text-brand-700">
              {t('app.tagline')}
            </p>
            <h1 className="text-[32px] font-semibold leading-[1.15] tracking-tight text-ink sm:text-[44px]">
              {t('landing.heroTitle')}
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-soft sm:text-base">
              {t('landing.heroSubtitle')}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/register"
                className="rounded-[var(--radius-field)] bg-brand-500 px-6 py-3 text-[15px] font-medium text-white shadow-sm hover:bg-brand-600"
              >
                {t('landing.ctaPrimary')}
              </Link>
              <Link
                href="/login"
                className="rounded-[var(--radius-field)] border border-line-strong bg-surface px-6 py-3 text-[15px] font-medium text-ink hover:bg-surface-muted"
              >
                {t('landing.ctaSecondary')}
              </Link>
            </div>
            <p className="mt-3 text-[13px] text-ink-faint">{t('landing.freeNote')}</p>
          </div>

          {/* Product sketch, not a screenshot: honest about what the app shows. */}
          <div className="mt-12 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-pop)]">
            <div className="flex items-center gap-1.5 border-b border-line bg-surface-muted px-3 py-2">
              <span className="size-2.5 rounded-full bg-line-strong" />
              <span className="size-2.5 rounded-full bg-line-strong" />
              <span className="size-2.5 rounded-full bg-line-strong" />
              <span className="ml-2 text-[11px] text-ink-faint">oquvmarkaz.uz/center</span>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-3">
              {[
                { label: t('debt.totalExpected'), value: money(4_800_000n), tone: 'text-ink' },
                { label: t('debt.totalPaid'), value: money(4_100_000n), tone: 'text-ok-600' },
                { label: t('debt.totalDebt'), value: money(700_000n), tone: 'text-warn-600' },
              ].map((tile) => (
                <div key={tile.label} className="rounded-[var(--radius-field)] border border-line px-3.5 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                    {tile.label}
                  </p>
                  <p className={`tnum mt-1 text-lg font-semibold ${tile.tone}`}>{tile.value}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-line px-4 py-3">
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                {t('dashboard.todayLessons')}
              </p>
              <ul className="space-y-1.5">
                {[
                  ['18:00', 'IELTS Evening A', 12],
                  ['19:30', 'General English B1', 9],
                ].map(([time, group, count]) => (
                  <li key={String(group)} className="flex items-center gap-3 text-sm">
                    <span className="tnum w-12 text-ink-faint">{time}</span>
                    <span className="size-2 rounded-full bg-brand-500" />
                    <span className="flex-1 truncate text-ink">{group}</span>
                    <span className="tnum text-ink-soft">{String(count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* features */}
      <section id="features" className="border-b border-line">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">{t('landing.featuresTitle')}</h2>
          <div className="mt-8 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.key}>
                <div className="mb-2.5 flex size-9 items-center justify-center rounded-[var(--radius-field)] bg-brand-50">
                  <FeatureIcon d={f.d} />
                </div>
                <h3 className="text-[15px] font-semibold">{t(`landing.${f.key}Title` as 'landing.f1Title')}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                  {t(`landing.${f.key}Text` as 'landing.f1Text')}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* how it works */}
      <section className="border-b border-line bg-canvas">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">{t('landing.howTitle')}</h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s} className="card p-5">
                <span className="tnum flex size-7 items-center justify-center rounded-full bg-brand-500 text-[13px] font-semibold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-3 text-[15px] font-semibold">{t(`landing.${s}` as 'landing.s1')}</h3>
                <p className="mt-1 text-[13px] text-ink-soft">
                  {t(`landing.${s}Text` as 'landing.s1Text')}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* pricing — one flat price, no per-student component */}
      <section id="pricing" className="border-b border-line">
        <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">{t('landing.pricingTitle')}</h2>

          <div className="card mt-8 border-brand-500 p-6 ring-1 ring-brand-500 sm:p-8">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-faint">
                {t('landing.planName')}
              </p>
              <span className="rounded-full border border-ok-50 bg-ok-50 px-2.5 py-0.5 text-[12px] font-semibold text-ok-600">
                {t('landing.trialBadge')}
              </span>
            </div>

            <p className="tnum mt-3 text-3xl font-semibold">
              {price}
              <span className="text-base font-normal text-ink-faint">{t('billing.perMonth')}</span>
            </p>
            <p className="mt-1 text-[13px] font-medium text-ink">{t('billing.forWholeCenter')}</p>

            <ul className="mt-5 flex flex-col gap-2 text-[14px] text-ink-soft">
              <li>{t('landing.trialLine')}</li>
              <li>{t('landing.priceLine', { price })}</li>
              <li>{t('landing.planDesc')}</li>
              <li>{t('landing.noPerStudent')}</li>
            </ul>

            <Link
              href="/register"
              className="btn btn-primary mt-6 h-11 w-full justify-center px-5 text-[15px] sm:w-auto"
            >
              {t('landing.ctaPrimary')}
            </Link>
            <p className="mt-2 text-[12px] text-ink-faint">{t('landing.freeNote')}</p>
          </div>
        </div>
      </section>

      {/* faq */}
      <section id="faq">
        <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">{t('landing.faqTitle')}</h2>
          <dl className="mt-6 divide-y divide-line border-y border-line">
            {faqs.map(([q, a]) => (
              <div key={q} className="py-4">
                <dt className="text-[15px] font-medium text-ink">{t(q)}</dt>
                <dd className="mt-1 text-[13px] leading-relaxed text-ink-soft">{t(a)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-10 text-center">
            <Link
              href="/register"
              className="inline-block rounded-[var(--radius-field)] bg-brand-500 px-6 py-3 text-[15px] font-medium text-white hover:bg-brand-600"
            >
              {t('landing.ctaPrimary')}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
