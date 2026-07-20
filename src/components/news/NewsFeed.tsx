'use client';
/* eslint-disable @next/next/no-img-element -- remote URLs are validated and Data Saver suppresses image requests entirely */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageOff, Newspaper } from 'lucide-react';
import { Skeleton } from '@/src/components/ui/Skeleton';
import type { NewsArticle, NewsPage } from '@/src/lib/news/types';
import { newsErrorMessage, shouldRenderNewsImage } from './news-policy';
import { useStore } from '@/src/store/useStore';
import { useAppActive } from '@/src/hooks/useAppActive';
import { useOnlineStatus } from '@/src/hooks/useOnlineStatus';
import { formatBangkokDateTime } from '@/src/lib/presentation/datetime';

type ApiError = { code: string; message: string; retryable?: boolean; retryAfterSeconds?: number };
type ApiResponse = { data: NewsPage | null; error: ApiError | null; meta: { timestamp: string; asOf: string | null; status: 'live' | 'cached' | 'stale' | 'unavailable' } };
const pending = new Map<string, Promise<ApiResponse>>(); const pages = new Map<string, { value: ApiResponse; savedAt: number }>();
const CACHE_MS = 5 * 60_000;
function load(url: string, force = false) {
  const cached = pages.get(url); if (!force && cached && Date.now() - cached.savedAt < CACHE_MS) return Promise.resolve(cached.value);
  const existing = pending.get(url); if (existing) return existing;
  const request = fetch(url).then(async (response) => (await response.json()) as ApiResponse).then((value) => { if (value.data) pages.set(url, { value, savedAt: Date.now() }); return value; }).catch((error) => { if (cached) return cached.value; throw error; }).finally(() => pending.delete(url)); pending.set(url, request); return request;
}
function useDataSaver() {
  const requested = useStore((state) => state.dataSaver);
  const [networkPreference, setNetworkPreference] = useState(false);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setNetworkPreference(Boolean(
          (navigator as Navigator & { connection?: { saveData?: boolean } })
            .connection?.saveData,
        ));
      }
    });
    return () => { active = false; };
  }, []);
  return requested || networkPreference;
}
export function NewsFeed({ symbol, compact = false }: { symbol?: string; compact?: boolean }) {
  const root = useRef<HTMLDivElement>(null); const [ready, setReady] = useState(false); const [items, setItems] = useState<NewsArticle[]>([]); const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false); const [error, setError] = useState<ApiError>(); const [timestamp, setTimestamp] = useState<string>(); const [retryAt, setRetryAt] = useState(0); const [now, setNow] = useState(0); const saveData = useDataSaver();
  const active = useAppActive(); const isOnline = useOnlineStatus();
  useEffect(() => { const node = root.current; if (!node || typeof IntersectionObserver === 'undefined') { queueMicrotask(() => setReady(true)); return; } const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setReady(true); observer.disconnect(); } }, { rootMargin: '200px' }); observer.observe(node); return () => observer.disconnect(); }, []);
  const fetchPage = useCallback(async (next?: string, force = false) => {
    if (!active || !isOnline || Date.now() < retryAt) return; setLoading(true); const params = new URLSearchParams(); if (symbol) params.set('symbol', symbol); if (next) params.set('cursor', next);
    try { const result = await load(`/api/news?${params}`, force); if (result.error || !result.data) { const nextError = result.error ?? { code: 'NEWS_PROVIDER_UPSTREAM_FAILURE', message: 'News unavailable', retryable: true }; setError(nextError); if (nextError.retryable) { const currentTime = Date.now(); setNow(currentTime); setRetryAt(currentTime + (nextError.retryAfterSeconds ?? 30) * 1000); } }
      else { setItems((current) => { const map = new Map(next ? current.map((item) => [item.id, item]) : []); result.data!.articles.forEach((item) => map.set(item.id, item)); return [...map.values()]; }); setCursor(result.data.nextCursor); setTimestamp(result.meta.asOf ?? result.meta.timestamp); setError(undefined); }
    } catch { const currentTime = Date.now(); setNow(currentTime); setError({ code: 'NEWS_PROVIDER_UPSTREAM_FAILURE', message: 'News unavailable', retryable: true }); setRetryAt(currentTime + 30_000); } finally { setLoading(false); }
  }, [active, isOnline, retryAt, symbol]);
  useEffect(() => { if (ready && active && isOnline) queueMicrotask(() => void fetchPage()); }, [ready, active, isOnline, fetchPage]);
  useEffect(() => { if (!retryAt || !active) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active, retryAt]);
  const cooldown = Math.max(0, Math.ceil((retryAt - now) / 1000));
  let content: React.ReactNode;
  if (!ready || (loading && items.length === 0)) content = <div className="space-y-3" aria-label="Loading news">{[1,2,3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}</div>;
  else if (error && items.length === 0) content = <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-6 text-center"><Newspaper className="mx-auto mb-2 text-slate-500" /><p className="text-sm text-slate-300">{newsErrorMessage(error.code)}</p><button disabled={cooldown > 0} onClick={() => void fetchPage(undefined, true)} className="mt-3 rounded-lg border border-slate-700 px-3 py-2 text-xs text-white disabled:opacity-50">{cooldown ? `ลองใหม่ใน ${cooldown} วินาที` : 'ลองใหม่'}</button></div>;
  else if (!items.length) content = <div className="rounded-xl border border-slate-800 p-6 text-center text-sm text-slate-400">ยังไม่มีข่าวในขณะนี้</div>;
  else content = <div className="space-y-3">{timestamp && <p className="text-right text-[10px] text-slate-500">อัปเดต {formatBangkokDateTime(timestamp)}</p>}{items.slice(0, compact ? 4 : undefined).map((article) => <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer" className="flex min-h-24 gap-3 rounded-xl border border-slate-800 bg-[#151B28] p-3 hover:border-slate-700">{shouldRenderNewsImage(saveData, article.imageUrl) ? <img src={article.imageUrl!} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-20 w-24 shrink-0 rounded-lg object-cover" /> : <div className="flex h-20 w-24 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-500"><ImageOff size={20} /></div>}<div className="min-w-0"><h3 className="line-clamp-2 text-sm font-semibold leading-snug text-slate-100">{article.title}</h3><p className="mt-2 text-xs text-slate-500">{article.source} · {formatBangkokDateTime(article.publishedAt)}</p>{saveData && <span className="mt-1 inline-block text-[10px] text-amber-300">Data Saver</span>}</div></a>)}{!compact && cursor && <button disabled={loading} onClick={() => void fetchPage(cursor)} className="w-full rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm text-white disabled:opacity-50">{loading ? 'กำลังโหลด…' : 'โหลดเพิ่มเติม'}</button>}</div>;
  return <div ref={root}>{content}</div>;
}
