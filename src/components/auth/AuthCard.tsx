import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { appConfig } from '@/src/config/app';

interface AuthCardProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export function AuthCard({ title, description, children }: AuthCardProps) {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-md items-center px-4 py-8 sm:px-6">
      <section className="w-full rounded-2xl border border-slate-800 bg-[#151B28] p-5 shadow-2xl sm:p-7">
        <Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#D4FF00] text-lg text-black">N</span>
          {appConfig.name}
        </Link>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
        </div>
        {children}
        <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-slate-500">
          <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
          Session จัดเก็บใน secure cookie โดย Supabase และไม่มี Service Role key ในเบราว์เซอร์
        </p>
      </section>
    </div>
  );
}
