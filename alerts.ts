import type { Assessment, Metrics, Risk } from "./types.ts";
export type AlertType = "new_candidate" | "volume_surge" | "score_improved" | "risk_worse" | "liquidity_drop" | "suspicious_activity";
export interface AlertCfg { minScore: number; minLiquidityUsd: number; maxRisk: Risk; minConfidence: "High" | "Medium" | "Low";
  cooldownMs: number; volumeAccel: number; scoreJump: number; liqChangePct: number }
const RISKS: Risk[] = ["LOWER RELATIVE RISK", "MODERATE RISK", "HIGH RISK", "EXTREME RISK", "INSUFFICIENT DATA"];
const CONF = ["Low", "Medium", "High"];
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function candidateOk(a: Assessment, m: Metrics, c: AlertCfg) {
  return a.exclusions.length === 0 && a.risk !== "INSUFFICIENT DATA" && RISKS.indexOf(a.risk) <= RISKS.indexOf(c.maxRisk) && a.score >= c.minScore
    && (m.liquidityUsd ?? 0) >= c.minLiquidityUsd && CONF.indexOf(a.confidence) >= CONF.indexOf(c.minConfidence);
}
type Snap = { a: Assessment; m: Metrics };
// Opportunity alerts need a passing candidate. Warning alerts only fire for tokens we already alerted on ("watched"), to limit noise.
export function evaluate(cur: Snap & { address: string }, prev: Snap | null, watched: boolean, c: AlertCfg): { type: AlertType; message: string }[] {
  const { a, m, address } = cur, out: { type: AlertType; message: string }[] = [];
  const tail = ` Score ${a.score}/100, ${a.risk}, ${a.confidence} confidence. Research aid only, not advice.`;
  const name = `${m.symbol || "unnamed"} (${address.slice(0, 4)}...${address.slice(-4)})`;
  const add = (type: AlertType, text: string) => out.push({ type, message: `${name}: ${text}${tail}` });
  const ok = candidateOk(a, m, c);
  const accel = isNum(m.volume5m) && isNum(m.volume1h) && m.volume1h > 0 ? (m.volume5m * 12) / m.volume1h : null;
  if (ok && !watched) add("new_candidate", "new candidate passed your filters.");
  if (ok && accel !== null && accel >= c.volumeAccel) add("volume_surge", `volume pace is ${accel.toFixed(1)}x its hourly average.`);
  if (ok && prev && a.score - prev.a.score >= c.scoreJump) add("score_improved", `score rose ${a.score - prev.a.score} points.`);
  if (watched && prev) {
    if (a.risk !== "INSUFFICIENT DATA" && RISKS.indexOf(a.risk) > RISKS.indexOf(prev.a.risk)) add("risk_worse", `risk rating worsened from ${prev.a.risk}.`);
    const p = prev.m.liquidityUsd, l = m.liquidityUsd;
    if (isNum(p) && isNum(l) && p > 0 && (p - l) / p >= c.liqChangePct) add("liquidity_drop", `liquidity fell ${Math.round(((p - l) / p) * 100)}%.`);
  }
  if (watched && a.redFlags.some(f => f.includes("artificial"))) add("suspicious_activity", "volume looks unusually high for its liquidity (suspected, not verified).");
  return out;
}
