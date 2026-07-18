export interface ScrollTarget {
  isConnected?: boolean;
  scrollIntoView(options?: ScrollIntoViewOptions): void;
}

export function safeScrollIntoView(target: ScrollTarget | null | undefined): boolean {
  if (!target || target.isConnected === false) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}

export function normalizeSymbolInput(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9.^-]/g, '').slice(0, 20);
}
