/// <reference lib="webworker" />
import { runMonteCarlo } from '@/src/lib/options-simulator/monte-carlo';
import { calculateCallPutScenarioScore } from '@/src/lib/options-simulator/scenario-score';
import type { MonteCarloSettings, SimulationWorkspace } from '@/src/lib/options-simulator/types';

self.onmessage = (event: MessageEvent<{ workspace: SimulationWorkspace; comparisonWorkspace: SimulationWorkspace; settings: MonteCarloSettings; targetPrice: number }>) => {
  try {
    const auditResult = runMonteCarlo(event.data.workspace, event.data.settings, {
      targetPrice: event.data.targetPrice,
      onProgress: (completed, total) => self.postMessage({ progress: { completed, total } }),
    });
    const { terminalPrices, ...result } = auditResult;
    const scenarioScore = calculateCallPutScenarioScore(
      event.data.comparisonWorkspace,
      event.data.settings,
      terminalPrices,
      event.data.targetPrice,
    );
    self.postMessage({ result, scenarioScore });
  }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Simulation failed' }); }
};
export {};
