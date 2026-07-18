'use client';
import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { HistoricalPrice } from '@/src/lib/market-data/types';
export default function HistoricalChart({ prices }: { prices: HistoricalPrice[] }) {
  const [fullscreen, setFullscreen] = useState(false);
  if (!prices.length) return <div className="flex h-full items-center justify-center text-sm text-slate-500">ไม่มีข้อมูลกราฟในช่วงนี้</div>;
  const content = <ResponsiveContainer width="100%" height="100%"><AreaChart data={prices} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}><defs><linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#D4FF00" stopOpacity={0.3}/><stop offset="1" stopColor="#D4FF00" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#1e293b" vertical={false}/><XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#64748b" minTickGap={36}/><YAxis domain={['auto','auto']} tick={{ fontSize: 10 }} stroke="#64748b"/><Tooltip contentStyle={{ background: '#151B28', border: '1px solid #334155', borderRadius: 8 }}/><Area type="monotone" dataKey="close" stroke="#D4FF00" fill="url(#priceFill)" dot={false}/></AreaChart></ResponsiveContainer>;
  return <><button onClick={() => setFullscreen(true)} className="absolute right-3 top-3 z-10 rounded-lg bg-slate-800 px-3 text-xs text-white">เต็มจอ</button>{content}{fullscreen && <div className="fixed inset-0 z-50 bg-[#0A0E17] p-3 sm:p-6"><button onClick={() => setFullscreen(false)} className="absolute right-4 top-4 z-10 rounded-lg bg-slate-800 px-4 text-sm">ปิด</button><div className="h-full w-full pt-12">{content}</div></div>}</>;
}
