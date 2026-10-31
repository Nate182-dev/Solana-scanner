// Read-only on-chain checks through a standard Solana RPC server. Method names/shapes are from the public Solana RPC docs;
// NOT yet run against a live server (no network here). Token-2022 extension names below should be verified against the docs.
import { isSolAddress } from "./dexscreener.ts";
import type { Security } from "./types.ts";
export interface Rpc { call(method: string, params: unknown[]): Promise<any> }
export const RPC_URL_DEFAULT = "https://api.mainnet-beta.solana.com"; // public and often rate-limited: a free Helius/other key works better

export function rpcClient(url = process.env.SOLANA_RPC_URL || RPC_URL_DEFAULT, f: typeof fetch = fetch): Rpc {
  return { async call(method, params) {
    const r = await f(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`RPC HTTP ${r.status}`); // status only: the URL may contain a secret key
    const j: any = await r.json();
    if (j.error) throw new Error(`RPC error ${j.error.code}`);
    return j.result;
  } };
}
export function parseMint(res: any) {
  const v = res?.value, info = v?.data?.parsed?.info;
  if (!v || v.data?.parsed?.type !== "mint" || !info) throw new Error("not a token mint account");
  return { mintAuthority: (info.mintAuthority ?? null) as string | null, freezeAuthority: (info.freezeAuthority ?? null) as string | null,
    supply: Number(info.supply), program: String(v.data.program ?? "unknown"), extensions: Array.isArray(info.extensions) ? info.extensions.map((e: any) => String(e.extension)) : [] };
}
export function parseLargest(res: any, supply: number) {
  const a = res?.value;
  if (!Array.isArray(a) || !(supply > 0)) throw new Error("unexpected holders response");
  const amts = a.map((x: any) => Number(x.amount)).filter(Number.isFinite).sort((p: number, q: number) => q - p);
  const pct = (n: number) => Math.round(amts.slice(0, n).reduce((s: number, v: number) => s + v, 0) / supply * 1000) / 10;
  return { top1Pct: pct(1), top10Pct: pct(10) };
}
export async function checkToken(rpc: Rpc, address: string, now = Date.now()): Promise<Security> {
  if (!isSolAddress(address)) throw new Error("invalid address");
  const m = parseMint(await rpc.call("getAccountInfo", [address, { encoding: "jsonParsed" }]));
  const h = parseLargest(await rpc.call("getTokenLargestAccounts", [address]), m.supply);
  return { ...m, ...h, checkedAt: now, source: "solana-rpc" };
}
