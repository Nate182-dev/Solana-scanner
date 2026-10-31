// Every numeric field is null when the provider did NOT supply it. null is never treated as 0.
export interface Metrics {
  observedAt: number; // when WE observed it (ms) - not token creation time
  pairCreatedAt: number | null; // provider-reported creation time, if any
  priceUsd: number | null; liquidityUsd: number | null;
  volume5m: number | null; volume1h: number | null;
  buys1h: number | null; sells1h: number | null;
  priceChange5m: number | null; priceChange1h: number | null;
  source: string;
  symbol?: string | null; name?: string | null; // untrusted text: always escape when displaying
}
export interface Social { recent: number; baselineAvg: number; total: number; observedAt: number; source: "x" }
export interface Security { mintAuthority: string | null; freezeAuthority: string | null; supply: number | null; program: string; extensions: string[]; top1Pct: number | null; top10Pct: number | null; checkedAt: number; source: "solana-rpc" }
export type Risk = "LOWER RELATIVE RISK" | "MODERATE RISK" | "HIGH RISK" | "EXTREME RISK" | "INSUFFICIENT DATA";
export type Rec = "WATCH" | "POTENTIAL OPPORTUNITY" | "WAIT FOR CONFIRMATION" | "AVOID" | "INSUFFICIENT DATA";
export interface Component { name: string; points: number; max: number; available: boolean; note: string }
export interface Assessment {
  modelVersion: string; assessedAt: number; score: number; components: Component[];
  confidence: "High" | "Medium" | "Low"; risk: Risk; exclusions: string[]; redFlags: string[];
  recommendation: Rec; reasonsFor: string[]; reasonsAgainst: string[]; limitations: string[]; summary: string;
}
