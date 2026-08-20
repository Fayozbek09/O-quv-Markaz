'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor, fieldErrorsFor } from '@/lib/client/errors';
import { TextField, SelectField, TextAreaField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/forms/AuthCard';
import { Logo } from '@/components/ui/Logo';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import type { TKey } from '@/lib/i18n';

const TIMEZONES = ['Asia/Tashkent', 'Asia/Samarkand', 'Asia/Almaty', 'Europe/Moscow', 'UTC'];
const CURRENCIES = ['UZS', 'USD', 'RUB', 'EUR'] as const;
const CATALOG = [
  'english', 'ielts', 'russian', 'korean', 'turkish', 'arabic', 'chinese',
  'math', 'physics', 'chemistry', 'biology', 'history',
  'programming', 'robotics', 'design', 'sat', 'preschool', 'music', 'art',
] as const;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const TOTAL_STEPS = 3;

/**
 * Education-centre registration.
 *
 * The account already exists and is verified by the time this runs; this
 * wizard only creates the centre, makes the caller its owner and opens the
 * 30-day trial. Nothing here decides the role — the server does.
 */
export function OnboardingWizard({ initialFirstName }: { initialFirstName: string }) {
  const t = useT();
  const router = useRouter();
  const csrf = useCsrfToken();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [owner, setOwner] = useState({ firstName: initialFirstName, lastName: '' });
  const [centre, setCentre] = useState({
    centerName: '', legalName: '', phone: '', email: '', address: '',
    city: '', district: '', description: '',
    telegramHandle: '', instagram: '', website: '',
    timezone: 'Asia/Tashkent',
    currency: 'UZS' as (typeof CURRENCIES)[number],
  });
  const [courses, setCourses] = useState<string[]>([]);
  const [customCourse, setCustomCourse] = useState('');
  const [hours, setHours] = useState(
    WEEKDAYS.map((weekday) => ({
      weekday,
      open: '09:00',
      close: '20:00',
      closed: weekday === 7,
    })),
  );

  const setCentreField = (key: keyof typeof centre) => (e: { target: { value: string } }) =>
    setCentre((prev) => ({ ...prev, [key]: e.target.value }));

  function toggleCourse(name: string) {
    setCourses((prev) => (prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]));
  }

  function addCustomCourse() {
    const value = customCourse.trim();
    if (!value || courses.includes(value)) return;
    setCourses((prev) => [...prev, value]);
    setCustomCourse('');
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await apiFetch<{ redirectTo: string }>('/api/center/register', {
        method: 'POST',
        csrfToken: csrf,
        body: {
          firstName: owner.firstName,
          lastName: owner.lastName || undefined,
          centerName: centre.centerName,
          legalName: centre.legalName || undefined,
          phone: centre.phone,
          email: centre.email || undefined,
          address: centre.address || undefined,
          city: centre.city,
          district: centre.district || undefined,
          description: centre.description || undefined,
          telegramHandle: centre.telegramHandle || undefined,
          instagram: centre.instagram || undefined,
          website: centre.website || undefined,
          workingHours: hours,
          courses,
          timezone: centre.timezone,
          currency: centre.currency,
        },
      });
      router.push(result.redirectTo || '/center');
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
      setFieldErrors(fieldErrorsFor(t, err));
      setBusy(false);
    }
  }

  const canContinue =
    step === 1
      ? owner.firstName.trim().length > 0
      : step === 2
        ? centre.centerName.trim().length >= 2 &&
          centre.city.trim().length >= 2 &&
          centre.phone.trim().length >= 6
        : true;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Logo />
        <LanguageSwitcher compact />
      </div>

      <div className="mb-5">
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink-faint">
          {t('common.page')} {step}/{TOTAL_STEPS}
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{t('center.register')}</h1>
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-brand-500 transition-all"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      <div className="card p-5 sm:p-6">
        <div className="flex flex-col gap-4">
          <FormError message={error} />

          {step === 1 && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label={t('staff.firstName')}
                  value={owner.firstName}
                  onChange={(e) => setOwner({ ...owner, firstName: e.target.value })}
                  error={fieldErrors.firstName}
                  required
                  autoFocus
                />
                <TextField
                  label={t('staff.lastName')}
                  value={owner.lastName}
                  onChange={(e) => setOwner({ ...owner, lastName: e.target.value })}
                  error={fieldErrors.lastName}
                />
              </div>
              <p className="text-[13px] text-ink-soft">{t('billing.freeFirstMonth')}</p>
            </>
          )}

          {step === 2 && (
            <>
              <TextField
                label={t('center.name')}
                value={centre.centerName}
                onChange={setCentreField('centerName')}
                error={fieldErrors.centerName}
                required
                autoFocus
              />
              <TextField
                label={t('center.legalName')}
                value={centre.legalName}
                onChange={setCentreField('legalName')}
                hint={t('common.optional')}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label={t('center.city')}
                  value={centre.city}
                  onChange={setCentreField('city')}
                  error={fieldErrors.city}
                  required
                />
                <TextField
                  label={t('center.district')}
                  value={centre.district}
                  onChange={setCentreField('district')}
                />
              </div>
              <TextField
                label={t('center.address')}
                value={centre.address}
                onChange={setCentreField('address')}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label={t('center.phone')}
                  value={centre.phone}
                  onChange={setCentreField('phone')}
                  error={fieldErrors.phone}
                  placeholder="+998 90 123 45 67"
                  required
                />
                <TextField
                  label={t('center.email')}
                  type="email"
                  value={centre.email}
                  onChange={setCentreField('email')}
                  error={fieldErrors.email}
                />
              </div>
              <TextAreaField
                label={t('center.description')}
                value={centre.description}
                onChange={setCentreField('description')}
                rows={3}
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField
                  label={t('center.telegram')}
                  value={centre.telegramHandle}
                  onChange={setCentreField('telegramHandle')}
                  placeholder="@markaz"
                />
                <TextField
                  label={t('center.instagram')}
                  value={centre.instagram}
                  onChange={setCentreField('instagram')}
                />
                <TextField
                  label={t('center.website')}
                  value={centre.website}
                  onChange={setCentreField('website')}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label={t('settings.timezone')}
                  value={centre.timezone}
                  onChange={setCentreField('timezone')}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label={t('settings.currency')}
                  value={centre.currency}
                  onChange={(e) =>
                    setCentre({ ...centre, currency: e.target.value as (typeof CURRENCIES)[number] })
                  }
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </SelectField>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink">{t('center.courses')}</p>
                <div className="flex flex-wrap gap-2">
                  {CATALOG.map((key) => {
                    const label = t(`courses.${key}` as TKey);
                    const active = courses.includes(label);
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleCourse(label)}
                        className={
                          active
                            ? 'rounded-full border border-brand-500 bg-brand-50 px-3 py-1.5 text-[13px] font-medium text-brand-700'
                            : 'rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft hover:bg-surface-muted'
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={customCourse}
                    onChange={(e) => setCustomCourse(e.target.value)}
                    placeholder={t('courses.custom')}
                    aria-label={t('courses.custom')}
                    className="field h-10 flex-1"
                  />
                  <Button type="button" variant="secondary" onClick={addCustomCourse}>
                    {t('common.add')}
                  </Button>
                </div>
                {courses.filter((c) => !CATALOG.some((k) => t(`courses.${k}` as TKey) === c)).length >
                  0 && (
                  <p className="mt-2 text-[12px] text-ink-soft">
                    {courses
                      .filter((c) => !CATALOG.some((k) => t(`courses.${k}` as TKey) === c))
                      .join(', ')}
                  </p>
                )}
              </div>

              <div>
                <p className="mb-2 text-[13px] font-medium text-ink">{t('center.workingHours')}</p>
                <ul className="flex flex-col gap-1.5">
                  {hours.map((row, index) => (
                    <li key={row.weekday} className="flex flex-wrap items-center gap-2">
                      <span className="w-24 text-[13px] text-ink-soft">
                        {t(`weekdays.long${row.weekday}` as TKey)}
                      </span>
                      <label className="flex items-center gap-1.5 text-[12px] text-ink-soft">
                        <input
                          type="checkbox"
                          checked={row.closed}
                          onChange={(e) => {
                            const next = [...hours];
                            next[index] = { ...row, closed: e.target.checked };
                            setHours(next);
                          }}
                        />
                        {t('center.closedDay')}
                      </label>
                      {!row.closed && (
                        <>
                          <input
                            type="time"
                            value={row.open}
                            aria-label={`${t(`weekdays.long${row.weekday}` as TKey)} — ${t('center.open')}`}
                            onChange={(e) => {
                              const next = [...hours];
                              next[index] = { ...row, open: e.target.value };
                              setHours(next);
                            }}
                            className="field h-9 w-28 text-[13px]"
                          />
                          <input
                            type="time"
                            value={row.close}
                            aria-label={`${t(`weekdays.long${row.weekday}` as TKey)} — ${t('center.close')}`}
                            onChange={(e) => {
                              const next = [...hours];
                              next[index] = { ...row, close: e.target.value };
                              setHours(next);
                            }}
                            className="field h-9 w-28 text-[13px]"
                          />
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1 || busy}
            >
              {t('common.back')}
            </Button>
            {step < TOTAL_STEPS ? (
              <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canContinue}>
                {t('common.next')}
              </Button>
            ) : (
              <Button type="button" onClick={() => void submit()} disabled={busy}>
                {busy ? t('common.saving') : t('center.registerCta')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
