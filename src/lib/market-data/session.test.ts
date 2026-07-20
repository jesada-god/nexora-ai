import { describe, expect, it } from 'vitest';
import { classifyUsEquitySession, previousCompletedUsSession, zonedLocalToUtc } from './session';

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
