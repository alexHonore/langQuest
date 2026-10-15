'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/src/lib/i18n/client';

/** Native `<dialog>` modal: focus trap, Escape to close, backdrop click to close. */
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto w-[min(96vw,${wide ? '64rem' : '40rem'})] rounded-lg border border-border bg-elevated p-0 text-fg shadow-xl backdrop:bg-black/40`}
      style={{ maxWidth: wide ? '64rem' : '40rem', width: 'min(96vw, 100%)' }}
    >
      {open ? (
        <div className="flex max-h-[90vh] flex-col">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label={t('common.a11y.closeDialog')} className="rounded p-1 text-fg-muted hover:bg-surface-muted">
              <X size={16} />
            </button>
          </header>
          <div className="overflow-y-auto px-4 py-3">{children}</div>
          {footer ? <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}
