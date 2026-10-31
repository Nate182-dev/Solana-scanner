// UNVERIFIED against the live API: written without network access. Check https://docs.dexscreener.com first.
import type { Metrics } from "./types.ts";
const BASE = "https://api.dexscreener.com";
export const isSolAddress = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const n = (x: unknown): number | null => { const v = typeof x === "string" ? Number(x) : x; return typeof v === "number" && Number.isFinite(v) ? v : null; };

export function parsePair(p: any, observedAt: number): (Metrics & { address: string }) | null {
  if (!p || p.chainId !== "solana" || !isSolAddress(p.baseToken?.address ?? "")) return null;
  return { address: p.baseToken.address, observedAt, source: "dexscreener", symbol: String(p.baseToken?.symbol ?? "").slice(0, 24) || null, name: String(p.baseToken?.name ?? "").slice(0, 48) || null, pairCreatedAt: n(p.pairCreatedAt),
    priceUsd: n(p.priceUsd), liquidityUsd: n(p.liquidity?.usd), volume5m: n(p.volume?.m5), volume1h: n(p.volume?.h1),
    buys1h: n(p.txns?.h1?.buys), sells1h: n(p.txns?.h1?.sells), priceChange5m: n(p.priceChange?.m5), priceChange1h: n(p.priceChange?.h1) };
}
export async function fetchJson(url: string, tries = 3, timeoutMs = 8000): Promise<unknown> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw new Error(`HTTP ${r.status} (not retried)`);
      return await r.json();
    } catch (e) { if (i + 1 >= tries || String(e).includes("not retried")) throw e; await new Promise(r => setTimeout(r, 1000 * 2 ** i)); }
  }
}
export async function latestSolanaTokens(): Promise<string[]> {
  const j: any = await fetchJson(`${BASE}/token-profiles/latest/v1`);
  return [...new Set<string>((Array.isArray(j) ? j : []).filter((t: any) => t.chainId === "solana" && isSolAddress(t.tokenAddress)).map((t: any) => t.tokenAddress))];
}
export async function metricsFor(addresses: string[]): Promise<Map<string, Metrics>> {
  const out = new Map<string, Metrics>(); const now = Date.now();
  for (let i = 0; i < addresses.length; i += 30) {
    const j: any = await fetchJson(`${BASE}/latest/dex/tokens/${addresses.slice(i, i + 30).join(",")}`);
    for (const p of j?.pairs ?? []) {
      const m = parsePair(p, now); if (!m) continue;
      const cur = out.get(m.address); // keep the deepest-liquidity pair per token
      if (!cur || (m.liquidityUsd ?? 0) > (cur.liquidityUsd ?? 0)) out.set(m.address, m);
    }
  }
  return out;
}
