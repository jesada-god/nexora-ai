import { describe, expect, it } from 'vitest';
import { bucketOverlapsRegularSession, classifyUsEquitySession, previousCompletedUsSession, zonedLocalToUtc } from './session';

const H = (hour: number, minute = 0) => hour * 60 + minute;

describe('bucketOverlapsRegularSession — regular-session bucket filtering', () => {
  it('keeps a multi-hour bucket that starts before 09:30 but overlaps the open', () => {
    // A provider-native 4h bucket 08:00–12:00 overlaps [09:30, 16:00): keep it.
    expect(bucketOverlapsRegularSession(H(8), 240)).toBe(true);
    // A 1h bucket 09:00–10:00 straddles the open: keep it.
    expect(bucketOverlapsRegularSession(H(9), 60)).toBe(true);
    // A 2h bucket 08:00–10:00 straddles the open: keep it.
    expect(bucketOverlapsRegularSession(H(8), 120)).toBe(true);
    // A regular bucket fully inside the session.
    expect(bucketOverlapsRegularSession(H(12), 240)).toBe(true); // 12:00–16:00
  });

  it('excludes buckets that lie entirely outside the regular session', () => {
    expect(bucketOverlapsRegularSession(H(4), 240)).toBe(false);  // 04:00–08:00 premarket
    expect(bucketOverlapsRegularSession(H(5), 60)).toBe(false);   // 05:00–06:00 premarket
    expect(bucketOverlapsRegularSession(H(16), 240)).toBe(false); // 16:00–20:00 after-hours
    expect(bucketOverlapsRegularSession(H(17), 60)).toBe(false);  // 17:00–18:00 after-hours
  });

  it('treats a bucket that only touches a boundary as non-overlapping (half-open)', () => {
    expect(bucketOverlapsRegularSession(H(8, 30), 60)).toBe(false); // 08:30–09:30 ends at open
    expect(bucketOverlapsRegularSession(H(9), 30)).toBe(false);     // 09:00–09:30 ends at open
    expect(bucketOverlapsRegularSession(H(16), 60)).toBe(false);    // 16:00–17:00 starts at close
  });
});

describe('market session correctness', () => {
  it('converts New York wall time across DST without using the client timezone', () => {
    expect(zonedLocalToUtc('2026-03-06 09:30:00', 'America/New_York')).toBe('2026-03-06T14:30:00.000Z');
    expect(zonedLocalToUtc('2026-03-09 09:30:00', 'America/New_York')).toBe('2026-03-09T13:30:00.000Z');
  });

  it('classifies regular and extended sessions in exchange time', () => {
    expect(classifyUsEquitySession('2026-07-20T13:00:00.000Z')).toBe('premarket');
    expect(classifyUsEquitySession('2026-07-20T14:00:00.000Z')).toBe('regular');
    expect(classifyUsEquitySession('2026-07-20T21:00:00.000Z')).toBe('afterhours');
  });

  it('returns the previous completed weekday and honors verified holidays', () => {
    expect(previousCompletedUsSession(new Date('2026-07-20T13:00:00.000Z'))).toBe('2026-07-17');
    expect(previousCompletedUsSession(new Date('2026-07-20T21:00:00.000Z'))).toBe('2026-07-20');
    expect(previousCompletedUsSession(new Date('2026-07-20T21:00:00.000Z'), new Set(['2026-07-20']))).toBe('2026-07-17');
  });
});
