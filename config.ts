export const MODEL_VERSION = "0.1.0";
// Weights follow the spec (total 100). Configurable: pass your own object to assess().
export const WEIGHTS = { volume: 20, participation: 15, momentum: 15, liquidity: 15, holders: 10, security: 15, attention: 10 };
// Conservative starting points, NOT universal truths. Tune them using paper-performance results.
export const FILTERS = { minLiquidityUsd: 10_000, lowLiquidityUsd: 25_000, maxStaleMs: 5 * 60_000, maxChange1hPct: 500, maxVolToLiq: 20, liqDropPct: 0.3, excludeActiveMint: true, excludeActiveFreeze: true };

import type { AlertCfg } from "./alerts.ts";
const e = (k: string, d: number) => { const v = process.env[k]; return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d; };
const pick = <T extends string>(v: string | undefined, ok: T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
// Conservative defaults, set with environment variables (see README). Stricter = fewer, later, more reliable alerts.
export const ALERTS: AlertCfg = {
  minScore: e("ALERT_MIN_SCORE", 50), minLiquidityUsd: e("ALERT_MIN_LIQUIDITY", 25_000),
  maxRisk: pick(process.env.ALERT_MAX_RISK, ["LOWER RELATIVE RISK", "MODERATE RISK", "HIGH RISK"], "MODERATE RISK"),
  minConfidence: pick(process.env.ALERT_MIN_CONFIDENCE, ["Low", "Medium", "High"], "Medium"),
  cooldownMs: e("ALERT_COOLDOWN_MIN", 60) * 60_000, volumeAccel: e("ALERT_VOLUME_ACCEL", 3), scoreJump: e("ALERT_SCORE_JUMP", 15), liqChangePct: e("ALERT_LIQ_CHANGE", 0.3) };
