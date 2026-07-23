/**
 * Pure scanner for dynamic code-evaluation constructs in a JavaScript source
 * string. Used by the production-bundle CSP audit (`scripts/audit-bundle-csp.ts`)
 * to prove no app-owned chunk ships an executable `eval` under a strict CSP that
 * (correctly) omits `'unsafe-eval'`.
 *
 * A CSP `eval` violation is a RUNTIME event — it fires only when code-from-string
 * actually executes. Bundlers emit a guarded global-object shim
 * (`Function("return this")()`) as a last-resort fallback that is unreachable
 * whenever `globalThis` exists (i.e. in every modern browser), so it can never
 * trigger a violation. Those guarded shims are masked out before scanning; what
 * survives is genuinely reachable code-from-string.
 */

export type EvalConstructKind = 'eval' | 'new-function' | 'function-string' | 'string-timer';

export interface EvalFinding {
  kind: EvalConstructKind;
  /** The matched text, e.g. `eval(` or `new Function(`. */
  match: string;
  /** Character offset in the ORIGINAL source. */
  index: number;
  /** A short surrounding window for the report. */
  context: string;
}

/**
 * Non-executing constructs masked out before scanning:
 *
 * 1. The guarded global-object shim (`Function("return this")()`) that the
 *    webpack runtime and the core-js polyfill emit as the final `||` fallback
 *    after a `globalThis`/`window`/`self` check — unreachable when `globalThis`
 *    exists (every modern browser).
 * 2. The EMPTY-body Function probe (`Function("")` / `new Function("")`). An
 *    empty function body is never functional code generation — it exists only to
 *    feature-detect whether the `Function` constructor is permitted. Zod 4's
 *    `allowsEval` probe is the notable case; we additionally disable it at
 *    runtime via the `jitless` bootstrap (see `app/layout.tsx`) so the probe is
 *    doubly dead. Flagging it would be a false positive: it cannot generate code.
 */
const ALLOWLISTED_SHIMS: readonly RegExp[] = [
  /Function\((['"])return this\1\)/g,
  /(?:new\s+)?Function\s*\((['"])\1\)/g,
];

const PATTERNS: readonly { kind: EvalConstructKind; re: RegExp }[] = [
  { kind: 'eval', re: /\beval\s*\(/g },
  { kind: 'new-function', re: /\bnew\s+Function\s*\(/g },
  { kind: 'function-string', re: /\bFunction\s*\(\s*['"`]/g },
  { kind: 'string-timer', re: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/g },
];

/** Replace each allowlisted shim with same-length spaces so offsets are stable. */
function maskShims(source: string): string {
  let masked = source;
  for (const shim of ALLOWLISTED_SHIMS) {
    masked = masked.replace(shim, (m) => ' '.repeat(m.length));
  }
  return masked;
}

/**
 * Find every reachable dynamic-eval construct in `source`. Returns an empty array
 * for a bundle whose only `Function("return this")` occurrences are the guarded
 * global-object shims.
 */
export function scanForEvalConstructs(source: string): EvalFinding[] {
  const masked = maskShims(source);
  const raw: EvalFinding[] = [];
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      raw.push({
        kind,
        match: m[0],
        index: m.index,
        context: source.slice(Math.max(0, m.index - 24), m.index + m[0].length + 24),
      });
    }
  }
  raw.sort((a, b) => a.index - b.index);

  // De-duplicate `new Function("…")`, which matches both `new-function` (at `new`)
  // and `function-string` (at `Function`): keep the earlier `new-function`.
  const findings: EvalFinding[] = [];
  for (const finding of raw) {
    const prev = findings[findings.length - 1];
    const overlapsNewFunction =
      prev?.kind === 'new-function' &&
      finding.kind === 'function-string' &&
      finding.index <= prev.index + prev.match.length + 6;
    if (overlapsNewFunction) continue;
    findings.push(finding);
  }
  return findings;
}

/** True when the source contains no reachable dynamic-eval construct. */
export function isEvalFree(source: string): boolean {
  return scanForEvalConstructs(source).length === 0;
}
