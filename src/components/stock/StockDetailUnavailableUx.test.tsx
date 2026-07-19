import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MarketDataApiError, Quote } from '@/src/lib/market-data/types';
import { CompanyProfileCard } from './CompanyProfileCard';
import { StockPriceHeader } from './StockPriceHeader';

vi.stubGlobal('React', React);

const unavailableFreshness = {
  status: 'unavailable' as const,
  asOf: null,
  maxAgeSeconds: null,
};

const rateLimitedProfile: MarketDataApiError = {
  code: 'rate-limited',
  message: 'Profile quota exceeded',
  retryable: true,
  retryAfterSeconds: 30,
};

function occurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}

describe('Stock Detail unavailable UX', () => {
  it('deduplicates Profile errors and keeps missing fields non-technical', () => {
    const html = renderToStaticMarkup(
      <CompanyProfileCard
        symbol="RKLB"
        profile={null}
        freshness={unavailableFreshness}
        provider={null}
        error={rateLimitedProfile}
        loading={false}
        retryAt={0}
        onRetry={vi.fn()}
      />,
    );

    expect(occurrences(html, 'ข้อมูลบริษัทไม่พร้อมใช้งานชั่วคราว')).toBe(1);
    expect(occurrences(
      html,
      'ผู้ให้บริการข้อมูลถึงขีดจำกัดการเรียกใช้งาน กรุณาลองใหม่ภายหลัง',
    )).toBe(1);
    expect(occurrences(html, 'ไม่พบข้อมูล')).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain('rate-limited');
    expect(html).not.toContain('Profile quota exceeded');
  });

  it('disables Thai translation when no source description exists', () => {
    const html = renderToStaticMarkup(
      <CompanyProfileCard
        symbol="RKLB"
        profile={null}
        freshness={unavailableFreshness}
        provider={null}
        error={null}
        loading={false}
        retryAt={0}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain('title="ยังไม่มีข้อความต้นฉบับสำหรับแปล"');
  });

  it('shows fallback price, resolved currency, Thai fallback label, and timestamp once', () => {
    const quote: Quote = {
      symbol: 'RKLB',
      price: 42,
      open: 40,
      high: 43,
      low: 39,
      previousClose: null,
      change: null,
      changePercent: null,
      volume: 1_000,
      latestTradingDay: '2026-07-17',
      currency: null,
    };
    const html = renderToStaticMarkup(
      <StockPriceHeader
        symbol="RKLB"
        exchange="NASDAQ"
        sourceCurrency="USD"
        quote={quote}
        freshness={{
          status: 'end-of-day',
          asOf: '2026-07-17T00:00:00.000Z',
          maxAgeSeconds: 86_400,
        }}
        market={null}
        marketError={null}
        provider="nasdaq"
        providerConfigured
        quoteError={{
          code: 'rate-limited',
          message: 'Quote quota exceeded',
          retryable: true,
        }}
        fallbackLabel="Previous trading day"
        quoteLoading={false}
        quoteRetryAt={0}
        onRetryQuote={vi.fn()}
        fxQuote={null}
        evaluatedAt="2026-07-18T00:00:00.000Z"
      />,
    );

    expect(html).toContain('42.00');
    expect(html).toContain('USD');
    expect(occurrences(html, 'ข้อมูลจากวันซื้อขายก่อนหน้า')).toBe(1);
    expect(html).toMatch(/17.*2569/);
    expect(html).not.toContain('rate-limited');
    expect(html).not.toContain('Quote quota exceeded');
    expect(html).not.toContain('Unavailable');
  });
});
