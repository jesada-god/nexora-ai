export type AlertCondition = 'above' | 'below' | 'percent_change_up' | 'percent_change_down';

export interface PriceAlert {
  id: string;
  symbol: string;
  condition: AlertCondition;
  targetValue: number;
  enabled: boolean;
  cooldownMinutes: number;
  lastEvaluatedAt: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  priceAlertId: string | null;
  type: 'price_alert' | 'system';
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export type AlertActionResult = { ok: true; alert?: PriceAlert } | { ok: false; code: string; message: string };

