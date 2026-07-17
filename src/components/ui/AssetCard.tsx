import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Asset } from '../../types';
import Sparkline from './Sparkline';
import Link from 'next/link';

interface AssetCardProps {
  asset: Asset;
}

export default function AssetCard({ asset }: AssetCardProps) {
  const isPositive = asset.change >= 0;

  return (
    <Link href={`/stock/${asset.symbol}`} className="block">
      <div className="bg-[#151B28] border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors cursor-pointer flex flex-col h-full shadow-lg">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h3 className="font-bold text-white text-sm">{asset.symbol}</h3>
            <p className="text-[10px] text-slate-500 line-clamp-1">{asset.name}</p>
          </div>
          <div className="flex items-center">
            {isPositive ? (
              <ArrowUpRight size={14} className="text-emerald-500" />
            ) : (
              <ArrowDownRight size={14} className="text-red-500" />
            )}
          </div>
        </div>

        <div className="mt-2 flex-1 flex flex-col justify-end">
          <p className="text-lg font-bold text-white font-mono">{asset.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p className={`text-xs font-bold ${isPositive ? 'text-emerald-500' : 'text-red-500'}`}>
            {isPositive ? '+' : ''}{asset.change.toFixed(2)} ({Math.abs(asset.changePercent).toFixed(2)}%)
          </p>
        </div>
        
        <div className="mt-3 h-10 w-full opacity-60">
          <Sparkline data={asset.sparkline} isPositive={isPositive} />
        </div>
      </div>
    </Link>
  );
}
