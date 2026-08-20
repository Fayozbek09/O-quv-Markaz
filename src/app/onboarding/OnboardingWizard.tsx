'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { TextField, SelectField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/forms/AuthCard';
import { Logo } from '@/components/ui/Logo';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { LogoUploader } from '@/components/forms/LogoUploader';
import { StudentQuickForm } from '@/components/forms/StudentQuickForm';
import { GroupQuickForm } from '@/components/forms/GroupQuickForm';

const TIMEZONES = ['Asia/Tashkent', 'Asia/Samarkand', 'Asia/Almaty', 'Europe/Moscow', 'UTC'];
const CURRENCIES = ['UZS', 'USD', 'RUB', 'EUR'] as const;
const TOTAL_STEPS = 7;

export function OnboardingWizard({ initialFirstName }: { initialFirstName: string }) {
  const t = useT();
  const router = useRouter();
  const csrf = useCsrfToken();

  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState('');
  const [subject, setSubject] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Tashkent');
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>('UZS');
  const [orgCreated, setOrgCreated] = useState(false);
  const [firstStudentId, setFirstStudentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Steps 1-3 are collected locally, then committed in one request at step 3. */
  async function createWorkspace() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/onboarding', {
        method: 'POST',
        csrfToken: csrf,
        body: { firstName, lastName: lastName || undefined, teachingSubject: subject || undefined, workspaceName, timezone, currency },
      });
      setOrgCreated(true);
      setStep(4);
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Logo size={26} />
        <LanguageSwitcher compact />
      </header>

      <main id="main" className="flex flex-1 justify-center px-4 py-4 sm:py-10">
        <div className="w-full max-w-lg">
          <div className="mb-4">
            <div className="flex items-center justify-between text-[12px] text-ink-faint">
              <span>{t('onboarding.title')}</span>
              <span className="tnum">{t('onboarding.stepOf', { current: step, total: TOTAL_STEPS })}</span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={step}
              aria-valuemin={1}
              aria-valuemax={TOTAL_STEPS}
              aria-label={t('onboarding.title')}
              className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line"
            >
              <div
                className="h-full rounded-full bg-brand-500 transition-[width] duration-200"
                style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
              />
            </div>
          </div>

          <div className="card p-6">
            <FormError message={error} />

            {step === 1 && (
              <Step title={t('onboarding.step1Title')}>
                <TextField label={t('students.firstName')} value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoFocus maxLength={80} />
                <TextField label={t('students.lastName')} value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={80} />
                <Button size="lg" fullWidth disabled={firstName.trim().length < 1} onClick={() => setStep(2)}>
                  {t('common.next')}
                </Button>
              </Step>
            )}

            {step === 2 && (
              <Step title={t('onboarding.step2Title')} onBack={() => setStep(1)}>
                <TextField
                  label={t('settings.subject')}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={t('onboarding.step2Placeholder')}
                  autoFocus
                  maxLength={120}
                />
                <div className="flex gap-2">
                  <Button variant="secondary" size="lg" onClick={() => setStep(3)}>
                    {t('common.skip')}
                  </Button>
                  <Button size="lg" fullWidth onClick={() => setStep(3)}>
                    {t('common.next')}
                  </Button>
                </div>
              </Step>
            )}

            {step === 3 && (
              <Step title={t('onboarding.step3Title')} onBack={() => setStep(2)}>
                <TextField
                  label={t('settings.centerName')}
                  hint={t('onboarding.step3Hint')}
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  required
                  autoFocus
                  maxLength={160}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField label={t('settings.timezone')} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </SelectField>
                  <SelectField
                    label={t('settings.currency')}
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as (typeof CURRENCIES)[number])}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </SelectField>
                </div>
                <Button size="lg" fullWidth disabled={busy || workspaceName.trim().length < 2} onClick={() => void createWorkspace()}>
                  {busy ? t('common.saving') : t('common.next')}
                </Button>
              </Step>
            )}

            {step === 4 && orgCreated && (
              <Step title={t('onboarding.step4Title')}>
                <p className="text-[13px] text-ink-soft">{t('onboarding.step4Hint')}</p>
                <LogoUploader />
                <div className="flex gap-2">
                  <Button variant="secondary" size="lg" onClick={() => setStep(5)}>
                    {t('common.skip')}
                  </Button>
                  <Button size="lg" fullWidth onClick={() => setStep(5)}>
                    {t('common.next')}
                  </Button>
                </div>
              </Step>
            )}

            {step === 5 && (
              <Step title={t('onboarding.step5Title')}>
                <StudentQuickForm
                  onCreated={(id) => { setFirstStudentId(id); setStep(6); }}
                  onSkip={() => setStep(6)}
                />
              </Step>
            )}

            {step === 6 && (
              <Step title={t('onboarding.step6Title')}>
                <GroupQuickForm
                  studentIdToAdd={firstStudentId}
                  onCreated={() => setStep(7)}
                  onSkip={() => setStep(7)}
                />
              </Step>
            )}

            {step === 7 && (
              <Step title={t('onboarding.done')}>
                <p className="text-[13px] text-ink-soft">{t('onboarding.doneText')}</p>
                <Button size="lg" fullWidth onClick={finish}>
                  {t('onboarding.goToDashboard')}
                </Button>
              </Step>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Step({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {children}
      {onBack && (
        <button type="button" onClick={onBack} className="self-start text-[12px] text-ink-soft hover:underline">
          ← Back
        </button>
      )}
    </div>
  );
}
