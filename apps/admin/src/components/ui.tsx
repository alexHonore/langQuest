'use client';
/**
 * Form and layout primitives for LangQuest Studio. Every control is a native element with
 * visible focus, labels bound through `Field`, and RTL-aware text inputs (`dir` derived from
 * the language of the content, not the UI locale).
 */
import clsx from 'clsx';
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Info } from 'lucide-react';
import { detectTextDirection, isRtlLocale } from '@langquest/locales';
import { findVariety, type ScriptId } from '@langquest/contracts';
import { useI18n } from '@/src/lib/i18n/client';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md border font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        variant === 'primary' && 'bg-accent text-on-accent border-accent hover:bg-accent-strong',
        variant === 'secondary' && 'bg-surface text-fg border-border hover:bg-surface-muted',
        variant === 'ghost' && 'bg-transparent text-fg-secondary border-transparent hover:bg-surface-muted',
        variant === 'danger' && 'bg-error-soft text-error border-error/40 hover:bg-error hover:text-white',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children}
    </button>
  );
});

export function Spinner({ size = 16, label = 'Loading' }: { size?: number; label?: string }) {
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox="0 0 24 24" className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
}

/** Binds a label, hint and error message to a control through generated ids. */
export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-fg-secondary">
        {label}
        {required ? <span aria-hidden="true" className="text-error"> *</span> : null}
      </label>
      {children(id, describedBy)}
      {hint ? (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlClass = 'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-muted disabled:opacity-60 focus:border-accent';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(controlClass, className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(controlClass, 'min-h-20', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={clsx(controlClass, 'pe-7', className)} {...rest}>
      {children}
    </select>
  );
});

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={clsx('inline-flex items-center gap-2 text-sm cursor-pointer', className)}>
      <input type="checkbox" className="h-4 w-4 accent-accent" {...rest} />
      <span>{label}</span>
    </label>
  );
}

/** Direction + script metadata for a text control holding content in `languageCode` / `varietyId`. */
export function contentTextAttrs(languageOrVariety: string | null | undefined, value?: string): { dir: 'rtl' | 'ltr' | 'auto'; 'data-script'?: ScriptId; lang?: string } {
  if (!languageOrVariety) {
    const detected = value ? detectTextDirection(value) : null;
    return { dir: detected ?? 'auto' };
  }
  const variety = findVariety(languageOrVariety);
  const lang = variety?.bcp47 ?? languageOrVariety;
  const rtl = isRtlLocale(lang);
  const script: ScriptId | undefined = rtl ? (lang.startsWith('he') ? 'Hebr' : 'Arab') : lang.startsWith('hi') ? 'Deva' : lang.startsWith('ja') ? 'Jpan' : lang.startsWith('zh') || lang.startsWith('yue') || lang.startsWith('cmn') ? (lang.includes('HK') || lang.includes('TW') || lang.startsWith('yue') ? 'Hant' : 'Hans') : undefined;
  return { dir: rtl ? 'rtl' : 'ltr', lang, ...(script ? { 'data-script': script } : {}) };
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'dir'> {
  /** Language code / variety id of the content (drives `dir`, `lang` and script line-height). */
  contentLanguage?: string | null;
  multiline?: boolean;
}

/** Text control whose direction follows the content language (Arabic/Hebrew → RTL). */
export function TextField({ contentLanguage, multiline, className, value, ...rest }: TextFieldProps) {
  const attrs = contentTextAttrs(contentLanguage, typeof value === 'string' ? value : undefined);
  if (multiline) {
    return <textarea className={clsx(controlClass, 'min-h-16', className)} value={value as string | undefined} {...attrs} {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} />;
  }
  return <input className={clsx(controlClass, className)} value={value} {...attrs} {...rest} />;
}

/** Inline SVG from the `@langquest/ui` string renderers (trusted, generated in code — never user input). */
export function InlineArt({ svg, label, className, style }: { svg: string; label: string; className?: string; style?: CSSProperties }) {
  return <div role="img" aria-label={label} className={clsx('svg-preview', className)} style={style} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * The ⓘ affordance (text-budget rule): explanations live behind it, not on the screen. A
 * toggle button opens a small note; Escape or clicking outside closes it.
 */
export function InfoTip({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);
  return (
    <span ref={ref} className={clsx('relative inline-flex align-middle', className)}>
      <button
        type="button"
        aria-label={label ?? t('admin.ui.moreInfo')}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={clsx('inline-flex h-6 w-6 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg', open && 'bg-surface-muted text-fg')}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      {open ? (
        <span id={id} role="note" className="absolute start-0 top-full z-30 mt-1 w-72 max-w-[80vw] rounded-md border border-border bg-elevated p-2.5 text-xs font-normal text-fg-secondary shadow-lg">
          {children}
        </span>
      ) : null}
    </span>
  );
}

export function Card({ title, info, actions, children, className }: { title?: ReactNode; /** Explanation behind ⓘ in the card header. */ info?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-lg border border-border bg-surface', className)}>
      {title || actions ? (
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="flex items-center gap-1 text-sm font-semibold">
            {title}
            {info ? <InfoTip>{info}</InfoTip> : null}
          </h2>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * One heading, at most one helper line (`description`), explanations behind ⓘ (`info`).
 * Prefer `info` for anything that explains rather than instructs.
 */
export function PageHeader({ title, description, info, actions }: { title: ReactNode; description?: ReactNode; info?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-1.5 text-xl font-semibold">
          {title}
          {info ? <InfoTip>{info}</InfoTip> : null}
        </h1>
        {description ? <p className="mt-0.5 text-sm text-fg-muted max-w-3xl">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'success' | 'warning' | 'error' }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className={clsx('mt-1 text-2xl font-semibold tabular-nums', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning', tone === 'error' && 'text-error')}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-fg-muted">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description, action, art }: { title: ReactNode; description?: ReactNode; action?: ReactNode; /** Brand art above the title (e.g. `<Melo state="curious" />`). */ art?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      {art ? <div className="mb-3 flex justify-center">{art}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="mt-1 text-xs text-fg-muted max-w-md mx-auto">{description}</p> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, message, onRetry, retryLabel }: { title: ReactNode; message: ReactNode; onRetry?: () => void; retryLabel?: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-error/40 bg-error-soft px-4 py-3 text-sm">
      <p className="font-medium text-error">{title}</p>
      <p className="mt-1 text-fg-secondary break-words">{message}</p>
      {onRetry ? (
        <Button className="mt-2" size="sm" onClick={onRetry}>
          {retryLabel ?? 'Retry'}
        </Button>
      ) : null}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'success' | 'error'; children: ReactNode }) {
  return (
    <div
      className={clsx(
        'rounded-md border px-3 py-2 text-sm',
        tone === 'info' && 'border-info/40 bg-info-soft',
        tone === 'warning' && 'border-warning/40 bg-warning-soft',
        tone === 'success' && 'border-success/40 bg-success-soft',
        tone === 'error' && 'border-error/40 bg-error-soft',
      )}
    >
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-surface-muted px-1 font-mono text-[11px]">{children}</kbd>;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={clsx('font-mono text-xs break-all', className)}>{children}</code>;
}
