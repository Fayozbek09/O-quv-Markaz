'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { ReminderDialog } from '@/components/forms/ReminderDialog';

export function DebtRowActions({
  studentId,
  studentName,
  parentLinked,
}: {
  studentId: string;
  studentName: string;
  parentLinked: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="whitespace-nowrap rounded-[6px] border border-line-strong px-2.5 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-muted hover:text-ink"
      >
        {t('debt.sendReminder')}
      </button>

      <ReminderDialog
        open={open}
        onClose={() => setOpen(false)}
        studentId={studentId}
        studentName={studentName}
        parentLinked={parentLinked}
      />
    </>
  );
}
