import type { Assessment, Component, Metrics, Rec, Risk, Social } from "./types.ts";
import { FILTERS, MODEL_VERSION, WEIGHTS } from "./config.ts";

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const num = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
// pts === null means "no data": scores 0 and is marked unavailable (missing data is never favourable).
const C = (name: string, max: number, pts: number | null, note: string): Component =>
  ({ name, max, points: pts === null ? 0 : Math.round(pts * max * 10) / 10, available: pts !== null, note });

export function assess(m: Metrics, prev: Metrics | null, now = Date.now(), W = WEIGHTS, F = FILTERS, social: Social | null = null): Assessment {
  const exclusions: string[] = [], redFlags: string[] = [], limitations: string[] = [];
  const age = now - m.observedAt, stale = age > F.maxStaleMs;
  if (stale) exclusions.push(`Data is ${Math.round(age / 60000)} min old (limit ${F.maxStaleMs / 60000} min). Verified fact.`);

  const accel = num(m.volume5m) && num(m.volume1h) && m.volume1h > 0 ? (m.volume5m * 12) / m.volume1h : null;
  const vl = num(m.volume1h) && num(m.liquidityUsd) && m.liquidityUsd > 0 ? m.volume1h / m.liquidityUsd : null;
  const liqDrop = prev && num(prev.liquidityUsd) && num(m.liquidityUsd) && prev.liquidityUsd > 0
    ? (prev.liquidityUsd - m.liquidityUsd) / prev.liquidityUsd : null;
  const wash = vl !== null && vl > F.maxVolToLiq;
  const extreme = num(m.priceChange1h) && m.priceChange1h > F.maxChange1hPct;
  const liqCollapse = liqDrop !== null && liqDrop > F.liqDropPct;

  if (wash) redFlags.push("Volume is very high relative to liquidity - possible artificial activity (suspected, not verified).");
  if (extreme) redFlags.push(`Price already up over ${F.maxChange1hPct}% in 1h - late entry and reversal risk.`);
  if (liqCollapse) redFlags.push(`Liquidity fell ${(liqDrop! * 100).toFixed(0)}% since the last snapshot (verified from our records).`);
  if (num(m.liquidityUsd) && m.liquidityUsd < F.minLiquidityUsd) exclusions.push(`Liquidity $${Math.round(m.liquidityUsd)} is below the $${F.minLiquidityUsd} minimum. Verified fact.`);

  const txns = num(m.buys1h) && num(m.sells1h) ? m.buys1h + m.sells1h : null;
  const partPts = txns === null ? null : txns === 0 ? 0 : clamp(txns / 200) * 0.6 + clamp((m.buys1h! / txns - 0.5) / 0.2) * 0.4;
  const components: Component[] = [
    C("Volume acceleration", W.volume, accel === null ? null : wash ? 0 : clamp((accel - 1) / 2),
      accel === null ? "Volume data missing" : `5m pace is ${accel.toFixed(1)}x the 1h average`),
    C("Participation", W.participation, partPts,
      txns === null ? "Transaction counts missing" : `${txns} transactions in 1h (counts are not unique people)`),
    C("Price momentum", W.momentum, !num(m.priceChange1h) || !num(m.priceChange5m) ? null : extreme ? 0
      : (clamp(m.priceChange1h / 50) * 0.5 + clamp(m.priceChange5m / 10) * 0.5) * (m.priceChange5m > 0 && m.priceChange1h > 0 && accel !== null && accel > 1 ? 1 : 0.5),
      !num(m.priceChange1h) ? "Price change missing" : `1h ${m.priceChange1h}%, 5m ${m.priceChange5m}% (halved unless volume confirms)`),
    C("Liquidity quality", W.liquidity, !num(m.liquidityUsd) ? null : liqCollapse ? 0 : clamp(m.liquidityUsd / 100_000),
      !num(m.liquidityUsd) ? "Liquidity missing" : `$${Math.round(m.liquidityUsd)} reported liquidity (not all of it is tradable at the shown price)`),
    C("Holder distribution", W.holders, null, "No holder data source connected yet - not assessed"),
    C("Token security", W.security, null, "No on-chain security check connected yet - not assessed"),
    C("Market attention", W.attention, social ? clamp(social.recent / 20) * 0.5 + clamp((social.recent / Math.max(social.baselineAvg, 1) - 1) / 3) * 0.5 : null,
      social ? `${social.recent} X posts mentioning the token address in the latest hour vs ~${social.baselineAvg.toFixed(1)}/h before (posts, not people; bots and paid shilling count too)` : "No X data for this token (not fetched or unavailable) - not assessed"),
  ];
  components.filter(c => !c.available).forEach(c => limitations.push(c.note));
  const score = Math.round(components.reduce((s, c) => s + c.points, 0));
  const coverage = components.filter(c => c.available).reduce((s, c) => s + c.max, 0) / components.reduce((s, c) => s + c.max, 0);
  if (!prev) limitations.push("First observation only - no history to confirm a trend.");
  const confidence = stale || !prev ? "Low" : coverage >= 0.85 ? "High" : coverage >= 0.5 ? "Medium" : "Low";

  let rp = 0;
  if (num(m.liquidityUsd)) rp += m.liquidityUsd < F.minLiquidityUsd ? 3 : m.liquidityUsd < F.lowLiquidityUsd ? 2 : 0;
  if (extreme) rp += 2; if (wash) rp += 2; if (liqCollapse) rp += 3; if (stale) rp += 2;
  if (!components[4].available && !components[5].available) rp += 2; // unknown is never "safe"
  const risk: Risk = !num(m.liquidityUsd) || !num(m.priceUsd) ? "INSUFFICIENT DATA"
    : rp >= 6 ? "EXTREME RISK" : rp >= 4 ? "HIGH RISK" : rp >= 2 ? "MODERATE RISK" : "LOWER RELATIVE RISK";

  let recommendation: Rec;
  if (risk === "INSUFFICIENT DATA") recommendation = "INSUFFICIENT DATA";
  else if (exclusions.length || risk === "EXTREME RISK") recommendation = "AVOID";
  else if (risk === "HIGH RISK") recommendation = score >= 60 ? "WAIT FOR CONFIRMATION" : "AVOID";
  else if (score >= 70 && confidence === "High" && risk === "LOWER RELATIVE RISK") recommendation = "POTENTIAL OPPORTUNITY";
  else if (score >= 50 && confidence !== "Low") recommendation = "WAIT FOR CONFIRMATION";
  else recommendation = "WATCH";

  const reasonsFor = components.filter(c => c.available && c.points >= c.max * 0.6).map(c => `${c.name}: ${c.note}`);
  const reasonsAgainst = [...exclusions, ...redFlags];
  const summary = `${recommendation}: score ${score}/100 (${confidence} confidence), ${risk}. ` +
    (reasonsAgainst[0] ?? limitations[0] ?? "No red flags detected from the data available.") + " Research aid only, not financial advice.";
  return { modelVersion: MODEL_VERSION, assessedAt: now, score, components, confidence, risk, exclusions, redFlags, recommendation, reasonsFor, reasonsAgainst, limitations, summary };
}
