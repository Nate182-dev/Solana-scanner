import type { Db } from "./db.ts";
import { activeAddresses, ACTIVE_MS, isWatched, markDelivered, openPredictionAddresses, prevAssessment, prevSnapshot, recordAlertIfFresh, recordPrediction, recordAssessment, recordSnapshot, setProvider } from "./db.ts";
import { assess } from "./analysis.ts";
import { ALERTS, FILTERS, WEIGHTS } from "./config.ts";
import { PAPER } from "./paper.ts";
import { candidateOk, evaluate } from "./alerts.ts";
import type { AlertCfg } from "./alerts.ts";
import type { Notifier } from "./notify.ts";
import { latestSolanaTokens, metricsFor } from "./dexscreener.ts";
import type { DailyBudget, XClient } from "./x.ts";
import type { Metrics, Social } from "./types.ts";

export interface Provider { latest(): Promise<string[]>; metrics(a: string[]): Promise<Map<string, Metrics>> }
export const dexProvider: Provider = { latest: latestSolanaTokens, metrics: metricsFor };
export interface ScanOpts { notify?: Notifier | null; x?: XClient | null; budget?: DailyBudget; cfg?: AlertCfg; xCacheMs?: number }
const caches = new WeakMap<Db, Map<string, { s: Social; at: number }>>();

export async function scanOnce(db: Db, p: Provider, now = Date.now(), o: ScanOpts = {}) {
  const cfg = o.cfg ?? ALERTS, cacheMs = o.xCacheMs ?? 15 * 60_000;
  const cache = caches.get(db) ?? caches.set(db, new Map()).get(db)!;
  try {
    const addrs = [...new Set([...(await p.latest()), ...openPredictionAddresses(db, now - (Math.max(...PAPER.windowsMin) + 60) * 60_000), ...activeAddresses(db, now - ACTIVE_MS)])].slice(0, 120);
    const found = await p.metrics(addrs);
    for (const [address, m] of found) {
      const prev = prevSnapshot(db, address), prevA = prevAssessment(db, address), watched = isWatched(db, address);
      let a = assess(m, prev, now);
      // Cost control: only promising tokens trigger a paid X lookup, results are cached, and a daily cap applies.
      if (o.x && candidateOk(a, m, cfg)) {
        let hit = cache.get(address); if (hit && now - hit.at > cacheMs) hit = undefined;
        if (!hit && (o.budget?.take(now) ?? true)) {
          try { hit = { s: await o.x.counts(address, now), at: now }; cache.set(address, hit); setProvider(db, "x", true, now); }
          catch (e) { setProvider(db, "x", false, now, String(e)); }
        }
        if (hit) a = assess(m, prev, now, WEIGHTS, FILTERS, hit.s);
      }
      recordSnapshot(db, address, m); recordAssessment(db, address, a);
      if (!prev) recordPrediction(db, address, "discovery", m, a, now); // every token, including AVOID: failures stay in the record
      for (const al of evaluate({ address, a, m }, prev && prevA ? { a: prevA, m: prev } : null, watched, cfg)) {
        const id = recordAlertIfFresh(db, address, al.type, now, al.message, cfg.cooldownMs);
        if (id !== null && al.type === "new_candidate") recordPrediction(db, address, "alert", m, a, now);
        if (id !== null && o.notify && await o.notify(al.message)) markDelivered(db, id);
      }
    }
    setProvider(db, "dexscreener", true, now);
    return { ok: true as const, requested: addrs.length, recorded: found.size };
  } catch (e) { setProvider(db, "dexscreener", false, now, String(e)); return { ok: false as const, error: String(e) }; }
}
