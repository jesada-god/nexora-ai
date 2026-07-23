import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the Zod-4 JIT CSP fix (zod #4461 / #5414).
 *
 * Zod 4's `allowsEval` probe calls `Function("")` to feature-detect eval, which
 * trips a CSP `eval` violation on strict-CSP pages (no `'unsafe-eval'`). The root
 * layout MUST ship a synchronous inline bootstrap that sets
 * `globalThis.__zod_globalConfig.jitless = true` BEFORE the app bundle evaluates,
 * so the probe short-circuits. If someone deletes that bootstrap the DevTools
 * "eval blocked" Issue comes back — this test fails first.
 */
describe('root layout Zod jitless bootstrap', () => {
  const source = readFileSync(resolve(process.cwd(), 'app/layout.tsx'), 'utf8');

  it('pre-populates the Zod global config with jitless=true', () => {
    expect(source).toContain('__zod_globalConfig');
    expect(source).toMatch(/jitless\s*=\s*true/);
  });

  it('delivers it as an inline script (runs during HTML parse, before the bundle)', () => {
    expect(source).toMatch(/<script[^>]*dangerouslySetInnerHTML/);
  });
});
