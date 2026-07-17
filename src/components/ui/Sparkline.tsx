'use client';

import { ResponsiveContainer, LineChart, Line, YAxis } from 'recharts';

interface SparklineProps {
  data: number[];
  isPositive: boolean;
  width?: number | string;
  height?: number;
}

export default function Sparkline({ data, isPositive, width = '100%', height = 40 }: SparklineProps) {
  const chartData = data.map((val, i) => ({ index: i, value: val }));
  const min = Math.min(...data);
  const max = Math.max(...data);
  
  const color = isPositive ? '#10B981' : '#EF4444';

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <YAxis domain={[min, max]} hide />
          <Line 
            type="monotone" 
            dataKey="value" 
            stroke={color} 
            strokeWidth={1.5} 
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
