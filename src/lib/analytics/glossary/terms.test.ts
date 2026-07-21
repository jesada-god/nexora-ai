import { describe, expect, it } from 'vitest';
import { GLOSSARY, getGlossaryTerm, type GlossaryTermId } from './terms';

const ids = Object.keys(GLOSSARY) as GlossaryTermId[];

describe('analytics glossary', () => {
  it('gives every term a non-empty beginner-Thai label and all three explanation fields', () => {
    for (const id of ids) {
      const term = getGlossaryTerm(id);
      for (const field of ['label', 'helper', 'what', 'why', 'when'] as const) {
        expect(term[field].trim().length, `${id}.${field}`).toBeGreaterThan(0);
      }
      // The beginner explanations must be Thai (labels/helpers may be pure tokens).
      for (const field of ['what', 'why', 'when'] as const) {
        expect(/[฀-๿]/.test(term[field]), `${id}.${field} is Thai`).toBe(true);
      }
    }
  });

  it('exposes the beginner labels the spec calls for, keeping abbreviations where relevant', () => {
    expect(GLOSSARY.support.label).toBe('แนวรับ');
    expect(GLOSSARY.resistance.label).toBe('แนวต้าน');
    expect(GLOSSARY.confluence.label).toBe('จุดที่หลายสัญญาณมาซ้อนกัน');
    expect(GLOSSARY.poc.label).toContain('POC');
    expect(GLOSSARY.vah.label).toContain('VAH');
    expect(GLOSSARY.val.label).toContain('VAL');
    expect(GLOSSARY.avwap.label).toContain('AVWAP');
    expect(GLOSSARY.callWall.label).toContain('Call Wall');
    expect(GLOSSARY.putWall.label).toContain('Put Wall');
    expect(GLOSSARY.maxPain.label).toContain('Max Pain');
  });

  it('keeps the truthful data-status tokens and states plainly that data is NOT real-time', () => {
    // The data-labels term must keep the truthful status tokens.
    for (const token of ['DELAYED', 'END-OF-DAY', 'CACHED', 'STALE', 'UNAVAILABLE']) {
      expect(GLOSSARY.dataLabels.what).toContain(token);
    }
    // Real-time may only appear as a negation ("ไม่มีข้อมูลเรียลไทม์"), never a claim.
    expect(GLOSSARY.dataLabels.why).toContain('ไม่มีข้อมูลเรียลไทม์');
  });
});
