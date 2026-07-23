import { describe, expect, it } from 'vitest';
import {
  BANGKOK_TIME_ZONE,
  THAI_LOCALE,
  formatBangkokDateTime,
  formatMarketDataAsOf,
  formatThaiDateOnly,
} from './datetime';

describe('shared Stock Detail date/time presentation', () => {
  it('pins Thai locale and Bangkok time zone independently of the host', () => {
    expect(THAI_LOCALE).toBe('th-TH');
    expect(BANGKOK_TIME_ZONE).toBe('Asia/Bangkok');
    const original = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const server = formatBangkokDateTime('2026-07-20T04:00:00.000Z');
      process.env.TZ = 'America/New_York';
      const client = formatBangkokDateTime('2026-07-20T04:00:00.000Z');
      expect(client).toBe(server);
      expect(client).toContain('11:00');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('renders a live intraday timestamp with HH:mm:ss when seconds are requested', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      expect(formatBangkokDateTime('2026-07-20T04:00:05.000Z')).toContain('11:00');
      expect(formatBangkokDateTime('2026-07-20T04:00:05.000Z')).not.toContain('11:00:05');
      const withSeconds = formatBangkokDateTime('2026-07-20T04:00:05.000Z', { withSeconds: true });
      expect(withSeconds).toContain('11:00:05');
      expect(formatMarketDataAsOf('2026-07-20T04:00:05.000Z', { withSeconds: true })).toContain('11:00:05');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('ignores seconds for a date-only provider value even when requested', () => {
    const label = formatMarketDataAsOf('2026-07-17', { withSeconds: true });
    expect(label).toBe('ข้อมูล ณ 17 ก.ค. 2569');
    expect(label).not.toContain(':');
  });

  it('renders date-only provider values as a date without a fabricated midnight', () => {
    expect(formatThaiDateOnly('2026-07-17')).toBe('17 ก.ค. 2569');
    const label = formatMarketDataAsOf('2026-07-17T00:00:00.000Z', {
      dateOnly: true,
    });
    expect(label).toBe('ข้อมูล ณ 17 ก.ค. 2569');
    expect(label).not.toContain('00:00');
  });
});
