import type { NextRequest } from 'next/server';
import { handleNewsRequest } from '@/src/lib/news/route';

export function GET(request: NextRequest) {
  return handleNewsRequest(request);
}
