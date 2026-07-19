'use client';

import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { useDialogA11y } from '@/src/hooks/useDialogA11y';

interface InfoPopoverProps {
  title: string;
  what: string;
  source: string;
  example: string;
  effect: string;
}

export function InfoPopover({ title, what, source, example, effect }: InfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const dialogRef = useDialogA11y(open, () => setOpen(false));

  return (
    <>
      <button
        type="button"
        aria-label={`อธิบาย ${title}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-slate-400 outline-none transition hover:bg-slate-800 hover:text-[#D4FF00] focus-visible:ring-2 focus-visible:ring-[#D4FF00]"
      >
        <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full border border-current">?</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
          <button
            type="button"
            aria-label="ปิดคำอธิบาย"
            className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative z-10 max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-700 bg-[#151B28] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl outline-none sm:rounded-2xl"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <h2 id={titleId} className="min-w-0 break-words text-lg font-bold text-white">{title}</h2>
              <button
                type="button"
                aria-label="ปิดคำอธิบาย"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4FF00]"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <dl className="mt-4 space-y-4 text-sm leading-6">
              <div>
                <dt className="font-semibold text-[#D4FF00]">คืออะไร / ใส่อะไร</dt>
                <dd className="mt-1 break-words text-slate-300">{what}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[#D4FF00]">ดูค่าจากไหน</dt>
                <dd className="mt-1 break-words text-slate-300">{source}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[#D4FF00]">ตัวอย่าง</dt>
                <dd className="mt-1 break-words text-slate-300">{example}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[#D4FF00]">มีผลอย่างไร</dt>
                <dd className="mt-1 break-words text-slate-300">{effect}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </>
  );
}
