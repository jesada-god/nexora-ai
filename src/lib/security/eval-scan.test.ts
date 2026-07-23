import { describe, expect, it } from 'vitest';
import { scanForEvalConstructs, isEvalFree } from './eval-scan';

describe('scanForEvalConstructs', () => {
  it('flags a direct eval call', () => {
    const findings = scanForEvalConstructs('const x = eval("1+1");');
    expect(findings.map((f) => f.kind)).toContain('eval');
  });

  it('flags new Function code generation', () => {
    const findings = scanForEvalConstructs('const f = new Function("a", "return a*2");');
    expect(findings.some((f) => f.kind === 'new-function')).toBe(true);
    // The overlapping function-string match on the same construct is de-duped.
    expect(findings.filter((f) => f.kind === 'function-string')).toHaveLength(0);
  });

  it('flags a bare Function("…") constructor call', () => {
    const findings = scanForEvalConstructs('var g = Function("return 42")();');
    expect(findings.some((f) => f.kind === 'function-string')).toBe(true);
  });

  it('flags string-argument setTimeout / setInterval', () => {
    expect(scanForEvalConstructs('setTimeout("doThing()", 10)').some((f) => f.kind === 'string-timer')).toBe(true);
    expect(scanForEvalConstructs("setInterval('tick()', 10)").some((f) => f.kind === 'string-timer')).toBe(true);
  });

  it('does NOT flag ordinary function-callback timers', () => {
    expect(isEvalFree('setTimeout(() => run(), 10); setInterval(function () {}, 5);')).toBe(true);
  });

  it('allowlists the guarded webpack global-object shim (never executes)', () => {
    const webpackRuntime = 'if("object"==typeof globalThis)return globalThis;try{return this||Function("return this")()}catch(e){}';
    expect(isEvalFree(webpackRuntime)).toBe(true);
  });

  it('allowlists the guarded core-js polyfill shim (nomodule legacy)', () => {
    const corejs = "var g=(typeof globalThis==='object'&&globalThis)||function(){return this}()||Function('return this')();";
    expect(isEvalFree(corejs)).toBe(true);
  });

  it('allowlists the empty-body Function probe (Zod allowsEval / feature detection)', () => {
    // The exact minified shape Zod 4 ships; an empty body cannot generate code.
    expect(isEvalFree('try{return Function(""),!0}catch(e){return!1}')).toBe(true);
    expect(isEvalFree("if(cfg.jitless)return!1;try{return new Function(''),!0}catch(e){return!1}")).toBe(true);
  });

  it('still flags a Function("…") probe that has a NON-empty body (real code-gen)', () => {
    expect(scanForEvalConstructs('Function("return secret")').some((f) => f.kind === 'function-string')).toBe(true);
  });

  it('still flags a NON-guarded Function("return this…") that does real work', () => {
    // A shim variant with extra code is not the exact allowlisted token → flagged.
    const findings = scanForEvalConstructs('Function("return this.secret")()');
    expect(findings.some((f) => f.kind === 'function-string')).toBe(true);
  });

  it('does not false-positive on identifiers containing "eval"', () => {
    expect(isEvalFree('const retrieval = getRetrieval(); medieval();')).toBe(true);
  });
});
