import { NextRequest, NextResponse } from 'next/server';
import { getFxRate } from '@/src/lib/market-data/fx/service';
import { currencySchema, fxApiEnvelopeSchema } from '@/src/lib/market-data/fx/types';

export async function GET(request: NextRequest) {
  const base = currencySchema.safeParse(request.nextUrl.searchParams.get('base'));
  const quote = currencySchema.safeParse(request.nextUrl.searchParams.get('quote'));
  if (!base.success || !quote.success) return NextResponse.json({ data: null, error: 'รองรับเฉพาะ USD และ THB' }, { status: 400 });
  if (base.data === quote.data) return NextResponse.json({ data: null, error: 'กรุณาระบุคู่สกุลเงินที่ต่างกัน' }, { status: 400 });
  try {
    const result = await getFxRate(base.data, quote.data);
    if (!result.quote) return NextResponse.json({ data: null, error: 'ไม่มีอัตราแลกเปลี่ยนจริงหรืออัตราที่บันทึกไว้' }, { status: 503 });
    const warning = result.quote.stale ? 'กำลังใช้อัตราแลกเปลี่ยนล่าสุดที่บันทึกไว้' : null;
    const envelope = fxApiEnvelopeSchema.parse({ data: { ...result.quote, warning } });
    return NextResponse.json(envelope, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=840' },
    });
  } catch {
    return NextResponse.json({ data: null, error: 'ไม่สามารถโหลดอัตราแลกเปลี่ยนได้' }, { status: 503 });
  }
}
