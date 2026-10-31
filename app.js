const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const RISK = ["LOWER RELATIVE RISK", "MODERATE RISK", "HIGH RISK", "EXTREME RISK", "INSUFFICIENT DATA"];
const money = v => v == null ? "not available" : "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: v < 1 ? 6 : 0 });
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 120 ? m + " min ago" : Math.round(m / 60) + " h ago"; };
let tokens = [], hideAvoid = false;
function status(s) {
  const el = $("#status");
  const bad = s.stale; el.className = bad ? "bad" : "";
  el.textContent = (s.lastOk ? (bad ? "STALE DATA: last good scan " : "Live: last good scan ") + ago(s.lastOk) : "OFFLINE: no successful scan yet") +
    ` · ${s.monitored} monitored · ${s.discovered24h} found in 24h · ${s.excluded} excluded by safety filters` + (s.xEnabled ? " · X attention: on" : " · X attention: off") + (s.telegramEnabled ? " · Telegram: on" : "") + (s.lastError ? ` · Last error: ${s.lastError}` : "");
}
function render() {
  const k = $("#sort").value;
  const by = { seen: (a, b) => b.firstSeen - a.firstSeen, score: (a, b) => b.assessment.score - a.assessment.score,
    risk: (a, b) => RISK.indexOf(a.assessment.risk) - RISK.indexOf(b.assessment.risk), liq: (a, b) => (b.snapshot.liquidityUsd ?? -1) - (a.snapshot.liquidityUsd ?? -1) }[k];
  const rows = tokens.filter(t => !(hideAvoid && t.assessment.recommendation === "AVOID")).sort(by);
  $("#list").innerHTML = rows.map(t => { const a = t.assessment, m = t.snapshot;
    return `<article><h2><span>${esc(m.symbol || "unnamed")}</span><span class="rec">${esc(a.recommendation)}</span></h2>
<p class="addr">${esc(t.address)}</p>
<p>Runner score ${a.score}/100 · ${esc(a.risk)} · ${esc(a.confidence)} confidence</p>
<p>Price ${money(m.priceUsd)} · Liquidity ${money(m.liquidityUsd)} · 1h volume ${money(m.volume1h)} · 1h buys/sells ${m.buys1h ?? "n/a"}/${m.sells1h ?? "n/a"}</p>
<p class="note">First seen by this scanner ${ago(t.firstSeen)}${t.pairCreatedAt ? " · provider says pair created " + ago(t.pairCreatedAt) : " · real creation time unknown"}</p>
<p class="warn">${esc(a.reasonsAgainst[0] ?? a.limitations[0] ?? "No red flags in the data available")}</p>
<details><summary>Why this score</summary>${a.components.map(c => `<p>${esc(c.name)}: ${c.points}/${c.max} - ${esc(c.note)}${c.available ? "" : " [NOT ASSESSED]"}</p>`).join("")}
<p>${esc(a.summary)}</p><p class="note">Model ${esc(a.modelVersion)} · assessed ${ago(a.assessedAt)}</p></details></article>`; }).join("") ||
    `<p>No tokens yet. If the banner says OFFLINE or shows an error, the data provider is not reachable.</p>`;
}
async function load() {
  try { const [s, t, al, pp] = await Promise.all(["/api/status", "/api/tokens", "/api/alerts", "/api/paper"].map(u => fetch(u).then(r => r.json()))); tokens = t; status(s); render(); paper(pp);
    $("#alerts").innerHTML = al.map(x => `<article><p>${esc(x.message)}</p><p class="note">${esc(x.type)} · ${ago(x.created_at)} · Telegram ${x.delivered ? "sent" : "not sent"}</p></article>`).join("") || "<p class=\"note\">No alerts yet.</p>"; }
  catch { $("#status").className = "bad"; $("#status").textContent = "OFFLINE: cannot reach the server."; }
}
$("#sort").onchange = render;
$("#hide").onclick = () => { hideAvoid = !hideAvoid; $("#hide").textContent = hideAvoid ? "Show AVOID" : "Hide AVOID"; render(); };
load(); setInterval(load, 30000);
function paper(r) {
  const pct = v => v == null ? "n/a" : (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  const prop = p => !p ? "n/a" : `${p.k} of ${p.n}` + (p.ci ? ` (95% range ${p.ci[0]}-${p.ci[1]}%)` : "");
  const o = r.overall, ref = g => g.windows.find(w => w.minutes >= 60);
  const grp = (t, a) => a.length ? `<p><b>${t}</b></p>` + a.map(g => `<p class="note">${esc(g.label)}: ${g.n} calls, median ${ref(g) ? ref(g).minutes + " min" : ""} after costs ${pct(ref(g)?.medianNetPct)}, median worst drop ${pct(g.medianMaxDrawdownPct == null ? null : -g.medianMaxDrawdownPct)}</p>`).join("") : "";
  $("#paper").innerHTML = `<article><p class="note">${r.caveats.map(esc).join(" ")}</p>
<p>${o.n} hypothetical calls tracked, ${o.withData} with later price data.</p>
<div style="overflow-x:auto"><table><tr><th>After</th><th>Checked</th><th>Median, after costs</th><th>Gaps</th></tr>${o.windows.map(w => `<tr><td>${w.minutes} min</td><td>${w.matured}</td><td>${pct(w.medianNetPct)}</td><td>${w.unavailable} missing, ${w.pending} pending${w.assumedTotalLosses ? ", " + w.assumedTotalLosses + " failed exits" : ""}</td></tr>`).join("")}</table></div>
<p>Fully tracked calls: ${o.milestones.matured}. Touched +50%: ${prop(o.milestones.touched50)}. Touched +100%: ${prop(o.milestones.touched100)}. Touched +50% and still up at 1h after costs: ${prop(o.milestones.retained)}.</p>
${grp("By score", r.byScore)}${grp("By risk", r.byRisk)}${grp("By recommendation", r.byRecommendation)}</article>`;
}
