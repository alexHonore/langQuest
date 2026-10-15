'use client';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';

export type ToastTone = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}
interface ToastApi {
  push(message: string, tone?: ToastTone): void;
  success(message: string): void;
  error(message: string): void;
}
const ToastContext = createContext<ToastApi | null>(null);

/** Minimal accessible toast stack (aria-live polite). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = ++counter.current;
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 9000 : 5000);
  }, []);
  const api = useMemo<ToastApi>(() => ({ push, success: (m) => push(m, 'success'), error: (m) => push(m, 'error') }), [push]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 end-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={clsx(
              'rounded-md border px-3 py-2 text-sm shadow-lg bg-elevated',
              t.tone === 'success' && 'border-success text-success',
              t.tone === 'error' && 'border-error text-error',
              t.tone === 'info' && 'border-border text-fg',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) return { push: () => undefined, success: () => undefined, error: () => undefined };
  return ctx;
}
