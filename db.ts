import { DatabaseSync } from "node:sqlite"; // built into Node 22: no install needed
import type { Assessment, Metrics } from "./types.ts";

export function openDb(path = process.env.DB_PATH ?? "scanner.db") {
  const db = new DatabaseSync(path);
  db.exec(`
  CREATE TABLE IF NOT EXISTS tokens(address TEXT PRIMARY KEY, first_seen INTEGER NOT NULL, pair_created_at INTEGER);
  CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, observed_at INTEGER NOT NULL, data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS snap_addr ON snapshots(address, id);
  CREATE TABLE IF NOT EXISTS assessments(id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, assessed_at INTEGER NOT NULL, data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS asmt_addr ON assessments(address, id);
  CREATE TABLE IF NOT EXISTS provider_status(name TEXT PRIMARY KEY, last_ok INTEGER, last_error TEXT, last_error_at INTEGER);
  CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, type TEXT NOT NULL, created_at INTEGER NOT NULL, message TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS alert_addr ON alerts(address, type, created_at);
  CREATE TABLE IF NOT EXISTS predictions(id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, kind TEXT NOT NULL, discovered_at INTEGER NOT NULL, price_usd REAL, liquidity_usd REAL,
    score INTEGER NOT NULL, risk TEXT NOT NULL, recommendation TEXT NOT NULL, confidence TEXT NOT NULL, model_version TEXT NOT NULL, UNIQUE(address, kind));`);
  return db;
}
export type Db = ReturnType<typeof openDb>;

export function prevSnapshot(db: Db, address: string): Metrics | null {
  const r: any = db.prepare("SELECT data FROM snapshots WHERE address=? ORDER BY id DESC LIMIT 1").get(address);
  return r ? JSON.parse(r.data) : null;
}
export function recordSnapshot(db: Db, address: string, m: Metrics) {
  // first_seen is when OUR scanner first saw the token; INSERT OR IGNORE keeps the original value forever.
  db.prepare("INSERT OR IGNORE INTO tokens(address,first_seen,pair_created_at) VALUES(?,?,?)").run(address, m.observedAt, m.pairCreatedAt ?? null);
  db.prepare("INSERT INTO snapshots(address,observed_at,data) VALUES(?,?,?)").run(address, m.observedAt, JSON.stringify(m));
}
export function recordAssessment(db: Db, address: string, a: Assessment) {
  db.prepare("INSERT INTO assessments(address,assessed_at,data) VALUES(?,?,?)").run(address, a.assessedAt, JSON.stringify(a));
}
export function activeAddresses(db: Db, since: number, limit = 60): string[] {
  return (db.prepare("SELECT t.address FROM tokens t WHERE (SELECT MAX(observed_at) FROM snapshots WHERE address=t.address) > ? ORDER BY t.first_seen DESC LIMIT ?").all(since, limit) as any[]).map(r => r.address);
}
export function setProvider(db: Db, name: string, ok: boolean, now: number, error = "") {
  db.prepare("INSERT OR IGNORE INTO provider_status(name) VALUES(?)").run(name);
  if (ok) db.prepare("UPDATE provider_status SET last_ok=? WHERE name=?").run(now, name);
  else db.prepare("UPDATE provider_status SET last_error=?, last_error_at=? WHERE name=?").run(error.slice(0, 300), now, name);
}
export const ACTIVE_MS = 6 * 3600_000; // tokens not refreshed for 6h leave the active feed (history is kept)
export function listTokens(db: Db, now = Date.now()) {
  const rows = db.prepare(`SELECT t.address, t.first_seen, t.pair_created_at,
    (SELECT data FROM snapshots WHERE address=t.address ORDER BY id DESC LIMIT 1) snap,
    (SELECT data FROM assessments WHERE address=t.address ORDER BY id DESC LIMIT 1) asmt
    FROM tokens t ORDER BY t.first_seen DESC LIMIT 400`).all() as any[];
  return rows.map(r => ({ address: r.address, firstSeen: r.first_seen, pairCreatedAt: r.pair_created_at, snapshot: JSON.parse(r.snap) as Metrics, assessment: JSON.parse(r.asmt) as Assessment }))
    .filter(t => now - t.snapshot.observedAt < ACTIVE_MS && (now - t.firstSeen < ACTIVE_MS || (t.assessment.recommendation !== "AVOID" && t.assessment.score >= 50)));
}
export function getStatus(db: Db, everyMs: number, now = Date.now()) {
  const p: any = db.prepare("SELECT * FROM provider_status WHERE name='dexscreener'").get() ?? {};
  const toks = listTokens(db, now);
  const x: any = db.prepare("SELECT * FROM provider_status WHERE name='x'").get() ?? {};
  return { xLastOk: x.last_ok ?? null, xLastError: x.last_error ?? null, lastOk: p.last_ok ?? null, lastError: p.last_error ?? null, lastErrorAt: p.last_error_at ?? null,
    stale: !p.last_ok || now - p.last_ok > 3 * everyMs, monitored: toks.length,
    discovered24h: toks.filter(t => now - t.firstSeen < 86_400_000).length,
    excluded: toks.filter(t => t.assessment.exclusions.length > 0).length };
}
export function prevAssessment(db: Db, address: string): Assessment | null {
  const r: any = db.prepare("SELECT data FROM assessments WHERE address=? ORDER BY id DESC LIMIT 1").get(address);
  return r ? JSON.parse(r.data) : null;
}
export const isWatched = (db: Db, address: string) => !!db.prepare("SELECT 1 FROM alerts WHERE address=? AND type='new_candidate' LIMIT 1").get(address);
// Dedupe + cooldown: same token and alert type is suppressed until the cooldown passes. Returns the new alert id, or null if suppressed.
export function recordAlertIfFresh(db: Db, address: string, type: string, now: number, message: string, cooldownMs: number): number | null {
  const last: any = db.prepare("SELECT MAX(created_at) t FROM alerts WHERE address=? AND type=?").get(address, type);
  if (last?.t != null && now - last.t < cooldownMs) return null;
  return Number(db.prepare("INSERT INTO alerts(address,type,created_at,message) VALUES(?,?,?,?)").run(address, type, now, message).lastInsertRowid);
}
export const markDelivered = (db: Db, id: number) => void db.prepare("UPDATE alerts SET delivered=1 WHERE id=?").run(id);
export const listAlerts = (db: Db, limit = 50) => db.prepare("SELECT id,address,type,created_at,message,delivered FROM alerts ORDER BY id DESC LIMIT ?").all(limit);
export function recordPrediction(db: Db, address: string, kind: "discovery" | "alert", m: Metrics, a: Assessment, now: number) {
  // Frozen at the time of the call, using only information available then (no look-ahead). One per token per kind.
  db.prepare("INSERT OR IGNORE INTO predictions(address,kind,discovered_at,price_usd,liquidity_usd,score,risk,recommendation,confidence,model_version) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(address, kind, now, m.priceUsd ?? null, m.liquidityUsd ?? null, a.score, a.risk, a.recommendation, a.confidence, a.modelVersion);
}
// Keep re-checking tokens with an unfinished paper record, even after they leave the active feed.
export const openPredictionAddresses = (db: Db, since: number, limit = 150): string[] =>
  (db.prepare("SELECT DISTINCT address FROM predictions WHERE discovered_at > ? LIMIT ?").all(since, limit) as any[]).map(r => r.address);
