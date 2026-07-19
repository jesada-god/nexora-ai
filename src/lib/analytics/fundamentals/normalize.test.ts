import { describe, expect, it } from 'vitest';
import { normalizeFinancialStatements, safeNumber, type RawReport } from './normalize';

function rows(dates: string[], kind: 'income' | 'balance' | 'cash'): RawReport[] {
  return dates.map((fiscalDateEnding, index) => {
    if (kind === 'income') return { fiscalDateEnding, reportedCurrency: 'USD', fiscalPeriod: `Q${index + 1}`, totalRevenue: '1000', operatingIncome: '200', netIncome: '100', interestExpense: '10', dilutedAverageShares: '50', dilutedEPS: String(index + 1) };
    if (kind === 'balance') return { fiscalDateEnding, reportedCurrency: 'USD', cashAndCashEquivalentsAtCarryingValue: '100', shortLongTermDebtTotal: '200', totalAssets: '2000', totalLiabilities: '800' };
    return { fiscalDateEnding, reportedCurrency: 'USD', operatingCashflow: '180', capitalExpenditures: '30', depreciationDepletionAndAmortization: '20', changeInOperatingLiabilities: '15', changeInOperatingAssets: '5', dividendPayoutCommonStock: '-10' };
  });
}
function payload(annual: RawReport[], quarterly: RawReport[]) { return { annualReports: annual, quarterlyReports: quarterly }; }

describe('fundamentals normalization', () => {
  it('treats None, empty, null, NaN and Infinity as unavailable rather than zero', () => {
    for (const value of ['None', '-', '', null, undefined, 'NaN', 'Infinity']) expect(safeNumber(value)).toBeNull();
    expect(safeNumber('1,234.5')).toBe(1234.5);
  });
  it('separates and orders annual/quarterly periods and calculates diluted EPS TTM only from four complete quarters', () => {
    const annualDates = ['2024-12-31', '2023-12-31']; const quarterDates = ['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31'];
    const result = normalizeFinancialStatements('xyz', payload(rows(annualDates, 'income'), rows(quarterDates, 'income')), payload(rows(annualDates, 'balance'), rows(quarterDates, 'balance')), payload(rows(annualDates, 'cash'), rows(quarterDates, 'cash')), { source: 'test', fetchedAt: '2025-01-01T00:00:00.000Z' });
    expect(result.annual.map((row) => row.periodEnd)).toEqual(['2023-12-31', '2024-12-31']);
    expect(result.quarterly).toHaveLength(4); expect(result.dilutedEpsTtm).toBe(10);
    expect(result.quarterlyRecords[0]).toMatchObject({ frequency: 'quarterly', source: 'test', currency: 'USD' });
  });
  it('detects duplicate periods, incomplete aligned statements and currency mismatch', () => {
    const dates = ['2024-12-31']; const duplicateIncome = [...rows(dates, 'income'), ...rows(dates, 'income')];
    const balance = rows(dates, 'balance'); balance[0].reportedCurrency = 'EUR';
    const result = normalizeFinancialStatements('XYZ', payload(duplicateIncome, []), payload(balance, []), payload([], []));
    expect(result.annual).toHaveLength(0);
    expect(result.missingInputs.some((value) => value.includes('duplicate:income-statement'))).toBe(true);
    expect(result.missingInputs).toContain('annual:2024-12-31:alignedStatements');
    expect(result.missingInputs).toContain('annual:2024-12-31:currency');
  });
});

