const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const RISK = ["LOWER RELATIVE RISK", "MODERATE RISK", "HIGH RISK", "EXTREME RISK", "INSUFFICIENT DATA"];
const RISK_UI = { "LOWER RELATIVE RISK": ["●", "Lower risk", "g"], "MODERATE RISK": ["▲", "Moderate risk", "a"], "HIGH RISK": ["◆", "High risk", "r"], "EXTREME RISK": ["✖", "Extreme risk", "r"], "INSUFFICIENT DATA": ["?", "No data", ""] };
const REC_UI = { "WATCH": ["Watch", "b"], "POTENTIAL OPPORTUNITY": ["Opportunity", "g"], "WAIT FOR CONFIRMATION": ["Wait", "a"], "AVOID": ["Avoid", "r"], "INSUFFICIENT DATA": ["No data", ""] };
const n = v => typeof v === "number" && isFinite(v);
const fmt = v => !n(v) ? "n/a" : v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + v.toFixed(0);
const price = v => !n(v) ? "n/a" : v <= 0 ? "$0" : "$" + (v >= 1 ? v.toFixed(2) : v.toFixed(Math.min(12, 2 - Math.floor(Math.log10(v)))));
const pct = v => !n(v) ? "n/a" : (v > 0 ? "+" : "") + v.toFixed(1) + "%";
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "now" : m < 90 ? m + "m" : m < 2880 ? Math.round(m / 60) + "h" : Math.round(m / 1440) + "d"; };
const safeImg = u => typeof u === "string" && u.length < 300 && /^https:\/\/[^\s"'<>]+$/.test(u);
let tokens = [], alerts = [], paperData = null, hide = false, sortKey = "seen", shownId = null;

const av = (m, big) => `<div class="av${big ? " big" : ""}">${safeImg(m.imageUrl)
  ? `<img class="av-img" src="${esc(m.imageUrl)}" data-l="${esc((m.symbol || "?")[0])}" alt="" loading="lazy" referrerpolicy="no-referrer">`
  : `<span class="av-fb">${esc((m.symbol || "?")[0])}</span>`}</div>`;
const ring = (s, z = 46) => { const r = z / 2 - 4, c = 2 * Math.PI * r, h = z / 2;
  return `<svg class="ring" width="${z}" height="${z}" viewBox="0 0 ${z} ${z}" role="img" aria-label="Score ${s} of 100"><circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="#1d2632" stroke-width="4"/><circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="#4f7cff" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(c * s / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${h} ${h})"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="${z * 0.3}" font-weight="700" fill="#e8edf4">${s}</text></svg>`; };
const rec = a => { const [t, c] = REC_UI[a.recommendation] || ["?", ""]; return `<span class="pill ${c}">${t}</span>`; };
const risk = (a, full) => { const [g, t, c] = RISK_UI[a.risk] || ["?", a.risk, ""]; return `<span class="pill ${c}">${g} ${esc(full ? a.risk : t)}</span>`; };

function row(t) {
  const a = t.assessment, m = t.snapshot, w = a.reasonsAgainst[0] ?? a.limitations[0] ?? "No red flags in the data available";
  return `<div class="row" data-a="${esc(t.address)}">${av(m)}<div class="mid"><div class="t1"><b>${esc(m.symbol || "unnamed")}</b><span class="nm">${esc(m.name || "")}</span><span class="age">${t.pairCreatedAt ? "age " + ago(t.pairCreatedAt) : "seen " + ago(t.firstSeen)}</span></div>
<div class="stats"><span>MC <b>${fmt(m.marketCapUsd)}</b></span><span>Liq <b>${fmt(m.liquidityUsd)}</b></span><span>Vol 1h <b>${fmt(m.volume1h)}</b></span><span>B/S <b>${m.buys1h ?? "n/a"}/${m.sells1h ?? "n/a"}</b></span></div>
<div class="pills">${risk(a)}<span class="pill">${esc(a.confidence)} conf.</span></div><div class="warn">⚠ ${esc(w)}</div></div><div class="side">${ring(a.score)}${rec(a)}</div></div>`;
}
function chart(title, pts, f) { // only real observations are drawn: no filling, no interpolation
  const d = pts.filter(p => n(p[1]));
  if (d.length < 2) return `<div class="chart"><div class="ct"><span>${title}</span></div><p class="note">Not enough observations yet (${d.length}). Only what the scanner has actually seen is drawn.</p></div>`;
  const W = 320, H = 90, xs = d.map(p => p[0]), ys = d.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const P = d.map(p => `${(((p[0] - x0) / (x1 - x0 || 1)) * W).toFixed(1)},${(H - 6 - ((p[1] - y0) / (y1 - y0 || 1)) * (H - 12)).toFixed(1)}`).join(" ");
  return `<div class="chart"><div class="ct"><span>${title}</span><b>${f(ys[ys.length - 1])}</b></div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="cv"><polygon points="0,${H} ${P} ${W},${H}" fill="#4f7cff" opacity=".13"/><polyline points="${P}" fill="none" stroke="#4f7cff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="cr"><span>low ${f(y0)}</span><span>${d.length} observations over ${ago(x0)}</span><span>high ${f(y1)}</span></div></div>`;
}
function detail(t) {
  const a = t.assessment, m = t.snapshot, h = t.history || { points: [], scores: [] }, e = encodeURIComponent;
  const kv = [["Price", price(m.priceUsd)], ["Market cap", fmt(m.marketCapUsd)], ["Liquidity", fmt(m.liquidityUsd)], ["Volume 5m", fmt(m.volume5m)], ["Volume 1h", fmt(m.volume1h)], ["Buys / sells 1h", `${m.buys1h ?? "n/a"} / ${m.sells1h ?? "n/a"}`],
    ["Change 5m", pct(m.priceChange5m)], ["Change 1h", pct(m.priceChange1h)], ["First seen here", ago(t.firstSeen) + " ago"], ["Pair created (provider)", t.pairCreatedAt ? ago(t.pairCreatedAt) + " ago" : "unknown"]];
  const links = [["DexScreener", "https://dexscreener.com/solana/" + e(m.pairAddress || t.address)], ["Solscan", "https://solscan.io/token/" + e(t.address)], ["RugCheck", "https://rugcheck.xyz/tokens/" + e(t.address)], ["Birdeye", "https://birdeye.so/token/" + e(t.address) + "?chain=solana"]];
  return `<div class="hd"><button class="back" data-back="1">‹ Back</button><span class="note">Updated ${ago(m.observedAt)} ago · ${esc(m.source)}</span></div>
<div class="card top">${av(m, true)}<div class="mid"><div class="t1"><b class="big">${esc(m.symbol || "unnamed")}</b><span class="nm">${esc(m.name || "")}</span></div><button class="copy" data-copy="${esc(t.address)}">${esc(t.address.slice(0, 6))}…${esc(t.address.slice(-6))} ⧉ copy</button></div>${ring(a.score, 64)}</div>
<div class="pills sp">${rec(a)}${risk(a, true)}<span class="pill">${esc(a.confidence)} confidence</span></div>
${a.exclusions.length ? `<div class="card ex"><b>✖ Excluded by safety filters</b>${a.exclusions.map(x => `<p>${esc(x)}</p>`).join("")}</div>` : ""}
<div class="card"><p class="h">Why it is being watched</p><p>${a.reasonsFor.length ? a.reasonsFor.slice(0, 3).map(esc).join("<br>") : "No strong signals yet."}</p><p class="h">Main concern</p><p>${esc(a.reasonsAgainst[0] ?? a.limitations[0] ?? "None found in the data available.")}</p><p class="h">Assessment</p><p>${esc(a.summary)}</p></div>
${chart("Price (observed by this scanner)", h.points.map(p => [p[0], p[1]]), price)}${chart("Liquidity (observed)", h.points.map(p => [p[0], p[2]]), fmt)}${chart("Runner score (observed)", h.scores, v => String(Math.round(v)))}
${m.pairAddress ? `<div class="card"><button class="btn" data-chart="${esc(m.pairAddress)}">Load live candle chart (DexScreener)</button><div id="cf"></div></div>` : ""}
<div class="card"><p class="h">Score breakdown</p>${a.components.map(c => `<div class="cmp"><div class="ln"><span>${esc(c.name)}</span><b>${c.available ? c.points + " / " + c.max : "not assessed"}</b></div><div class="meter${c.available ? "" : " na"}"><i style="width:${c.available ? (100 * c.points / c.max).toFixed(0) : 0}%"></i></div><p class="note">${esc(c.note)}</p></div>`).join("")}</div>
<div class="card grid">${kv.map(x => `<div><span>${x[0]}</span>${esc(x[1])}</div>`).join("")}</div>
<div class="card"><p class="h">Warnings</p>${a.redFlags.map(x => `<p>⚠ ${esc(x)}</p>`).join("") || "<p class='note'>No warning flags raised.</p>"}<p class="h">Data limitations</p>${a.limitations.map(x => `<p class="note">• ${esc(x)}</p>`).join("") || "<p class='note'>None noted.</p>"}</div>
<div class="card"><p class="h">Open on another site (view only)</p><div class="links">${links.map(l => `<a class="btn" href="${esc(l[1])}" target="_blank" rel="noopener noreferrer">${l[0]} ↗</a>`).join("")}</div></div>
<p class="note">Model ${esc(a.modelVersion)} · assessed ${ago(a.assessedAt)} ago. Research aid only, not financial advice. This app never trades.</p>`;
}
function paperView(r) {
  const o = r.overall, ref = g => g.windows.find(w => w.minutes >= 60);
  const prop = p => !p ? "n/a" : `${p.k} of ${p.n}` + (p.ci ? ` (95% range ${p.ci[0]}-${p.ci[1]}%)` : "");
  const grp = (t, a) => a.length ? `<div class="card"><p class="h">${t}</p>` + a.map(g => `<p class="ln"><span>${esc(g.label)}</span><span>${g.n} calls · ${ref(g) ? ref(g).minutes + "m " : ""}${pct(ref(g)?.medianNetPct)} · worst drop ${pct(g.medianMaxDrawdownPct == null ? null : -g.medianMaxDrawdownPct)}</span></p>`).join("") + "</div>" : "";
  return `<div class="card"><p class="note">${r.caveats.map(esc).join(" ")}</p><p><b>${o.n}</b> hypothetical calls tracked, <b>${o.withData}</b> with later price data.</p><div class="scroll"><table><tr><th>After</th><th>Checked</th><th>Median after costs</th><th>Gaps</th></tr>${o.windows.map(w => `<tr><td>${w.minutes}m</td><td>${w.matured}</td><td>${pct(w.medianNetPct)}</td><td>${w.unavailable} missing, ${w.pending} pending${w.assumedTotalLosses ? ", " + w.assumedTotalLosses + " failed exits" : ""}</td></tr>`).join("")}</table></div>
<p>Fully tracked calls: ${o.milestones.matured}. Touched +50%: ${prop(o.milestones.touched50)}. Touched +100%: ${prop(o.milestones.touched100)}. Touched +50% and still up at 1h after costs: ${prop(o.milestones.retained)}.</p></div>${grp("By score", r.byScore)}${grp("By risk", r.byRisk)}${grp("By recommendation", r.byRecommendation)}`;
}
function status(s) {
  const bad = s.stale || !s.lastOk || Date.now() - s.lastOk > 30 * 60000;
  $("#dot").className = "dot " + (!s.lastOk ? "r" : bad ? "a" : "g");
  $("#st").textContent = !s.lastOk ? "OFFLINE" : bad ? "STALE" : "LIVE";
  const err = s.lastError && (!s.lastOk || s.lastErrorAt > s.lastOk), rpcErr = s.rpcLastError && (!s.rpcLastOk || s.rpcLastErrorAt > s.rpcLastOk);
  $("#stsub").textContent = (s.lastOk ? "Last good scan " + ago(s.lastOk) + " ago" : "No successful scan yet") + (err ? " · Data error: " + s.lastError : "") + (rpcErr ? " · Safety-check problem: " + s.rpcLastError : "");
  $("#chips").innerHTML = [["Monitored", s.monitored], ["Found 24h", s.discovered24h], ["Excluded", s.excluded], ["Safety checks", s.rpcLastOk && !rpcErr ? "on" : rpcErr ? "problem" : "waiting"], ["X data", s.xEnabled ? "on" : "off"], ["Telegram", s.telegramEnabled ? "on" : "off"]].map(c => `<span class="chip">${c[0]}: <b>${esc(c[1])}</b></span>`).join("");
}
function render() {
  const by = { seen: (a, b) => b.firstSeen - a.firstSeen, score: (a, b) => b.assessment.score - a.assessment.score, risk: (a, b) => RISK.indexOf(a.assessment.risk) - RISK.indexOf(b.assessment.risk), liq: (a, b) => (b.snapshot.liquidityUsd ?? -1) - (a.snapshot.liquidityUsd ?? -1) }[sortKey];
  $("#list").innerHTML = tokens.filter(t => !(hide && t.assessment.recommendation === "AVOID")).sort(by).map(row).join("") || `<div class="card"><p>No tokens to show yet.</p><p class="note">If the top bar says OFFLINE, the data provider could not be reached. Check back in a few minutes.</p></div>`;
  $("#v-alerts").innerHTML = alerts.map(x => `<div class="card"><p>${esc(x.message)}</p><p class="note">${esc(String(x.type).replace(/_/g, " "))} · ${ago(x.created_at)} ago · Telegram ${x.delivered ? "sent" : "not sent"}</p></div>`).join("") || `<div class="card"><p class="note">No alerts yet.</p></div>`;
  if (paperData) $("#v-paper").innerHTML = paperView(paperData);
}
function route() {
  const id = location.hash.slice(1), t = tokens.find(x => x.address === id), d = $("#detail");
  if (t) { if (shownId !== id) { d.innerHTML = detail(t); d.hidden = false; d.scrollTop = 0; shownId = id; document.body.classList.add("lock"); } }
  else { d.hidden = true; shownId = null; document.body.classList.remove("lock"); }
}
async function load() {
  let d;
  try { d = await Promise.all(["/api/status", "/api/tokens", "/api/alerts", "/api/paper"].map(u => fetch(u).then(r => r.json()))); }
  catch { $("#dot").className = "dot r"; $("#st").textContent = "OFFLINE"; $("#stsub").textContent = "Cannot reach the data. Check your connection."; return; }
  tokens = d[1]; alerts = d[2]; paperData = d[3]; status(d[0]); render(); route();
}
$("#list").addEventListener("click", e => { const r = e.target.closest && e.target.closest(".row"); if (r) location.hash = r.dataset.a; });
$("#sorts").addEventListener("click", e => { const b = e.target.closest && e.target.closest("button"); if (!b) return;
  if (b.dataset.hide) { hide = !hide; b.className = hide ? "on" : ""; b.textContent = hide ? "Showing no Avoid" : "Hide Avoid"; } else if (b.dataset.sort) { sortKey = b.dataset.sort; document.querySelectorAll("#sorts [data-sort]").forEach(x => x.className = x === b ? "on" : ""); }
  render(); });
$("#tabs").addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-tab]"); if (!b) return;
  for (const k of ["tokens", "alerts", "paper"]) { $("#v-" + k).hidden = k !== b.dataset.tab; $("#tab-" + k).className = k === b.dataset.tab ? "on" : ""; } });
$("#detail").addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-back],[data-copy],[data-chart]"); if (!b) return;
  if (b.dataset.back) location.hash = ""; else if (b.dataset.copy) { if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy); }
  else if (b.dataset.chart) $("#cf").innerHTML = `<iframe class="cf" src="https://dexscreener.com/solana/${encodeURIComponent(b.dataset.chart)}?embed=1&theme=dark&trades=0&info=0" loading="lazy" referrerpolicy="no-referrer"></iframe>`; });
document.addEventListener("error", e => { const t = e.target; if (t && t.classList && t.classList.contains("av-img")) t.outerHTML = `<span class="av-fb">${esc(t.dataset.l)}</span>`; }, true);
window.addEventListener("hashchange", route);
load(); setInterval(load, 30000);
