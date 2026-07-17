export const DATA_FRESHNESS_VALUES = [
  'live',
  'delayed',
  'cached',
  'stale',
  'demo',
  'unavailable',
] as const;

export type DataFreshness = (typeof DATA_FRESHNESS_VALUES)[number];

export interface ApiError {
  code: string;
  message: string;
  status?: number;
  retryable: boolean;
  details?: Readonly<Record<string, string>>;
}

export interface DataEnvelope<T> {
  data: T | null;
  freshness: DataFreshness;
  updatedAt: string | null;
  error?: ApiError;
}

export function createUnavailableError(message = 'ไม่สามารถโหลดข้อมูลได้ในขณะนี้'): ApiError {
  return {
    code: 'DATA_UNAVAILABLE',
    message,
    retryable: true,
  };
}
