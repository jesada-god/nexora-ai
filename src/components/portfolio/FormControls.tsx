'use client';

import { useEffect, useRef } from 'react';
import { safeScrollIntoView } from './focus';

export function Field({ label, error, helper, children }: { label: string; error?: string; helper?: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-slate-200">{label}<span className="mt-1.5 block">{children}</span>
    {helper && <span className="mt-1 block text-xs font-normal text-slate-500">{helper}</span>}{error && <span className="mt-1 block text-xs font-normal text-red-400">{error}</span>}</label>;
}

export function DecimalInput({ value, onChange, placeholder = '0.00', signed = false }: { value: string; onChange: (value: string) => void; placeholder?: string; signed?: boolean }) {
  const timerRef = useRef<number | null>(null);
  useEffect(() => () => { if (timerRef.current != null) window.clearTimeout(timerRef.current); }, []);
  return <input type="text" inputMode="decimal" value={value} placeholder={placeholder} className="form-input"
    onFocus={(event) => {
      const element = event.currentTarget;
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => safeScrollIntoView(element), 150);
    }}
    onChange={(event) => {
      const normalized = event.target.value.replace(',', '.');
      const pattern = signed ? /^-?\d*(?:\.\d*)?$/ : /^\d*(?:\.\d*)?$/;
      if (pattern.test(normalized)) onChange(normalized);
    }} />;
}
