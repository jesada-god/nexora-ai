'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/src/lib/supabase/server';

const settingsSchema = z.object({
  baseCurrency: z.enum(['THB', 'USD']),
  language: z.enum(['th', 'en']),
  priceAlertsEnabled: z.boolean(),
  dailySummaryEnabled: z.boolean(),
  quietHoursEnabled: z.boolean(),
  quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.enum(['Asia/Bangkok', 'UTC', 'America/New_York', 'Europe/London']),
});

export async function saveSettingsAction(formData: FormData): Promise<never> {
  const parsed = settingsSchema.safeParse({
    baseCurrency: formData.get('baseCurrency'),
    language: formData.get('language'),
    priceAlertsEnabled: formData.get('priceAlertsEnabled') === 'on',
    dailySummaryEnabled: formData.get('dailySummaryEnabled') === 'on',
    quietHoursEnabled: formData.get('quietHoursEnabled') === 'on',
    quietHoursStart: formData.get('quietHoursStart'),
    quietHoursEnd: formData.get('quietHoursEnd'),
    timezone: formData.get('timezone'),
  });
  if (!parsed.success) redirect('/settings?error=การตั้งค่าไม่ถูกต้อง');

  const supabase = await createClient();
  if (!supabase) redirect('/auth/configuration-required?next=/settings');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/sign-in?next=/settings&reason=session_expired');
  const { error } = await supabase.from('user_settings').upsert({
    user_id: user.id,
    base_currency: parsed.data.baseCurrency,
    language: parsed.data.language,
    price_alerts_enabled: parsed.data.priceAlertsEnabled,
    daily_summary_enabled: parsed.data.dailySummaryEnabled,
    quiet_hours_enabled: parsed.data.quietHoursEnabled,
    quiet_hours_start: parsed.data.quietHoursStart,
    quiet_hours_end: parsed.data.quietHoursEnd,
    timezone: parsed.data.timezone,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) redirect('/settings?error=ไม่สามารถบันทึกการตั้งค่าได้');
  const { error: portfolioError } = await supabase.rpc('set_portfolio_base_currency', { input_currency: parsed.data.baseCurrency });
  if (portfolioError) redirect('/settings?error=ไม่สามารถบันทึกสกุลเงินของพอร์ตได้');
  redirect('/settings?message=บันทึกการตั้งค่าแล้ว');
}
