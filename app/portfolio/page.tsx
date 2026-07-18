import Header from '@/src/components/layout/Header';
import { PortfolioClient } from '@/src/components/portfolio/PortfolioClient';
import { createClient } from '@/src/lib/supabase/server';
import { PortfolioRepository } from '@/src/lib/portfolio/repository';
import { getMarketDataProvider } from '@/src/lib/market-data';
import { OptionPositionRepository } from '@/src/lib/portfolio/options/repository';
import { getFxRate } from '@/src/lib/market-data/fx/service';
import { resolveQuote } from '@/src/lib/market-data/quote-cache';

export default async function PortfolioPage() {
  const client = await createClient();
  if (!client) return null;
  const portfolio = await new PortfolioRepository(client).getDefault();
  const optionPositions = await new OptionPositionRepository(client).getAll(portfolio.id);
  const symbols = [...new Set(portfolio.transactions.map((item) => item.symbol).filter((value): value is string => Boolean(value)))];
  let provider: ReturnType<typeof getMarketDataProvider> | null = null;
  try { provider = getMarketDataProvider(); } catch { provider = null; }
  const [quotes, fx] = await Promise.all([Promise.all(symbols.map(async (symbol) => {
    if (!provider) return [symbol, null] as const;
    return [symbol, await resolveQuote(symbol, () => provider!.getQuote(symbol))] as const;
  })), (async () => { try { return await getFxRate('USD', 'THB'); } catch { return { quote: null, unavailable: true }; } })()]);

  return <div className="min-w-0">
    <Header title="พอร์ตโฟลิโอจำลอง" subtitle="คำนวณจากรายการที่คุณบันทึกย้อนหลังด้วยวิธีต้นทุนถัวเฉลี่ยถ่วงน้ำหนัก" />
    <PortfolioClient portfolio={portfolio} marketPrices={Object.fromEntries(quotes)} optionPositions={optionPositions} fx={fx} />
  </div>;
}
