import { Skeleton } from '@/src/components/ui/Skeleton';

export default function StockDetailLoading() {
  return <div className="pb-20" aria-busy="true" aria-label="กำลังโหลดข้อมูลหุ้น">
    <div className="flex min-h-16 items-center justify-between border-b border-border bg-bg-base px-3">
      <div className="flex items-center gap-3"><Skeleton className="h-11 w-11 rounded-full"/><div className="space-y-2"><Skeleton className="h-5 w-20"/><Skeleton className="h-3 w-36"/></div></div>
      <div className="flex gap-2"><Skeleton className="h-11 w-11 rounded-full"/><Skeleton className="h-11 w-11 rounded-full"/><Skeleton className="h-11 w-11 rounded-full"/></div>
    </div>
    <main className="space-y-6 p-4 md:p-8">
      <section className="min-h-40 rounded-2xl border border-border bg-bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-3"><div className="flex flex-wrap items-end gap-3"><Skeleton className="h-12 w-44"/><Skeleton className="h-6 w-40"/></div><Skeleton className="h-5 w-72 max-w-full"/></div>
          <Skeleton className="h-12 w-36"/>
        </div>
      </section>
      <Skeleton className="h-12 w-full"/>
      <Skeleton className="h-[360px] w-full rounded-2xl"/>
    </main>
  </div>;
}
