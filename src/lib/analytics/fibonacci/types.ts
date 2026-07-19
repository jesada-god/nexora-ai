export interface FibonacciLevel { ratio: 0.382 | 0.5 | 0.618; price: number; }
export type FibonacciResult = {
  status: 'available';
  direction: 'uptrend' | 'downtrend';
  start: { date: string; price: number };
  end: { date: string; price: number; confirmedAt: string };
  levels: FibonacciLevel[];
  methodology: string;
} | { status: 'unavailable'; reason: string; methodology: string; };
