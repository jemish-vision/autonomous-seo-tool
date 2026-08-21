/**
 * Escalation-heuristic calibration budget — the backstop for needsJsRendering.ts. No heuristic is
 * right on every framework, so this gain-tests the first SAMPLE_SIZE heuristic-driven escalations
 * (never retry/screenshot-forced ones — those aren't the heuristic's own decision) and kills
 * further heuristic escalation for the rest of THIS crawl once the no-gain rate clears the
 * threshold. This is what catches what the signals miss, on whatever site actually gets crawled.
 */
export const CALIBRATION_SAMPLE_SIZE = 10;
export const CALIBRATION_NO_GAIN_KILL_THRESHOLD = 0.9;

export interface CalibrationStats {
  samplesRecorded: number;
  gainedCount: number;
  killed: boolean;
}

export class EscalationCalibration {
  private samples: boolean[] = [];
  private killed = false;

  /** Call once per gain-tested HEURISTIC escalation (candidate.heuristicEscalation === true).
   * Returns true the moment this call is what tips the budget into "killed". */
  record(gained: boolean): boolean {
    if (this.killed || this.samples.length >= CALIBRATION_SAMPLE_SIZE) return false;
    this.samples.push(gained);
    if (this.samples.length < CALIBRATION_SAMPLE_SIZE) return false;
    const gainedCount = this.samples.filter(Boolean).length;
    const noGainRate = (CALIBRATION_SAMPLE_SIZE - gainedCount) / CALIBRATION_SAMPLE_SIZE;
    if (noGainRate >= CALIBRATION_NO_GAIN_KILL_THRESHOLD) {
      this.killed = true;
      return true;
    }
    return false;
  }

  get isKilled(): boolean {
    return this.killed;
  }

  get stats(): CalibrationStats {
    return {
      samplesRecorded: this.samples.length,
      gainedCount: this.samples.filter(Boolean).length,
      killed: this.killed,
    };
  }
}
