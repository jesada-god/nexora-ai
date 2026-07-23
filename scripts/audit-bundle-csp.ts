/**
 * Production-bundle CSP audit.
 *
 * Scans the JavaScript chunks that a `next build` actually ships — the files
 * listed in `.next/build-manifest.json` + `.next/app-build-manifest.json`, not
 * whatever a running `next dev` watcher may have scattered into `.next` — for
 * reachable dynamic-code-evaluation constructs (`eval(`, `new Function(`,
 * `Function("…")`, string `setTimeout`/`setInterval`). It is the machine check
 * behind the promise that the strict CSP can keep omitting `'unsafe-eval'`.
 *
 * The guarded global-object shim (`Function("return this")()`) that bundlers
 * emit as an unreachable `||` fallback is allowlisted by the scanner, because it
 * never executes when `globalThis` exists and so can never trip a CSP violation.
 *
 * Exit 0 = clean. Exit 1 = a reachable eval construct was found (or no build).
 *
 * Run: npm run audit:csp   (after `npm run build`)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scanForEvalConstructs, type EvalFinding } from '../src/lib/security/eval-scan.ts';

const NEXT_DIR = resolve(process.cwd(), '.next');

function readManifest(file: string): unknown {
  const path = join(NEXT_DIR, file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Collect every unique `static/**.js` path referenced by the build manifests. */
function collectProductionChunks(): string[] {
  const files = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === 'string' && value.endsWith('.js')) files.add(value);
  };
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    else add(value);
  };

  const build = readManifest('build-manifest.json') as Record<string, unknown> | null;
  if (build) {
    add((build.polyfillFiles as unknown) ?? null);
    walk(build.polyfillFiles);
    walk(build.rootMainFiles);
    walk(build.pages);
    walk(build.lowPriorityFiles);
  }
  walk(readManifest('app-build-manifest.json'));
  return [...files];
}

function main(): void {
  if (!existsSync(NEXT_DIR)) {
    console.error('[csp-audit] no .next build found — run `npm run build` first.');
    process.exit(1);
  }

  const chunks = collectProductionChunks();
  if (chunks.length === 0) {
    console.error('[csp-audit] no chunks found in build manifests — is this a real production build?');
    process.exit(1);
  }

  let scanned = 0;
  let missing = 0;
  const offenders: { file: string; findings: EvalFinding[] }[] = [];

  for (const rel of chunks) {
    const path = join(NEXT_DIR, rel);
    if (!existsSync(path)) {
      missing += 1;
      continue;
    }
    scanned += 1;
    const findings = scanForEvalConstructs(readFileSync(path, 'utf8'));
    if (findings.length > 0) offenders.push({ file: rel, findings });
  }

  console.log(`[csp-audit] scanned ${scanned} production chunk(s)${missing ? ` (${missing} referenced but absent)` : ''}.`);

  if (offenders.length === 0) {
    console.log('[csp-audit] OK — no reachable eval / new Function / string-timer in the shipped bundle.');
    process.exit(0);
  }

  console.error(`[csp-audit] FAIL — ${offenders.length} chunk(s) contain reachable dynamic eval:`);
  for (const { file, findings } of offenders) {
    console.error(`  ${file}`);
    for (const f of findings.slice(0, 5)) {
      console.error(`    ${f.kind} @${f.index}: …${f.context.replace(/\s+/g, ' ')}…`);
    }
    if (findings.length > 5) console.error(`    …and ${findings.length - 5} more`);
  }
  process.exit(1);
}

main();
