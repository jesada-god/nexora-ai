import { describe, expect, it } from 'vitest';
import { newsErrorMessage, newsViewState, shouldRenderNewsImage } from './news-policy';
describe('NewsFeed states', () => {
  it('has distinct configuration, rate-limit, and provider error messages', () => { expect(newsErrorMessage('configuration-required')).toContain('NEWS_API_KEY'); expect(newsErrorMessage('rate-limited')).toContain('โควตา'); expect(newsErrorMessage('provider-unavailable')).toContain('ชั่วคราว'); });
  it('does not render a news image in Data Saver mode', () => { expect(shouldRenderNewsImage(true, 'https://example.com/image.jpg')).toBe(false); expect(shouldRenderNewsImage(false, 'https://example.com/image.jpg')).toBe(true); });
  it('separates empty, configuration, rate-limit, error, and loading states', () => {
    expect(newsViewState(0, true)).toBe('loading'); expect(newsViewState(0, false)).toBe('empty');
    expect(newsViewState(0, false, 'configuration-required')).toBe('configuration-required');
    expect(newsViewState(0, false, 'rate-limited')).toBe('rate-limited');
    expect(newsViewState(0, false, 'provider-unavailable')).toBe('error');
  });
});
