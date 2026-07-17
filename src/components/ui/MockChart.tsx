'use client';
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Bar } from 'recharts';

const generateMockData = (basePrice: number) => {
  let currentPrice = basePrice * 0.8;
  const data = [];
  for (let i = 0; i < 30; i++) {
    currentPrice = currentPrice * (1 + (Math.random() * 0.06 - 0.025));
    data.push({
      date: `Day ${i + 1}`,
      price: currentPrice,
      volume: Math.random() * 1000000 + 500000,
      ema20: currentPrice * (1 + (Math.random() * 0.02 - 0.01)),
      ema50: currentPrice * (1 + (Math.random() * 0.04 - 0.02)),
    });
  }
  return data;
};

export default function MockChart({ basePrice, showEma }: { basePrice: number, showEma: boolean }) {
  const data = generateMockData(basePrice);
  const min = Math.min(...data.map(d => Math.min(d.price, d.ema20, d.ema50))) * 0.95;
  const max = Math.max(...data.map(d => Math.max(d.price, d.ema20, d.ema50))) * 1.05;

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis dataKey="date" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} minTickGap={30} />
          <YAxis yAxisId="right" orientation="right" domain={[min, max]} stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => val.toFixed(2)} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#151B28', borderColor: '#1e293b', borderRadius: '8px' }}
            itemStyle={{ color: '#D4FF00' }}
            labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
          />
          <Line yAxisId="right" type="monotone" dataKey="price" stroke="#D4FF00" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#D4FF00', stroke: '#0A0E17', strokeWidth: 2 }} />
          {showEma && <Line yAxisId="right" type="monotone" dataKey="ema20" stroke="#3b82f6" strokeWidth={1} dot={false} />}
          {showEma && <Line yAxisId="right" type="monotone" dataKey="ema50" stroke="#a855f7" strokeWidth={1} dot={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
