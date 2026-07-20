import { describe, expect, it } from 'vitest';
import { newsErrorMessage, newsViewState, shouldRenderNewsImage } from './news-policy';
describe('NewsFeed states', () => {
  it('has distinct configuration, rate-limit, and provider error messages', () => { expect(newsErrorMessage('NEWS_PROVIDER_NOT_CONFIGURED')).toContain('ยังไม่ได้ตั้งค่า'); expect(newsErrorMessage('NEWS_PROVIDER_RATE_LIMITED')).toContain('จำกัดจำนวนคำขอ'); expect(newsErrorMessage('NEWS_PROVIDER_UPSTREAM_FAILURE')).toContain('ชั่วคราว'); });
  it('does not render a news image in Data Saver mode', () => { expect(shouldRenderNewsImage(true, 'https://example.com/image.jpg')).toBe(false); expect(shouldRenderNewsImage(false, 'https://example.com/image.jpg')).toBe(true); });
  it('separates empty, configuration, rate-limit, error, and loading states', () => {
    expect(newsViewState(0, true)).toBe('loading'); expect(newsViewState(0, false)).toBe('empty');
    expect(newsViewState(0, false, 'NEWS_PROVIDER_NOT_CONFIGURED')).toBe('configuration-required');
    expect(newsViewState(0, false, 'NEWS_PROVIDER_RATE_LIMITED')).toBe('rate-limited');
    expect(newsViewState(0, false, 'NEWS_PROVIDER_UPSTREAM_FAILURE')).toBe('error');
  });
});
