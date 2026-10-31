import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { report } from "./paper.ts";
import { getStatus, listAlerts, listTokens, openDb } from "./db.ts";
import { telegramNotifier } from "./notify.ts";
import { DailyBudget, xClient } from "./x.ts";
import { dexProvider, scanOnce } from "./scan.ts";

const db = openDb();
const OPTS = { notify: telegramNotifier(), x: xClient(), budget: new DailyBudget(Number(process.env.X_MAX_CALLS_PER_DAY ?? 100)) };
const PORT = Number(process.env.PORT ?? 3000);
const EVERY = Number(process.env.SCAN_SECONDS ?? 120) * 1000;
const web = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url));
const FILES: Record<string, [string, Buffer]> = {
  "/": ["text/html; charset=utf-8", web("index.html")], "/app.js": ["text/javascript", web("app.js")],
  "/manifest.webmanifest": ["application/manifest+json", web("manifest.webmanifest")] };
const SEC = { "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const json = (res: ServerResponse, body: unknown) => res.writeHead(200, { ...SEC, "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));

createServer((req, res) => {
  if (req.method !== "GET") return void res.writeHead(405, SEC).end(); // read-only: GET only
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/api/tokens") return json(res, listTokens(db));
  if (path === "/api/paper") return json(res, report(db));
  if (path === "/api/alerts") return json(res, listAlerts(db));
  if (path === "/api/status") return json(res, { ...getStatus(db, EVERY), xEnabled: !!OPTS.x, telegramEnabled: !!OPTS.notify });
  const f = FILES[path];
  if (!f) return void res.writeHead(404, SEC).end("Not found");
  res.writeHead(200, { ...SEC, "Content-Type": f[0] }).end(f[1]);
}).listen(PORT, () => console.log(`Dashboard on port ${PORT}, scanning every ${EVERY / 1000}s`));

let running = false;
async function tick() {
  if (running) return; running = true;
  try { console.log("scan:", JSON.stringify(await scanOnce(db, dexProvider, Date.now(), OPTS))); }
  catch (e) { console.error("scan crashed:", String(e)); } finally { running = false; }
}
void tick(); setInterval(tick, EVERY);
