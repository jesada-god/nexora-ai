import { z } from 'zod';

export const newsArticleSchema = z.object({
  id: z.string(), title: z.string().min(1), source: z.string().min(1),
  publishedAt: z.iso.datetime(), url: z.url(), imageUrl: z.url().nullable(),
  symbols: z.array(z.string()),
});
export const newsPageSchema = z.object({ articles: z.array(newsArticleSchema), nextCursor: z.string().nullable() });
export type NewsArticle = z.infer<typeof newsArticleSchema>;
export type NewsPage = z.infer<typeof newsPageSchema>;
export interface NewsProvider {
  readonly id: string;
  getMarketNews(cursor?: string): Promise<NewsPage>;
  getSymbolNews(symbol: string, cursor?: string): Promise<NewsPage>;
}
