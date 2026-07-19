import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./SimulatorWorkspace.tsx', import.meta.url), 'utf8');
const validationSource = readFileSync(new URL('../../lib/options-simulator/validation.ts', import.meta.url), 'utf8');
const bottomNavSource = readFileSync(new URL('../layout/BottomNav.tsx', import.meta.url), 'utf8');
const workerSource = readFileSync(new URL('../../workers/optionsMonteCarlo.worker.ts', import.meta.url), 'utf8');

describe('Options Portfolio Simulator copy', () => {
  it('shows the requested beginner-friendly Thai copy', () => {
    expect(source).toContain('จำลองและวิเคราะห์เท่านั้น ไม่มีการส่งคำสั่งซื้อขายจริง');
    expect(source).toContain('เลือกหุ้นหรือ ETF');
    expect(source).toContain('ข้อมูลสัญญา');
    expect(source).toContain('Monte Carlo Simulation');
    expect(source).toContain('แบบจำลองของฉัน');
    expect(validationSource).toContain('Strike Price ต้องมากกว่า 0');
  });

  it('keeps enum values separate from their display labels', () => {
    expect(source).toContain("options={['call', 'put']}");
    expect(source).toContain("options={['buy', 'sell']}");
    expect(source).toContain("optionLabels={{ call: 'Call', put: 'Put' }}");
  });

  it('does not render legacy cash, stock, fee or exercise controls', () => {
    expect(source).not.toContain('title="เงินสดในพอร์ต"');
    expect(source).not.toContain('title="จำนวนหุ้น"');
    expect(source).not.toContain('title="Fees"');
    expect(source).not.toContain('title="Exercise Style"');
    expect(source).not.toContain('title="Position"');
    expect(source).toContain('title="Side"');
  });

  it('separates contract editing from the What-If and Monte Carlo workspaces', () => {
    expect(source).toContain('data-testid="option-legs-form"');
    expect(source).toContain('data-testid="contract-summary"');
    expect(source).toContain('data-testid="what-if-controls"');
    expect(source).toContain('data-testid="monte-carlo-controls"');
    expect(source).toContain("key === 'What-If' ? 'What-If Analysis'");
    expect(source).toContain("key === 'Monte Carlo' ? 'Monte Carlo Simulation'");
    expect(source).toContain('แก้ไขข้อมูลสัญญา');
    expect(source).toContain("tab === 'Inputs' &&");
    expect(source).not.toContain("tab === 'What-If' && <section");
    expect(source).not.toContain("tab === 'Monte Carlo' && <section");
  });

  it('limits What-If to price, date and IV and clamps the target date', () => {
    expect(source).toContain('Target Stock Price');
    expect(source).toContain('title="Target Date"');
    expect(source).toContain('title="IV (%)"');
    expect(source).toContain('min={minimumTargetDate}');
    expect(source).toContain('max={earliestExpiration}');
    expect(source).toContain('clampTargetDate(event.target.value');
    expect(source).toContain('ข้อมูลสัญญามีการเปลี่ยนแปลง กรุณาคำนวณใหม่');
  });

  it('derives Monte Carlo contract inputs and rejects stale worker results', () => {
    expect(source).toContain('Premium Paid');
    expect(source).toContain('Days to Expiration');
    expect(source).toContain('const targetDte =');
    expect(source).toContain('horizonDays: targetDte');
    expect(source).toContain('runId !== workerRunId.current');
    expect(source).toContain('Start Simulation');
    expect(source).toContain('BASIC_PATH_OPTIONS.map');
    expect(source).toContain('ใช้แสดง sensitivity ของทั้งสถานะเท่านั้น ไม่ใช้สร้าง GBM paths');
    expect(source).not.toContain('>Advanced Settings<');
    expect(source).toContain('progress.toLocaleString()} / {workspace.monteCarlo.paths.toLocaleString()');
    expect(source).toContain('worker.current?.terminate()');
  });

  it('keeps numeric drafts as strings and commits finite values on blur', () => {
    expect(source).toContain("const [draft, setDraft] = useState");
    expect(source).toContain('parseFiniteDraft(draft)');
    expect(source).toContain('onBlur={commit}');
    expect(source).toContain("if (value === 0) event.currentTarget.select()");
  });

  it('keeps Manual Greeks separate from pricing and worker settings', () => {
    expect(source).toContain('ค่าประมาณจาก Delta (ทั้งสถานะ)');
    expect(source).toContain('Delta เป็นข้อมูลเปรียบเทียบเท่านั้น');
    expect(source).toContain("source === 'manual' ? 'Manual' : 'Model Estimate'");
    expect(source).toContain('instance.postMessage({ workspace: scoped, comparisonWorkspace: workspace, settings, targetPrice:');
    expect(source).not.toContain('settings: { ...settings, delta');
  });

  it('uses the new responsive leg cards and currency/percentage inputs', () => {
    expect(source).toContain('sm:grid-cols-2 lg:grid-cols-4');
    expect(source).toContain('lg:max-w-[50%]');
    expect(source).toContain('เพิ่ม Option Leg');
    expect(source).toContain('function PremiumInput');
    expect(source).toContain('parsePremiumPaste');
    expect(source).toContain('function PercentInput');
    expect(source).toContain('percentVolatilityToEngine(value)');
  });

  it('renders validation warnings only for real validation errors and focuses the first field', () => {
    expect(source).toContain('validationErrors.length > 0 && <section role="alert" data-testid="validation-warning"');
    expect(source).toContain('validationErrors.map(displayValidationMessage)');
    expect(source).toContain('focusFirstValidationField(issues)');
    expect(source).toContain("document.querySelectorAll<HTMLElement>('[data-validation-path]')");
    expect(source).toContain('validationPath={`legs.${index}.entryPremium`}');
    expect(source).not.toContain('!contractReady');
    expect(source).not.toContain('disabled={running || !contractReady}');
  });

  it('uses calculation-only validation and reports development paths without values', () => {
    expect(source).toContain('calculationValidationMessages(analysisWorkspace())');
    expect(source).toContain("console.debug('[Options Simulator validation]'");
    expect(source).toContain('return { path, unit: validationPathUnit(path) };');
    expect(source).not.toContain('return { path, value');
  });

  it('shows distinct target-touch and terminal-close probabilities', () => {
    expect(source).toContain('Touch Target');
    expect(source).toContain('Close ≥ Target');
    expect(source).toContain('Close < Target');
    expect(source).toContain('เคยแตะหรือผ่าน Target ระหว่างทาง');
    expect(source).toContain('ราคาหุ้นปลายทาง ณ Target Date');
    expect(source).toContain('ผลลัพธ์เป็นความน่าจะเป็นจากสมมติฐาน ไม่ใช่การทำนายราคาที่แน่นอน');
  });

  it('localizes Result labels while preserving standard options terms', () => {
    expect(source).toContain('มูลค่าสถานะปัจจุบัน (Current Value)');
    expect(source).toContain('มูลค่าสถานะหลังจำลอง (Simulated Value)');
    expect(source).toContain('เปลี่ยนแปลงจากมูลค่าปัจจุบัน (Change from Current)');
    expect(source).toContain('กำไร/ขาดทุนรวมหลังจำลอง (Projected P&L)');
    expect(source).toContain('กำไร/ขาดทุน (%)');
    expect(source).toContain('จุดคุ้มทุนต่อหุ้น (Break-even)');
    expect(source).toContain('กำไรสูงสุด (Max Profit)');
    expect(source).toContain('ขาดทุนสูงสุด (Max Loss)');
    expect(source).toContain('ผลกระทบจากราคา (Price Impact)');
    expect(source).toContain('ผลกระทบจาก Time Decay');
    expect(source).toContain('ผลกระทบจาก IV');
    expect(source).toContain('โอกาสทำกำไร (POP)');
    expect(source).toContain('โอกาสจบแบบ ITM');
    expect(source).toContain('กำไร/ขาดทุนคาดหวัง (Expected P&L)');
    expect(source).toContain('ค่ากลางของกำไร/ขาดทุน (Median P&L)');
    expect(source).not.toContain('มูลค่าคาดหวัง (Expected Value)');
    expect(source).not.toContain('Expected Value ติดลบ');
    expect(source.match(/amount=\{result\.expectedProfitLoss\}/g)).toHaveLength(2);
  });

  it('groups Monte Carlo metrics and explains the beginner distinctions', () => {
    expect(source).toContain('testId="monte-carlo-group-summary"');
    expect(source).toContain('testId="monte-carlo-group-target"');
    expect(source).toContain('testId="monte-carlo-group-risk"');
    expect(source).toContain('data-testid="monte-carlo-group-charts"');
    expect(source).toContain('POP = จำนวน valid paths ที่ P&L > 0 หลังหักต้นทุนและค่าธรรมเนียม');
    expect(source).toContain('ITM ไม่เท่ากับกำไร');
    expect(source).toContain('title="P5"');
    expect(source).toContain('title="P50"');
    expect(source).toContain('title="P95"');
    expect(source).toContain('title="VaR 95% (P&L)"');
    expect(source).toContain('title="Expected Shortfall 95% (P&L)"');
    expect(source).not.toContain('กำไร · กำไร/ขาดทุน (%)');
  });

  it('shows the complete beginner summary from all valid paths', () => {
    expect(source).toContain('สรุปแบบมือใหม่');
    expect(source).toContain('จาก valid paths ทั้งหมด');
    expect(source).toContain('title="ขาดทุนสูงสุด"');
    expect(source).toContain('title="POP"');
    expect(source).toContain('title="Expected P&L"');
    expect(source).toContain('title="Median P&L"');
    expect(source).toContain('title="P5"');
    expect(source).toContain('title="VaR 95%"');
    expect(source).toContain('title="Expected Shortfall 95%"');
  });

  it('renders the audited Call/Put score, top reasons and required disclaimer', () => {
    expect(source).toContain('data-testid="call-put-scenario-score"');
    expect(source).toContain('น้ำหนักสถานการณ์ขาขึ้น (Call)');
    expect(source).toContain('น้ำหนักสถานการณ์ขาลง (Put)');
    expect(source).toContain('เป็นคะแนนเปรียบเทียบจากสมมติฐาน ไม่ใช่คำแนะนำซื้อขายหรือความน่าจะเป็นว่าหุ้นจะขึ้น/ลง');
    expect(source).toContain('เหตุผลที่ส่งผลต่อคะแนนมากที่สุด');
    expect(source).toContain('มุมมองยังไม่ชัดเจน');
    expect(source).toContain('ข้อมูลไม่พอสำหรับเปรียบเทียบ');
  });

  it('uses deterministic accessible histograms with audited markers and dated sample paths', () => {
    expect(source).toContain('<BarChart');
    expect(source).toContain('<Bar dataKey="count"');
    expect(source).toContain('Terminal Stock Price Distribution (USD)');
    expect(source).toContain('ราคาหุ้นปลายทาง (USD)');
    expect(source).toContain("value: 'จำนวน paths'");
    expect(source).toContain("label: 'Current Price'");
    expect(source).toContain('label: `Strike L${index + 1}`');
    expect(source).toContain("? 'Break-even' : `Break-even ${index + 1}`");
    expect(source).toContain("label: 'Target'");
    expect(source).toContain('title={reference.description}');
    expect(source).toContain('isAnimationActive={false}');
    expect(source).toContain('แสดงตัวอย่าง {shownPaths.length.toLocaleString()} จาก {validPaths.toLocaleString()} paths');
    expect(source).toContain('dataKey="date"');
    expect(source).toContain("value: 'วัน/วันที่'");
    expect(source).not.toContain('Math.random');
    expect(source).not.toContain('function MiniDistribution');
  });

  it('keeps chart audit fields transient and preserves the persisted result contract', () => {
    expect(source).toContain('function monteCarloSnapshot');
    expect(source).toContain('delete snapshot.validPaths');
    expect(source).toContain('delete snapshot.discardedPaths');
    expect(source).toContain('delete snapshot.terminalPriceHistogram');
    expect(source).toContain('monteCarlo: monteCarloSnapshot(event.data.result');
    expect(source).toContain('const [callPutScore, setCallPutScore]');
    expect(source).not.toMatch(/resultSnapshot:[^\n]+callPutScore/);
    expect(source).not.toMatch(/resultSnapshot:[^\n]+scenarioScore/);
    expect(workerSource).toContain('const { terminalPrices, ...result } = auditResult');
    expect(workerSource).toContain('self.postMessage({ result, scenarioScore })');
  });

  it('discloses every Monte Carlo assumption and fee treatment', () => {
    expect(source).toContain('data-testid="monte-carlo-assumptions"');
    expect(source).toContain('สมมติฐานที่ใช้');
    expect(source).toContain('Geometric Brownian Motion (GBM)');
    expect(source).toContain('Paths / Seed');
    expect(source).toContain('Current Price');
    expect(source).toContain('Target Date / Days');
    expect(source).toContain('IV / Drift');
    expect(source).toContain('Rate / Dividend');
    expect(source).toContain('Quantity');
    expect(source).toContain('Multiplier');
    expect(source).toContain('รวมใน P&amp;L แล้ว');
    expect(source).toContain('rate แสดงเพื่อ audit แต่ไม่ถูกนำไปสร้าง paths');
  });

  it('keeps USD results as source of truth and toggles display currency without rerunning either engine', () => {
    expect(source).toContain('fetchFxRate()');
    expect(source).toContain('data-testid="result-currency-control"');
    expect(source).toContain("disabled={item === 'THB' && !thbAvailable}");
    expect(source).toContain('onClick={() => onCurrencyChange(item)}');
    expect(source).toContain('ผลคำนวณ USD เป็น source of truth');
    expect(source).toContain('ไม่รัน pricing หรือ Monte Carlo ใหม่');
    expect(source).toContain('const analysisWorkspaceValue = useMemo');
    expect(source).toContain('const sensitivity = useMemo');
    expect(source).toContain('const summaryLegs = useMemo');
    expect(source).toContain('const whatIfCalculation = useMemo');
    expect(source).toContain('const breakEvens = useMemo');
    expect(source).toContain("fxQuote?.stale ? 'stale'");
    expect(source).toContain('1 USD = {Number(fxQuote.rate).toFixed(2)} THB');
    expect(source).toContain('new Date(fxQuote.asOf).toLocaleString');
    expect(source).toContain('function CallPutScenarioScoreCard({ score }');
    expect(source).not.toContain('function CallPutScenarioScoreCard({ score, currency }');
  });

  it('renders accessible signed P&L cards and a mobile-safe result summary', () => {
    expect(source).toContain('data-testid="result-summary"');
    expect(source).toContain('role="status" aria-label=');
    expect(source).toContain('profitLossToneClass(state)');
    expect(source).toContain('formatSignedPercent(percentage)');
    expect(source).toContain('grid grid-cols-1 gap-3 sm:grid-cols-2');
    expect(source).toContain('min-w-0 rounded-xl');
    expect(source).toContain('คำนวณ % ไม่ได้');
  });

  it('groups What-If results and gives every value a beginner explanation', () => {
    expect(source).toContain('testId="result-group-key-summary"');
    expect(source).toContain('testId="result-group-position-value"');
    expect(source).toContain('testId="result-group-maximum-risk"');
    expect(source).toContain('testId="result-group-estimate-details"');
    expect(source).toContain('สรุปผลสำคัญ');
    expect(source).toContain('มูลค่าสถานะ');
    expect(source).toContain('ความเสี่ยงสูงสุด');
    expect(source).toContain('รายละเอียดการประมาณ');
    expect(source).toContain('ดูคำอธิบาย');
    expect(source).toContain('buildProfitLossSummary(');
  });

  it('hides formulas in a calculation disclosure and reports reconciliation', () => {
    expect(source).toContain('<summary');
    expect(source).toContain('วิธีคำนวณ');
    expect(source).toContain('data-testid="reconciliation-status"');
    expect(source).toContain('auditResultReconciliation({');
    expect(source).toContain('priceImpact: afterPrice.theoreticalValue - current.theoreticalValue');
    expect(source).toContain('timeImpact: afterTime.theoreticalValue - afterPrice.theoreticalValue');
    expect(source).toContain('ivImpact: valuation.theoreticalValue - afterTime.theoreticalValue');
    expect(source).toContain('ผลกระทบอื่น (Other Impact)');
    expect(source).toContain('Price Impact + Time Decay + IV Impact + Other Impact');
    expect(source).toContain('Delta เป็นข้อมูลเปรียบเทียบเท่านั้น');
  });

  it('shows Delta as a position sensitivity with an explicit unit and never adds it to impacts', () => {
    expect(source).toContain('ค่าประมาณจาก Delta (ทั้งสถานะ)');
    expect(source).toContain('Delta (ทั้งสถานะ)');
    expect(source).toContain('Delta ต่อหุ้น');
    expect(source).toContain('ต่อราคาหุ้นเปลี่ยน $1 USD');
    expect(source).toContain('deltaEstimate: sensitivity.delta');
    expect(source).not.toContain('sensitivity.delta.toFixed(4)');
    expect(source).not.toContain('resolved.delta.toFixed(4)');
    expect(source).not.toContain('deltaApproximation');
    expect(source).not.toContain('ผลกระทบจาก Theta (ประมาณ)');
  });

  it('shows accessible save states, disables both actions, and supports retry feedback', () => {
    expect(source).toContain("useState<SaveFeedbackStatus | 'Offline draft'>('Unsaved')");
    expect(source).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(source).toContain("saveStatus === 'Saving'");
    expect(source).toContain("saveStatus === 'Saved'");
    expect(source).toContain("saveStatus === 'Failed'");
    expect(source).toContain('disabled={isSaving}');
    expect(source).toContain('ลองบันทึกอีกครั้ง');
    expect(source).toContain('motion-reduce:animate-none');
    expect(source).toContain("addToast({ title: 'บันทึกไม่สำเร็จ'");
    expect(source).toContain("saveStatus !== 'Unsaved'");
  });

  it('keeps Calculate visible at 320px and moves the desktop action to the form end', () => {
    expect(source).toContain('data-testid="mobile-calculate-action"');
    expect(source).toContain('md:hidden');
    expect(source).toContain('className="min-h-11 w-full"');
    expect(source).toContain('data-testid="desktop-calculate-action"');
    expect(source).toContain('hidden justify-end md:flex');
    expect(source).not.toContain('md:left-auto md:right-6');
  });

  it('positions the sticky mobile action above bottom navigation and reserves content space', () => {
    expect(bottomNavSource).toContain('h-16');
    expect(bottomNavSource).toContain('z-50');
    expect(source).toContain('bottom-[calc(4rem+env(safe-area-inset-bottom))]');
    expect(source).toContain('z-40');
    expect(source).toContain('pb-[calc(9rem+env(safe-area-inset-bottom))]');
    expect(source).toContain('mobile-calculate-disabled-reason');
    expect(source).toContain('aria-describedby={calculateDisabledReason');
  });
});
