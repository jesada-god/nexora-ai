'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import type { MarketDataEnvelope, SymbolSearchResult } from '@/src/lib/market-data/types';
import { InfoPopover } from './InfoPopover';
import { STOCK_SEARCH_DEBOUNCE_MS, searchKeyDecision } from './search-logic';

interface StockSearchProps {
  selected: SymbolSearchResult | null;
  onSelect: (result: SymbolSearchResult) => void;
  onClear: () => void;
}

export function StockSearch({ selected, onSelect, onClear }: StockSearchProps) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    const normalized = query.trim();
    if (!open || !normalized || selected?.symbol === normalized.toUpperCase()) return;
    const currentRequest = ++requestId.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/market/search?q=${encodeURIComponent(normalized)}&includeDelisted=false&limit=8`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        const payload = await response.json() as MarketDataEnvelope<SymbolSearchResult[]>;
        if (currentRequest !== requestId.current) return;
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'ค้นหาหุ้นไม่สำเร็จ');
        setResults(payload.data.filter((item) => item.status === 'active').slice(0, 8));
        setActiveIndex(-1);
      } catch (cause) {
        if (!controller.signal.aborted && currentRequest === requestId.current) {
          setResults([]);
          setError(cause instanceof Error ? cause.message : 'ค้นหาหุ้นไม่สำเร็จ');
        }
      } finally {
        if (currentRequest === requestId.current) setLoading(false);
      }
    }, STOCK_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, selected]);

  function closeSearch() {
    setOpen(false);
    setResults([]);
    setLoading(false);
  }

  function choose(result: SymbolSearchResult) {
    setQuery(result.symbol);
    closeSearch();
    setActiveIndex(-1);
    setError('');
    onSelect(result);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const decision = searchKeyDecision(event.key, open, activeIndex, results.length);
    if (decision.action === 'close') {
      event.preventDefault();
      closeSearch();
      setActiveIndex(-1);
    } else if (decision.action === 'move') {
      event.preventDefault();
      setActiveIndex(decision.index);
    } else if (decision.action === 'select') {
      event.preventDefault();
      choose(results[decision.index]);
    }
  }

  return (
    <div className="relative min-w-0">
      <div className="mb-1 flex min-w-0 items-center gap-1">
        <label htmlFor="price-target-stock-search" className="min-w-0 break-words text-sm font-semibold text-slate-200">
          เลือกหุ้นที่ต้องการวิเคราะห์
        </label>
        <InfoPopover
          title="เลือกหุ้นที่ต้องการวิเคราะห์"
          what="ค้นหาแล้วเลือกหุ้นจริงก่อนเริ่มคำนวณ ระบบจะไม่คำนวณจากข้อความที่พิมพ์แต่ยังไม่ได้เลือก"
          source="ค้นหาได้จาก Symbol เช่น NVDA หรือชื่อบริษัทจากฐานข้อมูลตราสารที่ระบบมีอยู่"
          example="พิมพ์ NVDA แล้วกดลูกศรลงและ Enter เพื่อเลือก NVIDIA"
          effect="หุ้นที่เลือกกำหนดราคาปัจจุบัน สกุลเงิน และข้อมูล EPS จริงที่อาจนำมาเป็นค่าเริ่มต้น"
        />
      </div>
      <div className="relative">
        <Search aria-hidden="true" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          id="price-target-stock-search"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-describedby="price-target-stock-search-help"
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder="ค้นหาด้วย Symbol หรือชื่อบริษัท"
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(closeSearch, 120)}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            setOpen(true);
            setError('');
            if (!nextQuery.trim()) {
              setResults([]);
              setLoading(false);
            }
            if (selected) onClear();
          }}
          className="min-h-12 w-full min-w-0 rounded-xl border border-slate-700 bg-slate-950/60 py-3 pl-10 pr-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-[#D4FF00] focus:ring-2 focus:ring-[#D4FF00]/20"
        />
      </div>
      <p id="price-target-stock-search-help" className="mt-2 text-xs text-slate-500">
        รอค้นหา {STOCK_SEARCH_DEBOUNCE_MS} ms · ใช้ ↑ ↓ เลือก, Enter ยืนยัน, Escape ปิดรายการ
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-amber-300">unavailable: {error}</p>}
      {open && query.trim() && !selected && (
        <div id={listId} role="listbox" className="absolute z-50 mt-2 max-h-72 w-full min-w-0 overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
          {loading && <p role="status" className="p-4 text-sm text-slate-400">กำลังค้นหา…</p>}
          {!loading && !error && results.length === 0 && (
            <p className="p-4 text-sm text-slate-500">ไม่พบผลลัพธ์ที่เลือกได้</p>
          )}
          {!loading && results.map((result, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              id={`${listId}-${index}`}
              key={`${result.symbol}-${result.exchange ?? ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(result)}
              className={`flex min-h-14 w-full min-w-0 items-start gap-3 border-b border-slate-800 px-4 py-3 text-left last:border-0 ${index === activeIndex ? 'bg-slate-800' : 'hover:bg-slate-900'}`}
            >
              <span className="w-20 shrink-0 break-words font-bold text-white">{result.symbol}</span>
              <span className="min-w-0 flex-1 break-words">
                <span className="block text-sm text-slate-200">{result.name}</span>
                <span className="mt-1 block text-xs text-slate-500">{result.exchange ?? 'ไม่ระบุตลาด'} · {result.currency ?? 'ไม่ระบุสกุลเงิน'}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
