import { z } from 'zod';

const numericString = z.string();

export const alphaVantageSearchResponseSchema = z.object({
  bestMatches: z.array(z.object({
    '1. symbol': z.string(),
    '2. name': z.string(),
    '3. type': z.string(),
    '4. region': z.string(),
    '5. marketOpen': z.string().optional(),
    '6. marketClose': z.string().optional(),
    '7. timezone': z.string().optional(),
    '8. currency': z.string().optional(),
    '9. matchScore': numericString.optional(),
  })).default([]),
});

export const alphaVantageQuoteResponseSchema = z.object({
  'Global Quote': z.object({
    '01. symbol': z.string(),
    '02. open': numericString.optional(),
    '03. high': numericString.optional(),
    '04. low': numericString.optional(),
    '05. price': numericString,
    '06. volume': numericString.optional(),
    '07. latest trading day': z.string().optional(),
    '08. previous close': numericString.optional(),
    '09. change': numericString.optional(),
    '10. change percent': z.string().optional(),
  }),
});

export const alphaVantageHistoryResponseSchema = z.object({
  'Meta Data': z.object({
    '2. Symbol': z.string().optional(),
    '3. Last Refreshed': z.string().optional(),
  }).optional(),
  'Time Series (Daily)': z.record(z.string(), z.object({
    '1. open': numericString,
    '2. high': numericString,
    '3. low': numericString,
    '4. close': numericString,
    '5. volume': numericString.optional(),
  })),
});

export const alphaVantageProfileResponseSchema = z.object({
  Symbol: z.string(),
  Name: z.string(),
  Description: z.string().optional(),
  Exchange: z.string().optional(),
  Currency: z.string().optional(),
  Country: z.string().optional(),
  Sector: z.string().optional(),
  Industry: z.string().optional(),
  Address: z.string().optional(),
  OfficialSite: z.string().optional(),
  MarketCapitalization: z.string().optional(),
  FullTimeEmployees: z.string().optional(),
  FiscalYearEnd: z.string().optional(),
  LatestQuarter: z.string().optional(),
});

export const alphaVantageMarketStatusResponseSchema = z.object({
  markets: z.array(z.object({
    market_type: z.string(),
    region: z.string(),
    primary_exchanges: z.string().optional(),
    local_open: z.string().optional(),
    local_close: z.string().optional(),
    current_status: z.string().optional(),
    notes: z.string().optional(),
  })),
});
