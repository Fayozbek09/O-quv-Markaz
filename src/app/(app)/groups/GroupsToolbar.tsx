'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { GroupQuickForm } from '@/components/forms/GroupQuickForm';
import { PageHeader } from '@/components/layout/PageHeader';
import { CheckboxField } from '@/components/ui/Field';

export function GroupsToolbar({ openNew, showArchived }: { openNew: boolean; showArchived: boolean }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(openNew);

  function toggleArchived(next: boolean) {
    const search = new URLSearchParams(params.toString());
    if (next) search.set('archived', '1');
    else search.delete('archived');
    router.replace(`${pathname}?${search.toString()}`);
  }

  return (
    <>
      <PageHeader
        title={t('groups.title')}
        actions={
          <>
            <CheckboxField
              label={t('groups.statusArchived')}
              checked={showArchived}
              onChange={(e) => toggleArchived(e.target.checked)}
            />
            <Button onClick={() => setOpen(true)}>+ {t('groups.add')}</Button>
          </>
        }
      />

      <Modal open={open} onClose={() => setOpen(false)} title={t('groups.add')} wide>
        <GroupQuickForm
          onCreated={(id) => { setOpen(false); router.push(`/groups/${id}`); }}
          onCancel={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
