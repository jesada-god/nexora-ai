import { describe, expect, it } from 'vitest';
import { isQuietHour } from './quiet-hours';

describe('push quiet hours', () => {
  const bangkokNoon = new Date('2026-07-18T05:00:00.000Z');
  const bangkokLate = new Date('2026-07-18T16:30:00.000Z');
  it('supports quiet windows that cross midnight', () => {
    expect(isQuietHour(bangkokLate, 'Asia/Bangkok', '22:00', '07:00')).toBe(true);
    expect(isQuietHour(bangkokNoon, 'Asia/Bangkok', '22:00', '07:00')).toBe(false);
  });
  it('supports same-day windows and treats equal endpoints as all day', () => {
    expect(isQuietHour(bangkokNoon, 'Asia/Bangkok', '11:00', '13:00')).toBe(true);
    expect(isQuietHour(bangkokNoon, 'Asia/Bangkok', '08:00', '08:00')).toBe(true);
  });
  it('fails open for an invalid timezone so notifications are not stuck forever', () => {
    expect(isQuietHour(bangkokNoon, 'Not/AZone', '00:00', '23:59')).toBe(false);
  });
});
