// Free-hosting mode: run ONE scan, then write the dashboard's data as JSON files. A GitHub Actions job runs this every few minutes.
import { mkdirSync, writeFileSync } from "node:fs";
import { getStatus, listAlerts, listTokens, openDb } from "./db.ts";
import { telegramNotifier } from "./notify.ts";
import { report } from "./paper.ts";
import { dexProvider, scanOnce } from "./scan.ts";

const site = process.env.SITE_DIR ?? "public";
mkdirSync(`${site}/data`, { recursive: true });
const db = openDb(); // path comes from DB_PATH
const notify = telegramNotifier(); // X lookups are left out here: X is paid, so the free version has no X data
const result = await scanOnce(db, dexProvider, Date.now(), { notify });
const now = Date.now(), out = (name: string, v: unknown) => writeFileSync(`${site}/data/${name}.json`, JSON.stringify(v));
out("tokens", listTokens(db, now)); out("alerts", listAlerts(db)); out("paper", report(db, now));
out("status", { ...getStatus(db, 5 * 60_000, now), xEnabled: false, telegramEnabled: !!notify });
db.close();
console.log("scan:", JSON.stringify(result));
