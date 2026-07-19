import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./SimulatorWorkspace.tsx', import.meta.url), 'utf8');
const validationSource = readFileSync(new URL('../../lib/options-simulator/validation.ts', import.meta.url), 'utf8');

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
    expect(source).toContain('ใช้แสดง sensitivity เท่านั้น ไม่ใช้สร้าง GBM paths');
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
    expect(source).toContain('Delta Impact (ประมาณ)');
    expect(source).toContain('ไม่เปลี่ยน Estimated Premium');
    expect(source).toContain("source === 'manual' ? 'Manual' : 'Model Estimate'");
    expect(source).toContain('instance.postMessage({ workspace: scoped, settings, targetPrice:');
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

  it('shows distinct target-touch and terminal-close probabilities', () => {
    expect(source).toContain('Probability of Reaching Target by Date');
    expect(source).toContain('Probability of Closing Above Target');
    expect(source).toContain('Probability of Closing Below Target');
    expect(source).toContain('ผลลัพธ์เป็นความน่าจะเป็นจากสมมติฐาน ไม่ใช่การทำนายราคาที่แน่นอน');
  });
});
