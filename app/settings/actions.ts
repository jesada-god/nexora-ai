'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/src/lib/supabase/server';

const settingsSchema = z.object({
  baseCurrency: z.enum(['THB', 'USD']),
  language: z.enum(['th', 'en']),
  priceAlertsEnabled: z.boolean(),
  dailySummaryEnabled: z.boolean(),
});

export async function saveSettingsAction(formData: FormData): Promise<never> {
  const parsed = settingsSchema.safeParse({
    baseCurrency: formData.get('baseCurrency'),
    language: formData.get('language'),
    priceAlertsEnabled: formData.get('priceAlertsEnabled') === 'on',
    dailySummaryEnabled: formData.get('dailySummaryEnabled') === 'on',
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
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) redirect('/settings?error=ไม่สามารถบันทึกการตั้งค่าได้');
  const { error: portfolioError } = await supabase.rpc('set_portfolio_base_currency', { input_currency: parsed.data.baseCurrency });
  if (portfolioError) redirect('/settings?error=ไม่สามารถบันทึกสกุลเงินของพอร์ตได้');
  redirect('/settings?message=บันทึกการตั้งค่าแล้ว');
}
