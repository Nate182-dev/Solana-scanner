// UNVERIFIED against the live X API (written without network or a key). X has no free read tier: you pay per request. See README.
import { isSolAddress } from "./dexscreener.ts";
import type { Social } from "./types.ts";
export interface XClient { counts(address: string, now?: number): Promise<Social> }

export function parseCounts(j: any, now: number): Social {
  const d = j?.data;
  if (!Array.isArray(d) || d.length < 3 || d.some((b: any) => typeof b?.tweet_count !== "number")) throw new Error("unexpected X counts response");
  const c = d.map((b: any) => b.tweet_count as number), recent = c[c.length - 1], prior = c.slice(0, -1); // last bucket is the (partial) current hour
  return { recent, baselineAvg: prior.reduce((s: number, v: number) => s + v, 0) / prior.length, total: c.reduce((s: number, v: number) => s + v, 0), observedAt: now, source: "x" };
}
export function xClient(bearer = process.env.X_BEARER_TOKEN, f: typeof fetch = fetch): XClient | null {
  if (!bearer) return null;
  return { async counts(address, now = Date.now()) {
    if (!isSolAddress(address)) throw new Error("invalid address"); // never put unvalidated text into a search query
    const q = encodeURIComponent(`${address} -is:retweet`), start = new Date(now - 24 * 3600_000).toISOString();
    const r = await f(`https://api.x.com/2/tweets/counts/recent?query=${q}&granularity=hour&start_time=${start}`, { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`X HTTP ${r.status}`); // status only: no headers or secrets in errors
    return parseCounts(await r.json(), now);
  } };
}
// Hard daily cap on paid calls so a bug or a busy market can't run up a bill.
export class DailyBudget {
  private day = ""; private used = 0; private max: number;
  constructor(max: number) { this.max = max; }
  take(now = Date.now()) { const d = new Date(now).toISOString().slice(0, 10); if (d !== this.day) { this.day = d; this.used = 0; } if (this.used >= this.max) return false; this.used++; return true; }
}
