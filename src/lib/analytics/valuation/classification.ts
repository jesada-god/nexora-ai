import type { ClassificationResult, FinancialPeriod, ModelId } from './types';

export function classifyCompany(sector: string, industry: string, periods: readonly FinancialPeriod[]): ClassificationResult {
  const latest = periods.at(-1); const previous = periods.at(-2); const labels: ClassificationResult['classification'] = []; const evidence: string[] = [];
  const lower = `${sector} ${industry}`.toLowerCase();
  if (/bank|insurance|financial/.test(lower)) { labels.push('financial-institution'); evidence.push(`Sector/industry indicates financial institution: ${sector}/${industry}`); }
  if (/reit|real estate investment trust/.test(lower)) { labels.push('reit'); evidence.push(`Industry indicates REIT: ${industry}`); }
  if (/energy|materials|mining|oil|gas|commodity/.test(lower)) { labels.push('commodity-sensitive'); evidence.push(`Sector/industry is commodity-sensitive: ${sector}/${industry}`); }
  if (latest) {
    if (latest.netIncome <= 0) { labels.push('loss-making'); evidence.push('Latest normalized net income is non-positive'); }
    else if (previous && latest.revenue > previous.revenue && latest.freeCashFlow > 0) { labels.push('profitable-growth'); evidence.push('Revenue grew while net income and FCF remained positive'); }
    if (latest.dividendsPaid != null && latest.dividendsPaid < 0 && periods.filter((p) => p.dividendsPaid != null && p.dividendsPaid < 0).length >= Math.min(3, periods.length)) { labels.push('mature-dividend-paying'); evidence.push('Verified multi-period dividend payments are present'); }
    if (latest.totalAssets > latest.revenue * 2) { labels.push('asset-heavy'); evidence.push('Assets exceed two times annual revenue'); }
    if (latest.netIncome <= 0 && latest.revenue > 0 && previous && latest.revenue > previous.revenue * 1.15) { labels.push('early-stage-high-growth'); evidence.push('Revenue growth exceeds 15% while earnings remain non-positive'); }
  }
  if (!labels.length) { labels.push('cyclical'); evidence.push('Insufficient stable-pattern evidence; classification remains conservative'); }
  const eligible = new Set<ModelId>(); const excluded: ClassificationResult['excludedModels'] = [];
  if (latest?.freeCashFlow && latest.freeCashFlow > 0 && periods.length >= 3) eligible.add('fcff-dcf'); else excluded.push({ model: 'fcff-dcf', reason: 'ต้องมี FCF ที่เป็นบวกและงบการเงินอย่างน้อย 3 งวด' });
  if (latest?.operatingCashFlow && periods.length >= 3 && !labels.includes('financial-institution')) eligible.add('fcfe'); else excluded.push({ model: 'fcfe', reason: 'โครงสร้าง equity cash flow/debt ไม่ครบหรือไม่เหมาะสม' });
  if (labels.includes('mature-dividend-paying')) eligible.add('ddm'); else excluded.push({ model: 'ddm', reason: 'ไม่มีประวัติเงินปันผลที่สม่ำเสมอเพียงพอ' });
  excluded.push({ model: 'relative', reason: 'ยังไม่มี peer set จาก sector/industry ที่ตรวจสอบได้' });
  if (labels.includes('asset-heavy') || labels.includes('financial-institution') || labels.includes('reit')) eligible.add('asset-based'); else excluded.push({ model: 'asset-based', reason: 'ลักษณะบริษัทไม่เหมาะกับ asset-based valuation' });
  return { classification: [...new Set(labels)], evidence, eligibleModels: [...eligible], excludedModels: excluded };
}
