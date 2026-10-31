import type { Db } from "./db.ts";
import type { Metrics } from "./types.ts";
const envNum = (k: string, d: number) => { const v = Number(process.env[k]); return process.env[k] && Number.isFinite(v) && v > 0 ? v : d; };
const wins = (process.env.PAPER_WINDOWS_MIN ?? "5,15,30,60,360,1440").split(",").map(Number).filter(n => Number.isFinite(n) && n > 0);
// Hypothetical-cost model. Rough estimate, not a real quote: constant-product pool, price impact ~ 2*trade/liquidity per side.
export const PAPER = { windowsMin: wins.length ? wins : [5, 15, 30, 60, 360, 1440], tradeUsd: envNum("PAPER_TRADE_USD", 100), feePctPerSide: envNum("PAPER_FEE_PCT", 0.25), minExitLiquidityUsd: 10_000 };
export type PaperCfg = typeof PAPER;
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export interface Pred { id: number; address: string; kind: string; discovered_at: number; price_usd: number | null; liquidity_usd: number | null;
  score: number; risk: string; recommendation: string; confidence: string; model_version: string }
export interface WinRes { minutes: number; status: "pending" | "ok" | "unavailable"; price?: number; liquidityUsd?: number | null; grossPct?: number; netPct?: number | null; assumedTotalLoss?: boolean }

export function evaluate(p: Pred, snaps: Metrics[], now: number, P: PaperCfg = PAPER) {
  const end = p.discovered_at + Math.max(...P.windowsMin) * 60_000;
  const fwd = snaps.filter(s => s.observedAt > p.discovered_at).sort((a, b) => a.observedAt - b.observedAt);
  const windows: WinRes[] = P.windowsMin.map(min => {
    const target = p.discovered_at + min * 60_000;
    if (now < target) return { minutes: min, status: "pending" as const };
    const s = fwd.find(x => x.observedAt >= target);   // first real observation at/after the target: never interpolated
    if (!s || s.observedAt - target > Math.max(5 * 60_000, 0.25 * min * 60_000) || !num(s.priceUsd) || !num(p.price_usd) || p.price_usd <= 0) return { minutes: min, status: "unavailable" as const };
    const grossPct = (s.priceUsd / p.price_usd - 1) * 100;
    if (!num(s.liquidityUsd) || s.liquidityUsd < P.minExitLiquidityUsd)   // failed exit is counted as a total loss, never dropped
      return { minutes: min, status: "ok" as const, price: s.priceUsd, liquidityUsd: s.liquidityUsd ?? null, grossPct, netPct: -100, assumedTotalLoss: true };
    const impact = num(p.liquidity_usd) && p.liquidity_usd > 0 ? (2 * P.tradeUsd / p.liquidity_usd + 2 * P.tradeUsd / s.liquidityUsd) * 100 : null;
    return { minutes: min, status: "ok" as const, price: s.priceUsd, liquidityUsd: s.liquidityUsd, grossPct, netPct: impact === null ? null : grossPct - impact - 2 * P.feePctPerSide };
  });
  const priced = fwd.filter(s => s.observedAt <= end && num(s.priceUsd));
  let maxReturnPct: number | null = null, maxDrawdownPct: number | null = null;
  if (num(p.price_usd) && p.price_usd > 0 && priced.length) {
    let peak = p.price_usd, max = p.price_usd, worst = 0;
    for (const s of priced) { const v = s.priceUsd as number; max = Math.max(max, v); peak = Math.max(peak, v); worst = Math.max(worst, (peak - v) / peak); }
    maxReturnPct = (max / p.price_usd - 1) * 100; maxDrawdownPct = worst * 100;
  }
  const lastLiq = fwd.filter(s => s.observedAt <= end && num(s.liquidityUsd)).at(-1)?.liquidityUsd;
  const liquidityChangePct = num(lastLiq) && num(p.liquidity_usd) && p.liquidity_usd > 0 ? (lastLiq / p.liquidity_usd - 1) * 100 : null;
  return { windows, maxReturnPct, maxDrawdownPct, liquidityChangePct, observations: priced.length, fullyMatured: now >= end };
}
export const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export function wilson(k: number, n: number): [number, number] | null {
  if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.round((c - w) / d * 1000) / 10, Math.round((c + w) / d * 1000) / 10];
}
type Row = { p: Pred; ev: ReturnType<typeof evaluate> };
function summarize(rows: Row[], P: PaperCfg) {
  const mat = rows.filter(r => r.ev.fullyMatured), ref = P.windowsMin.find(w => w >= 60);
  const prop = (k: number) => ({ k, n: mat.length, ci: wilson(k, mat.length) });
  const touched = (x: number) => mat.filter(r => (r.ev.maxReturnPct ?? -Infinity) >= x).length;
  const retained = ref === undefined ? null : mat.filter(r => (r.ev.maxReturnPct ?? -Infinity) >= 50 && (r.ev.windows.find(w => w.minutes === ref)?.netPct ?? -1) > 0).length;
  return { n: rows.length, withData: rows.filter(r => r.ev.observations > 0).length,
    windows: P.windowsMin.map((minutes, i) => { const ws = rows.map(r => r.ev.windows[i]), ok = ws.filter(w => w.status === "ok");
      return { minutes, matured: ok.length, pending: ws.filter(w => w.status === "pending").length, unavailable: ws.filter(w => w.status === "unavailable").length,
        medianGrossPct: median(ok.map(w => w.grossPct!)), medianNetPct: median(ok.filter(w => num(w.netPct)).map(w => w.netPct!)), assumedTotalLosses: ok.filter(w => w.assumedTotalLoss).length }; }),
    milestones: { matured: mat.length, touched50: prop(touched(50)), touched100: prop(touched(100)), retained: retained === null ? null : prop(retained) },
    medianMaxReturnPct: median(rows.map(r => r.ev.maxReturnPct).filter(num)), medianMaxDrawdownPct: median(rows.map(r => r.ev.maxDrawdownPct).filter(num)) };
}
export function report(db: Db, now = Date.now(), P: PaperCfg = PAPER) {
  const preds = db.prepare("SELECT * FROM predictions ORDER BY discovered_at DESC LIMIT 300").all() as unknown as Pred[];
  const q = db.prepare("SELECT data FROM snapshots WHERE address=? AND observed_at>? ORDER BY observed_at");
  const rows: Row[] = preds.map(p => ({ p, ev: evaluate(p, (q.all(p.address, p.discovered_at) as any[]).map(r => JSON.parse(r.data)), now, P) }));
  const group = (f: (p: Pred) => string) => Object.entries(rows.reduce((m: Record<string, Row[]>, r) => ((m[f(r.p)] ??= []).push(r), m), {})).map(([label, rs]) => ({ label, ...summarize(rs, P) }));
  const band = (s: number) => s < 25 ? "score 0-24" : s < 50 ? "score 25-49" : s < 75 ? "score 50-74" : "score 75-100";
  const overall = summarize(rows, P);
  const caveats = ["Hypothetical only: no trades were or will be made.",
    `Costs are a rough estimate: $${P.tradeUsd} trade, ${P.feePctPerSide}% fee per side, price impact from pool size. If liquidity under $${P.minExitLiquidityUsd} remains at a check time, the exit is counted as a total loss.`,
    "A 'discovery' call is made when this scanner first saw the token, which can be long after launch. An 'alert' call is made when a new-candidate alert fired.",
    "A missing price is shown as missing, never as zero or filled in. Calls still pending are excluded from results."];
  if (overall.milestones.matured < 30) caveats.push(`Only ${overall.milestones.matured} calls have a full ${Math.max(...P.windowsMin)}-minute record: too few to conclude anything about predictive value.`);
  return { generatedAt: now, caveats, overall, byKind: group(p => p.kind), byScore: group(p => band(p.score)), byRisk: group(p => p.risk), byRecommendation: group(p => p.recommendation),
    recent: rows.slice(0, 25).map(r => ({ address: r.p.address, kind: r.p.kind, discoveredAt: r.p.discovered_at, score: r.p.score, risk: r.p.risk, recommendation: r.p.recommendation,
      confidence: r.p.confidence, modelVersion: r.p.model_version, priceAtDiscovery: r.p.price_usd, ...r.ev })) };
}
