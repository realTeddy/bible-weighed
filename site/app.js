/* The Great Debates — interactive stats dashboard (vanilla JS + hand-built SVG) */
(() => {
'use strict';

const RAW = window.SITE_DATA || { topics: [], reviews: [], debateIds: [] };
const SITE = 'The Bible, Weighed';
const SIDES = ['theist', 'atheist'];
const SIDE_LABEL = { theist: 'Theist', atheist: 'Atheist', draw: 'Draw' };
const CRIT = ['evidence', 'logic', 'engagement', 'honesty', 'clarity'];
const CRIT_ALL = [...CRIT, 'overall'];
const CRIT_LABEL = { evidence: 'Evidence', logic: 'Logic', engagement: 'Engagement', honesty: 'Honesty', clarity: 'Clarity', overall: 'Overall' };
const CRIT_W = { evidence: '25%', logic: '25%', engagement: '20%', honesty: '15%', clarity: '15%' };
const CATS = ['History', 'Text', 'Science', 'Morality', 'Philosophy'];
const SIG_W = { minor: 1, moderate: 2, major: 3 };
const JUDGE_LABEL = { historian: 'Historian', philosopher: 'Philosopher', adjudicator: 'Adjudicator' };
const MODEL_LABEL = { 'gpt-6.1-terra': 'GPT-6.1', 'gemini-3.8-flash': 'Gemini 3.8', 'grok-4.7': 'Grok 4.7' };
const judgeName = j => `${JUDGE_LABEL[j.judge] || j.judge}${j.model ? ` · ${MODEL_LABEL[j.model] || j.model}` : ''}`;
const JUDGE_SHAPE = { historian: 'circle', philosopher: 'square', adjudicator: 'triangle' };
const END_LABEL = { mutual_close: 'Mutual close', max_rounds: 'Went the distance', theist_conceded: 'Theist conceded', atheist_conceded: 'Atheist conceded' };
const END_GLYPH = { mutual_close: '⇄', max_rounds: '∎', theist_conceded: '⚑', atheist_conceded: '⚑' };

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const r1 = x => (Math.round(x * 10) / 10).toFixed(1);
const r2 = x => (Math.round(x * 100) / 100).toFixed(2);
const signed = x => (x > 0 ? '+' : x < 0 ? '−' : '±') + r1(Math.abs(x));
const lin = (d0, d1, r0, r1_) => v => r0 + (v - d0) / (d1 - d0 || 1) * (r1_ - r0);
const dot = side => `<span class="dot ${side}"></span>`;
const tipAttr = html => `data-tip="${esc(html)}"`;
const ttRow = (label, value, side) => `<div class="tt-row"><span>${side ? dot(side) : ''}${esc(label)}</span><b>${esc(value)}</b></div>`;

function hbar(x0, x1, y, h, r = 4) {
  const w = Math.abs(x1 - x0); if (w < 0.5) return '';
  r = Math.min(r, w, h / 2);
  return x1 >= x0
    ? `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`
    : `M${x0},${y}H${x1 + r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 + r},${y + h}H${x0}Z`;
}
function vbar(x, w, y0, y1, r = 4) {
  const h = y0 - y1; if (h < 0.5) return '';
  r = Math.min(r, h, w / 2);
  return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
}
function shape(kind, cx, cy, s, cls, extra = '') {
  if (kind === 'square') return `<rect x="${cx - s}" y="${cy - s}" width="${2 * s}" height="${2 * s}" rx="1.5" class="${cls}" ${extra}/>`;
  if (kind === 'diamond') return `<path d="M${cx},${cy - s * 1.3}L${cx + s * 1.3},${cy}L${cx},${cy + s * 1.3}L${cx - s * 1.3},${cy}Z" class="${cls}" ${extra}/>`;
  if (kind === 'triangle') return `<path d="M${cx},${cy - s * 1.2}L${cx + s * 1.1},${cy + s * 0.85}L${cx - s * 1.1},${cy + s * 0.85}Z" class="${cls}" ${extra}/>`;
  return `<circle cx="${cx}" cy="${cy}" r="${s}" class="${cls}" ${extra}/>`;
}
const svgWrap = (w, h, inner, label) => `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function md(text) {
  const lines = esc(text).split(/\n/);
  let html = '', list = null, para = [];
  const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>').replace(/`(.+?)`/g, '<code>$1</code>');
  const flushP = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  const flushL = () => { if (list) { html += `<${list.t}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.t}>`; list = null; } };
  for (const raw of lines) {
    const l = raw.trim();
    let m;
    if (!l) { flushP(); flushL(); continue; }
    if ((m = l.match(/^[-*•]\s+(.*)/))) { flushP(); if (!list || list.t !== 'ul') { flushL(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = l.match(/^\d+[.)]\s+(.*)/))) { flushP(); if (!list || list.t !== 'ol') { flushL(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = l.match(/^&gt;\s?(.*)/))) { flushP(); flushL(); html += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
    if ((m = l.match(/^#{1,6}\s+(.*)/))) { flushP(); flushL(); html += `<p><strong>${inline(m[1])}</strong></p>`; continue; }
    flushL(); para.push(l);
  }
  flushP(); flushL();
  return html;
}

// ---------- derive ----------
function derive(d) {
  const t = d.topic;
  const crit = {};
  for (const s of SIDES) { crit[s] = {}; for (const k of CRIT_ALL) crit[s][k] = mean(d.judges.map(j => j.scores[s][k])); }
  const conc = { theist: [], atheist: [] }, sources = { theist: [], atheist: [] };
  const conf = { theist: {}, atheist: {} };
  for (const tu of d.turns) {
    tu.concessions.forEach(c => conc[tu.side].push({ ...c, round: tu.round }));
    tu.sources.forEach(s => sources[tu.side].push({ ...s, round: tu.round }));
    if (tu.claims.length) conf[tu.side][tu.round] = mean(tu.claims.map(c => c.confidence));
  }
  const rounds = Math.max(...d.turns.map(x => x.round));
  const withJ = key => d.judges.flatMap(j => (j[key] || []).map(x => ({ ...x, judge: j.judge })));
  const concW = s => conc[s].reduce((a, c) => a + (SIG_W[c.significance] || 1), 0);
  const text = (t.short + ' ' + t.resolution + ' ' + d.turns.map(x => x.speech).join(' ') + ' ' + d.judges.map(j => j.verdict).join(' ')).toLowerCase();
  return {
    ...d, id: t.id, short: t.short, category: t.category, resolution: t.resolution,
    crit, conc, concW: { theist: concW('theist'), atheist: concW('atheist') }, sources, conf, rounds,
    score: d.panel.overall, gap: d.panel.overall.atheist - d.panel.overall.theist, rubric: d.panel.weighted,
    winner: d.panel.winner, votes: d.panel.votes,
    fallacies: withJ('fallacies'), errors: withJ('factual_errors'), highlights: withJ('highlights'), keyConc: withJ('key_concessions'),
    text,
  };
}
let ALL = [];
let debatesP = null;
const loadDebates = () => debatesP ||= fetch(`/data/debates.json?v=${RAW.updated}`).then(r => r.json()).then(j => { ALL = j.debates.map(derive).sort((a, b) => a.id - b.id); });
const FULL = {};
const loadReview = id => FULL[id] ||= fetch(`/data/reviews/${String(id).padStart(2, '0')}.json?v=${RAW.updated}`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
const loading = () => { $('#app').innerHTML = '<div class="card"><p class="empty">Loading…</p></div>'; };

// ---------- state & routing ----------
const state = { cat: 'all', winner: 'all', q: '', sort: { key: 'id', dir: 1 }, judgeTab: {} };
const filtered = () => ALL.filter(d =>
  (state.cat === 'all' || d.category === state.cat) &&
  (state.winner === 'all' || d.winner === state.winner) &&
  (!state.q || d.text.includes(state.q.toLowerCase())));

let routeSeq = 0;
const curPath = () => location.pathname.replace(/\/+$/, '') || '/';
function go(path, keepScroll) {
  tip.hidden = true;
  if (path === location.pathname + location.hash) return;
  history.pushState(null, '', path);
  route().then(() => { if (!keepScroll && !/\/r\d+$/.test(path)) scrollTo(0, 0); });
}
async function route() {
  // legacy #/ links -> real paths
  if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1).replace(/^\/?/, '/'));
  const seq = ++routeSeq, h = curPath();
  const m = h.match(/^\/topic\/(\d+)(?:\/r(\d+))?/);
  setNav();
  if (m || h.startsWith('/debates')) {
    if (!ALL.length) { loading(); await loadDebates(); if (seq !== routeSeq) return; }
    if (m) { document.title = `Debate · ${ALL.find(d => d.id === +m[1])?.short || ''} · ${SITE}`; return renderTopic(+m[1], m[2] ? +m[2] : null); }
    document.title = `Why not debates? · ${SITE}`; return renderOverview();
  }
  if (h.startsWith('/method')) { document.title = `How it works · ${SITE}`; return renderMethod(); }
  const rv = h.match(/^\/review\/(\d+)/);
  if (rv) {
    const id = +rv[1], t = TOPICS.find(x => x.id === id);
    document.title = `${t ? t.question : 'Topic'} · ${SITE}`;
    if (!FULL[id] || !FULL[id].done) loading();
    let full = null;
    try { full = await loadReview(id); FULL[id].done = true; } catch { delete FULL[id]; }
    if (seq !== routeSeq) return;
    return renderReview(id, full);
  }
  document.title = `${SITE}: what is most likely true?`;
  renderReviews();
}
function setNav() {
  const h = curPath();
  const cur = /^\/(debates|topic)/.test(h) ? 'debates' : h.startsWith('/method') ? 'method' : 'reviews';
  $$('.topnav a').forEach(a => a.setAttribute('aria-current', a.dataset.nav === cur ? 'page' : 'false'));
}
window.addEventListener('popstate', route);
let resizeT; window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(drawCharts, 120); });

// theme
const themeBtn = $('#themeToggle');
const savedTheme = localStorage.getItem('debate-theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next; localStorage.setItem('debate-theme', next);
});

// search
const searchEl = $('#search');
let searchT;
searchEl.addEventListener('input', () => {
  clearTimeout(searchT);
  searchT = setTimeout(() => { state.q = searchEl.value.trim(); route(); }, 180);
});

// tooltip (delegated)
const tip = $('#tooltip');
document.addEventListener('mouseover', e => {
  const el = e.target.closest('[data-tip]');
  if (!el) { tip.hidden = true; return; }
  tip.innerHTML = el.getAttribute('data-tip'); tip.hidden = false;
});
document.addEventListener('mousemove', e => {
  if (tip.hidden) return;
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > innerHeight - 8) y = e.clientY - h - pad;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
});
document.addEventListener('click', e => {
  const el = e.target.closest('[data-go]');
  if (el) { e.preventDefault(); go(el.getAttribute('data-go')); return; }
  const a = e.target.closest('a[href^="/"]');
  if (a && !a.target && !e.metaKey && !e.ctrlKey && !e.shiftKey && !/\.(json|xml|txt|png|svg)$/.test(a.getAttribute('href'))) { e.preventDefault(); go(a.getAttribute('href')); }
});

// ---------- chart registry ----------
let chartJobs = [];
function chart(id, fn) { chartJobs.push([id, fn]); return `<div class="chart" id="${id}"></div>`; }
function drawCharts() {
  for (const [id, fn] of chartJobs) {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = fn(Math.max(280, el.clientWidth)); }
  }
  bindLineCharts();
}

// ---------- OVERVIEW ----------
function renderOverview() {
  chartJobs = [];
  const ds = filtered();
  const app = $('#app');
  if (!ALL.length) { app.innerHTML = '<div class="card"><h2>No debate data yet</h2><p class="sub">Run the debate workflow, then <code>python3 scripts/build.py</code>.</p></div>'; return; }

  const wins = { theist: 0, atheist: 0, draw: 0 };
  ds.forEach(d => wins[d.winner]++);
  const sum = (f) => ds.reduce((a, d) => a + f(d), 0);
  const avgScore = s => ds.length ? mean(ds.map(d => d.score[s])) : 0;
  const tile = (label, total, t, a, fmt = x => x) => `<div class="tile"><div class="label">${label}</div><div class="value">${fmt(total)}<span class="split"><span>${dot('theist')}${fmt(t)}</span><span>${dot('atheist')}${fmt(a)}</span></span></div></div>`;

  app.innerHTML = debatesIntro() + `
  <section class="hero">
    <div class="hero-record">
      <div class="eyebrow">Panel record · ${ds.length} of ${ALL.length} debates${state.cat !== 'all' || state.winner !== 'all' || state.q ? ' (filtered)' : ''}</div>
      <div class="record">
        <span class="who">${dot('theist')}Theist</span><span class="big">${wins.theist}</span>
        <span class="vs">–</span>
        <span class="big">${wins.atheist}</span><span class="who">Atheist${dot('atheist')}</span>
        <span class="who" style="margin-left:auto">${dot('draw')}${wins.draw} draw${wins.draw === 1 ? '' : 's'}</span>
      </div>
      ${chart('c-record', w => recordBar(w, wins))}
    </div>
    <div class="tiles">
      ${tile('Avg rating (1–10)', r2(mean([avgScore('theist'), avgScore('atheist')])), avgScore('theist'), avgScore('atheist'), x => r2(x))}
      ${tile('Concessions made', sum(d => d.conc.theist.length + d.conc.atheist.length), sum(d => d.conc.theist.length), sum(d => d.conc.atheist.length))}
      ${tile('Sources cited', sum(d => d.sources.theist.length + d.sources.atheist.length), sum(d => d.sources.theist.length), sum(d => d.sources.atheist.length))}
      ${tile('Fallacy flags', sum(d => d.fallacies.length), sum(d => d.fallacies.filter(f => f.side === 'theist').length), sum(d => d.fallacies.filter(f => f.side === 'atheist').length))}
      ${tile('Factual errors flagged', sum(d => d.errors.length), sum(d => d.errors.filter(f => f.side === 'theist').length), sum(d => d.errors.filter(f => f.side === 'atheist').length))}
      <div class="tile"><div class="label">Rounds debated</div><div class="value">${sum(d => d.rounds)}<span class="split"><span>avg ${r1(mean(ds.map(d => d.rounds)))} / debate</span></span></div></div>
    </div>
  </section>

  <nav class="filters" aria-label="Filters">
    ${['all', ...CATS].map(c => `<button class="chip" data-cat="${c}" aria-pressed="${state.cat === c}">${c === 'all' ? 'All topics' : c}</button>`).join('')}
    <span class="sep"></span>
    ${['all', 'theist', 'atheist', 'draw'].map(w => `<button class="chip" data-win="${w}" aria-pressed="${state.winner === w}">${w === 'all' ? 'Any winner' : dot(w) + SIDE_LABEL[w] + (w === 'draw' ? 's' : ' wins')}</button>`).join('')}
    <span class="count">${state.q ? `matching “${esc(state.q)}” · ` : ''}${ds.length} debate${ds.length === 1 ? '' : 's'}</span>
  </nav>

  ${ds.length ? `
  <section class="card" style="margin-bottom:20px">
    <div class="card-head"><div><h2>Key takeaways</h2><p class="sub">Computed from the panel's scores and the transcripts</p></div></div>
    <div class="insights">${insights(ds)}</div>
  </section>

  <section class="grid">
    <div class="card span-7">
      <div class="card-head"><div><h2>Scoreboard</h2><p class="sub">Each debater's 1–10 rating (average of the three judges). Click a row to open it.</p></div>${legend2()}</div>
      ${chart('c-dumbbell', w => dumbbell(w, ds))}
    </div>
    <div class="card span-5">
      <div class="card-head"><div><h2>Strengths by criterion</h2><p class="sub">Average judge score across debates (weight in parentheses)</p></div>${legend2()}</div>
      ${chart('c-crit', w => criteriaBars(w, ds.map(d => d.crit)))}
      <div style="height:18px"></div>
      <h2>Wins by category</h2><p class="sub">Panel majority decision</p>
      ${chart('c-cat', w => categoryBars(w, ds))}
    </div>

    <div class="card span-12">
      <div class="card-head"><div><h2>Criterion heatmap</h2><p class="sub">Score gap per criterion (atheist − theist). Blue = theist ahead, orange = atheist ahead, gray = even.</p></div>
      <div class="legend"><span><i class="sw" style="background:var(--theist)"></i>Theist ahead</span><span><i class="sw" style="background:var(--mid)"></i>Even</span><span><i class="sw" style="background:var(--atheist)"></i>Atheist ahead</span></div></div>
      ${chart('c-heat', w => heatmap(w, ds))}
    </div>

    <div class="card span-6">
      <div class="card-head"><div><h2>Concessions</h2><p class="sub">Points each debater conceded, weighted by significance (minor 1 · moderate 2 · major 3)</p></div>${legend2()}</div>
      ${chart('c-conc', w => butterfly(w, ds))}
    </div>
    <div class="card span-6">
      <div class="card-head"><div><h2>Does conceding cost you?</h2><p class="sub">Weighted concessions given vs. that debater's panel score</p></div>${legend2()}</div>
      ${chart('c-scatter', w => scatter(w, ds))}
    </div>

    <div class="card span-6">
      <div class="card-head"><div><h2>Judge agreement</h2><p class="sub">Each judge's rating margin (atheist − theist). Tight clusters = consensus.</p></div>
      <div class="legend">${Object.keys(JUDGE_LABEL).map(j => `<span><svg width="12" height="12">${shape(JUDGE_SHAPE[j], 6, 6, 4.5, '', 'fill="var(--text-secondary)"')}</svg>${JUDGE_LABEL[j]}</span>`).join('')}</div></div>
      ${chart('c-judges', w => judgeAgreement(w, ds))}
    </div>
    <div class="card span-6">
      <div class="card-head"><div><h2>Debate length</h2><p class="sub">Rounds before the debate ended (max 20). Glyph shows how it ended.</p></div>
      <div class="legend"><span>⇄ mutual close</span><span>⚑ concession</span><span>∎ went 20 rounds</span></div></div>
      ${chart('c-rounds', w => roundsChart(w, ds))}
    </div>

    <div class="card span-6">
      <div class="card-head"><div><h2>Most-flagged fallacies</h2><p class="sub">Total flags from all three judges, by fallacy type</p></div>${legend2()}</div>
      ${chart('c-fall', w => fallacyBars(w, ds))}
    </div>
    <div class="card span-6">
      <div class="card-head"><div><h2>What each side cited</h2><p class="sub">Sources by type, across all turns</p></div>${legend2()}</div>
      ${chart('c-src', w => sourceBars(w, ds))}
    </div>

    <div class="card span-12">
      <div class="card-head"><div><h2>Highlight reel</h2><p class="sub">Moments the judges singled out. Click to jump to the round.</p></div>${legend2()}</div>
      <div class="reel">${highlightReel(ds)}</div>
    </div>

    <div class="card span-12">
      <div class="card-head"><div><h2>All debates</h2><p class="sub">Click a column to sort, click a row to open the full debate</p></div></div>
      ${leaderboard(ds)}
    </div>
  </section>` : '<div class="card"><p class="empty">No debates match these filters.</p></div>'}`;

  $$('[data-cat]').forEach(b => b.onclick = () => { state.cat = b.dataset.cat; renderOverview(); });
  $$('[data-win]').forEach(b => b.onclick = () => { state.winner = b.dataset.win; renderOverview(); });
  $$('th[data-sort]').forEach(th => th.onclick = () => {
    const k = th.dataset.sort; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 }; renderOverview();
  });
  drawCharts();
}

const legend2 = () => `<div class="legend"><span><i class="sw" style="background:var(--theist)"></i>Theist</span><span><i class="sw" style="background:var(--atheist)"></i>Atheist</span></div>`;

function insights(ds) {
  const link = d => `<a href="/topic/${d.id}">${esc(d.short)}</a>`;
  const by = (f, dir = 1) => [...ds].sort((a, b) => dir * (f(b) - f(a)))[0];
  const out = [];
  const big = by(d => Math.abs(d.gap));
  out.push(['Most lopsided', `${link(big)}: ${SIDE_LABEL[big.gap > 0 ? 'atheist' : 'theist']} by ${r2(Math.abs(big.gap))}`]);
  const close = by(d => -Math.abs(d.gap));
  if (ds.length > 1) out.push(['Closest contest', `${link(close)}: margin ${r2(Math.abs(close.gap))}`]);
  const conc = by(d => d.conc.theist.length + d.conc.atheist.length);
  out.push(['Most concessions', `${link(conc)}: ${conc.conc.theist.length + conc.conc.atheist.length} points conceded`]);
  const long = by(d => d.rounds);
  out.push(['Longest debate', `${link(long)}: ${long.rounds} rounds (${END_LABEL[long.endReason] || long.endReason})`]);
  const split = ds.filter(d => Math.max(d.votes.theist, d.votes.atheist, d.votes.draw) < 3);
  out.push(['Split decisions', split.length ? `${split.length} debate${split.length > 1 ? 's' : ''}: ${split.slice(0, 3).map(link).join(', ')}${split.length > 3 ? '…' : ''}` : 'None. Every panel was unanimous.']);
  const honest = SIDES.map(s => [s, mean(ds.map(d => d.crit[s].honesty))]).sort((a, b) => b[1] - a[1]);
  out.push(['Honesty edge', `${SIDE_LABEL[honest[0][0]]} ${r2(honest[0][1])} vs ${r2(honest[1][1])}`]);
  const ev = SIDES.map(s => [s, mean(ds.map(d => d.crit[s].evidence))]).sort((a, b) => b[1] - a[1]);
  out.push(['Evidence edge', `${SIDE_LABEL[ev[0][0]]} ${r2(ev[0][1])} vs ${r2(ev[1][1])}`]);
  const conceded = ds.filter(d => d.endReason.endsWith('_conceded'));
  out.push(['Resolution conceded', conceded.length ? conceded.map(d => `${link(d)} (${SIDE_LABEL[d.conceded]})`).join(', ') : 'No debater ever conceded the whole resolution.']);
  return out.map(([k, v]) => `<div class="insight"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
}

// ---- charts ----
function recordBar(w, wins) {
  const total = wins.theist + wins.atheist + wins.draw || 1, h = 28, gap = 2;
  let x = 0, out = '';
  for (const k of ['theist', 'draw', 'atheist']) {
    const ww = wins[k] / total * w;
    if (ww <= 0) continue;
    const segW = Math.max(0, ww - (x + ww < w - 1 ? gap : 0));
    const cls = k === 'draw' ? 'f-neutral' : 'f-' + k;
    out += `<rect x="${x}" y="0" width="${segW}" height="${h}" rx="4" class="${cls}" ${tipAttr(`<div class="tt-title">${SIDE_LABEL[k]}${k === 'draw' ? 's' : ' wins'}</div>${wins[k]} of ${total} (${Math.round(wins[k] / total * 100)}%)`)}/>`;
    if (segW > 46) out += `<text x="${x + 10}" y="${h / 2 + 4}" fill="${k === 'draw' ? 'var(--text-primary)' : '#fff'}" font-size="12" font-weight="600" pointer-events="none">${Math.round(wins[k] / total * 100)}%</text>`;
    x += ww;
  }
  return svgWrap(w, h, out, 'Win share');
}

function dumbbell(w, ds) {
  const rowH = 30, top = 22, left = Math.min(170, w * 0.36), right = 40;
  const h = top + ds.length * rowH + 6;
  const lo = Math.max(1, Math.floor(Math.min(...ds.flatMap(d => [d.score.theist, d.score.atheist])) - 1));
  const x = lin(lo, 10, left, w - right);
  let g = '';
  for (let v = lo; v <= 10; v++) g += `<line x1="${x(v)}" x2="${x(v)}" y1="${top - 6}" y2="${h}" class="gridline"/><text x="${x(v)}" y="${top - 10}" class="ax" text-anchor="middle">${v}</text>`;
  ds.forEach((d, i) => {
    const y = top + i * rowH + rowH / 2, xt = x(d.score.theist), xa = x(d.score.atheist);
    const tt = `<div class="tt-title">#${d.id} ${esc(d.short)}</div>${ttRow('Theist', r2(d.score.theist), 'theist')}${ttRow('Atheist', r2(d.score.atheist), 'atheist')}<div class="tt-muted">Winner: ${SIDE_LABEL[d.winner]} (${d.votes.theist}–${d.votes.atheist}–${d.votes.draw}) · ${d.rounds} rounds</div>`;
    g += `<g class="clickable" data-go="/topic/${d.id}" ${tipAttr(tt)}>
      <rect x="0" y="${y - rowH / 2}" width="${w}" height="${rowH}" fill="transparent" class="row-hit" rx="6"/>
      <text x="${left - 12}" y="${y + 4}" class="lbl" text-anchor="end">${esc(trunc(d.short, 22))}</text>
      <line x1="${Math.min(xt, xa)}" x2="${Math.max(xt, xa)}" y1="${y}" y2="${y}" stroke="var(--axis)" stroke-width="2"/>
      <circle cx="${xt}" cy="${y}" r="6" class="f-theist ring"/><circle cx="${xa}" cy="${y}" r="6" class="f-atheist ring"/>
      <text x="${Math.max(xt, xa) + 12}" y="${y + 4}" class="val">${d.winner === 'draw' ? 'draw' : signed(Math.abs(d.gap)).replace('+', '')}</text>
    </g>`;
  });
  return svgWrap(w, h, g, 'Scoreboard dumbbell chart');
}

function criteriaBars(w, crits) {
  const left = 120, right = 36, barH = 10, gap = 2, groupH = 2 * barH + gap + 14, h = CRIT_ALL.length * groupH + 18;
  const x = lin(0, 10, left, w - right);
  let g = '';
  for (let v = 0; v <= 10; v += 2) g += `<line x1="${x(v)}" x2="${x(v)}" y1="0" y2="${h - 18}" class="gridline"/><text x="${x(v)}" y="${h - 4}" class="ax" text-anchor="middle">${v}</text>`;
  CRIT_ALL.forEach((k, i) => {
    const y0 = i * groupH + 4;
    g += `<text x="${left - 12}" y="${y0 + barH + 4}" class="lbl" text-anchor="end">${CRIT_LABEL[k]}${CRIT_W[k] ? ` (${CRIT_W[k]})` : ''}</text>`;
    SIDES.forEach((s, j) => {
      const v = mean(crits.map(c => c[s][k])), y = y0 + j * (barH + gap);
      g += `<path d="${hbar(x(0), x(v), y, barH)}" class="f-${s}" ${tipAttr(`<div class="tt-title">${CRIT_LABEL[k]}</div>${ttRow(SIDE_LABEL[s], r2(v), s)}`)}/><text x="${x(v) + 6}" y="${y + barH - 1}" class="val">${r1(v)}</text>`;
    });
  });
  g += `<line x1="${x(0)}" x2="${x(0)}" y1="0" y2="${h - 18}" class="baseline"/>`;
  return svgWrap(w, h, g, 'Criteria comparison');
}

function categoryBars(w, ds) {
  const left = 90, rowH = 34, barH = 22, h = CATS.length * rowH;
  const x0 = left, W = w - left - 8;
  let g = '';
  CATS.forEach((c, i) => {
    const items = ds.filter(d => d.category === c), y = i * rowH + (rowH - barH) / 2;
    g += `<text x="${left - 12}" y="${y + barH / 2 + 4}" class="lbl" text-anchor="end">${c}</text>`;
    if (!items.length) { g += `<rect x="${x0}" y="${y}" width="${W}" height="${barH}" rx="4" fill="var(--surface-2)"/><text x="${x0 + 10}" y="${y + barH / 2 + 4}" class="ax">no debates in view</text>`; return; }
    const cnt = { theist: 0, draw: 0, atheist: 0 }; items.forEach(d => cnt[d.winner]++);
    let x = x0;
    for (const k of ['theist', 'draw', 'atheist']) {
      const ww = cnt[k] / items.length * W; if (!ww) continue;
      const segW = Math.max(0, ww - (x + ww < x0 + W - 1 ? 2 : 0));
      g += `<rect x="${x}" y="${y}" width="${segW}" height="${barH}" rx="4" class="${k === 'draw' ? 'f-neutral' : 'f-' + k}" ${tipAttr(`<div class="tt-title">${c}</div>${ttRow(SIDE_LABEL[k] + (k === 'draw' ? 's' : ' wins'), `${cnt[k]} of ${items.length}`, k === 'draw' ? 'draw' : k)}`)}/>`;
      if (segW > 22) g += `<text x="${x + 8}" y="${y + barH / 2 + 4}" fill="${k === 'draw' ? 'var(--text-primary)' : '#fff'}" font-size="12" font-weight="600" pointer-events="none">${cnt[k]}</text>`;
      x += ww;
    }
  });
  return svgWrap(w, h, g, 'Wins by category');
}

function divColor(v, max) {
  const t = Math.max(-1, Math.min(1, v / max));
  const a = Math.round(Math.abs(t) * 100);
  const pole = t > 0 ? 'var(--atheist)' : 'var(--theist)';
  return a < 4 ? 'var(--mid)' : `color-mix(in oklab, ${pole} ${Math.max(18, a)}%, var(--mid))`;
}
function heatmap(w, ds) {
  const left = Math.min(180, w * 0.25), top = 26, cols = CRIT_ALL.length, cellW = Math.max(56, (w - left) / cols), cellH = 28, gap = 2;
  const h = top + ds.length * cellH;
  const gaps = ds.flatMap(d => CRIT_ALL.map(k => d.crit.atheist[k] - d.crit.theist[k]));
  const max = Math.max(1, ...gaps.map(Math.abs));
  let g = '';
  CRIT_ALL.forEach((k, j) => g += `<text x="${left + j * cellW + (cellW - gap) / 2}" y="${top - 10}" class="ax" text-anchor="middle" font-weight="${k === 'overall' ? 700 : 400}">${CRIT_LABEL[k]}</text>`);
  ds.forEach((d, i) => {
    const y = top + i * cellH;
    g += `<text x="${left - 12}" y="${y + cellH / 2 + 3}" class="lbl clickable" text-anchor="end" data-go="/topic/${d.id}">${esc(trunc(d.short, 24))}</text>`;
    CRIT_ALL.forEach((k, j) => {
      const v = d.crit.atheist[k] - d.crit.theist[k], fill = divColor(v, max), strong = Math.abs(v) / max > 0.55;
      const tt = `<div class="tt-title">${esc(d.short)} · ${CRIT_LABEL[k]}</div>${ttRow('Theist', r2(d.crit.theist[k]), 'theist')}${ttRow('Atheist', r2(d.crit.atheist[k]), 'atheist')}<div class="tt-muted">Gap ${signed(v)} (${v > 0 ? 'atheist' : v < 0 ? 'theist' : 'even'})</div>`;
      g += `<rect x="${left + j * cellW}" y="${y}" width="${cellW - gap}" height="${cellH - gap}" rx="4" style="fill:${fill}" class="clickable" data-go="/topic/${d.id}" ${tipAttr(tt)}/>`;
      if (cellW > 44) g += `<text x="${left + j * cellW + (cellW - gap) / 2}" y="${y + cellH / 2 + 3}" text-anchor="middle" font-size="11" pointer-events="none" fill="${strong ? '#fff' : 'var(--text-primary)'}" style="font-variant-numeric:tabular-nums">${Math.abs(v) < 0.05 ? '0' : signed(v)}</text>`;
    });
  });
  return svgWrap(w, h, g, 'Criterion heatmap');
}

function butterfly(w, ds) {
  const mid = w / 2, labelW = 0, rowH = 24, barH = 12, top = 22;
  const h = top + ds.length * rowH + 4;
  const max = Math.max(3, ...ds.flatMap(d => [d.concW.theist, d.concW.atheist]));
  const half = mid - 90;
  const sc = v => v / max * half;
  let g = `<text x="${mid - 80}" y="12" class="ax" text-anchor="end">← theist conceded</text><text x="${mid + 80}" y="12" class="ax">atheist conceded →</text>`;
  ds.forEach((d, i) => {
    const y = top + i * rowH, yc = y + (rowH - barH) / 2;
    const tt = `<div class="tt-title">${esc(d.short)}</div>${ttRow('Theist conceded', `${d.conc.theist.length} (wt ${d.concW.theist})`, 'theist')}${ttRow('Atheist conceded', `${d.conc.atheist.length} (wt ${d.concW.atheist})`, 'atheist')}`;
    g += `<g class="clickable" data-go="/topic/${d.id}" ${tipAttr(tt)}><rect x="0" y="${y}" width="${w}" height="${rowH}" fill="transparent" class="row-hit" rx="5"/>
      <text x="${mid}" y="${y + rowH / 2 + 4}" class="lbl" text-anchor="middle">${esc(trunc(d.short, 18))}</text>
      <path d="${hbar(mid - 76, mid - 76 - sc(d.concW.theist), yc, barH)}" class="f-theist"/>
      <path d="${hbar(mid + 76, mid + 76 + sc(d.concW.atheist), yc, barH)}" class="f-atheist"/>
      ${d.concW.theist ? `<text x="${mid - 82 - sc(d.concW.theist)}" y="${yc + barH - 1}" class="val" text-anchor="end">${d.concW.theist}</text>` : ''}
      ${d.concW.atheist ? `<text x="${mid + 82 + sc(d.concW.atheist)}" y="${yc + barH - 1}" class="val">${d.concW.atheist}</text>` : ''}</g>`;
  });
  return svgWrap(w, h, g, 'Concessions butterfly chart');
}

function scatter(w, ds) {
  const left = 40, bottom = 34, top = 10, right = 14, h = Math.max(300, ds.length * 24 + 26);
  const pts = ds.flatMap(d => SIDES.map(s => ({ d, s, x: d.concW[s], y: d.score[s] })));
  const xmax = Math.max(4, ...pts.map(p => p.x)) + 1;
  const ylo = Math.max(1, Math.floor(Math.min(...pts.map(p => p.y)) - 1)), yhi = 10;
  const X = lin(0, xmax, left, w - right), Y = lin(ylo, yhi, h - bottom, top);
  let g = '';
  for (let v = ylo; v <= yhi; v++) g += `<line x1="${left}" x2="${w - right}" y1="${Y(v)}" y2="${Y(v)}" class="gridline"/><text x="${left - 8}" y="${Y(v) + 4}" class="ax" text-anchor="end">${v}</text>`;
  const step = xmax > 12 ? 4 : 2;
  for (let v = 0; v <= xmax; v += step) g += `<text x="${X(v)}" y="${h - bottom + 16}" class="ax" text-anchor="middle">${v}</text>`;
  g += `<line x1="${left}" x2="${w - right}" y1="${h - bottom}" y2="${h - bottom}" class="baseline"/>`;
  g += `<text x="${(left + w - right) / 2}" y="${h - 4}" class="ax" text-anchor="middle">weighted concessions given →</text>`;
  // simple trend per side
  SIDES.forEach(s => {
    const p = pts.filter(q => q.s === s); if (p.length < 3) return;
    const mx = mean(p.map(q => q.x)), my = mean(p.map(q => q.y));
    const sxx = p.reduce((a, q) => a + (q.x - mx) ** 2, 0); if (!sxx) return;
    const b = p.reduce((a, q) => a + (q.x - mx) * (q.y - my), 0) / sxx, a0 = my - b * mx;
    g += `<line x1="${X(0)}" y1="${Y(a0)}" x2="${X(xmax)}" y2="${Y(a0 + b * xmax)}" class="s-${s}" stroke-width="2" stroke-opacity="0.45" stroke-dasharray="0" />`;
  });
  pts.forEach(p => {
    const tt = `<div class="tt-title">${esc(p.d.short)} · ${SIDE_LABEL[p.s]}</div>${ttRow('Concessions (wt)', p.x, p.s)}${ttRow('Panel score', r2(p.y), p.s)}`;
    g += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="6" class="f-${p.s} ring clickable" data-go="/topic/${p.d.id}" ${tipAttr(tt)}/>`;
  });
  return svgWrap(w, h, g, 'Concessions vs score scatter');
}

function judgeAgreement(w, ds) {
  const left = Math.min(150, w * 0.3), right = 20, top = 24, rowH = 26;
  const h = top + ds.length * rowH + 4;
  const ms = ds.flatMap(d => d.judges.map(j => j.scores.atheist.overall - j.scores.theist.overall));
  const max = Math.max(2, Math.ceil(Math.max(...ms.map(Math.abs))));
  const X = lin(-max, max, left, w - right);
  let g = `<text x="${X(-max)}" y="12" class="ax">← theist</text><text x="${X(max)}" y="12" class="ax" text-anchor="end">atheist →</text>`;
  for (let v = -max; v <= max; v++) g += `<line x1="${X(v)}" x2="${X(v)}" y1="${top - 4}" y2="${h}" class="${v === 0 ? 'baseline' : 'gridline'}"/>`;
  ds.forEach((d, i) => {
    const y = top + i * rowH + rowH / 2;
    const vals = d.judges.map(j => ({ j: j.judge, v: j.scores.atheist.overall - j.scores.theist.overall, win: j.winner }));
    const lo = Math.min(...vals.map(v => v.v)), hi = Math.max(...vals.map(v => v.v));
    const tt = `<div class="tt-title">${esc(d.short)}</div>` + vals.map(v => ttRow(JUDGE_LABEL[v.j] || v.j, `${signed(v.v)} → ${SIDE_LABEL[v.win]}`, v.win === 'draw' ? 'draw' : v.win)).join('') + `<div class="tt-muted">Spread ${r2(hi - lo)}</div>`;
    g += `<g class="clickable" data-go="/topic/${d.id}" ${tipAttr(tt)}><rect x="0" y="${y - rowH / 2}" width="${w}" height="${rowH}" fill="transparent" class="row-hit" rx="5"/>
      <text x="${left - 12}" y="${y + 4}" class="lbl" text-anchor="end">${esc(trunc(d.short, 20))}</text>
      <line x1="${X(lo)}" x2="${X(hi)}" y1="${y}" y2="${y}" stroke="var(--axis)" stroke-width="6" stroke-linecap="round"/>
      ${vals.map(v => shape(JUDGE_SHAPE[v.j] || 'circle', X(v.v), y, 5, v.v > 0.001 ? 'f-atheist ring' : v.v < -0.001 ? 'f-theist ring' : 'f-neutral ring')).join('')}</g>`;
  });
  return svgWrap(w, h, g, 'Judge agreement');
}

function roundsChart(w, ds) {
  const left = 30, bottom = 40, top = 22, h = 260;
  const n = ds.length, slot = (w - left) / n, bw = Math.min(24, slot * 0.6);
  const Y = lin(0, 20, h - bottom, top);
  let g = '';
  for (let v = 0; v <= 20; v += 5) g += `<line x1="${left}" x2="${w}" y1="${Y(v)}" y2="${Y(v)}" class="gridline"/><text x="${left - 8}" y="${Y(v) + 4}" class="ax" text-anchor="end">${v}</text>`;
  ds.forEach((d, i) => {
    const cx = left + i * slot + slot / 2;
    const cls = d.endReason.endsWith('_conceded') ? 'f-' + (d.conceded === 'theist' ? 'atheist' : 'theist') : 'f-neutral';
    const tt = `<div class="tt-title">#${d.id} ${esc(d.short)}</div>${d.rounds} rounds · ${d.turns.length} speeches<div class="tt-muted">${END_LABEL[d.endReason] || d.endReason}</div>`;
    g += `<g class="clickable" data-go="/topic/${d.id}" ${tipAttr(tt)}><rect x="${cx - slot / 2}" y="${top - 18}" width="${slot}" height="${h - top - bottom + 40}" fill="transparent" class="row-hit"/>
      <path d="${vbar(cx - bw / 2, bw, Y(0), Y(d.rounds))}" class="${cls}"/>
      <text x="${cx}" y="${Y(d.rounds) - 6}" text-anchor="middle" class="val">${END_GLYPH[d.endReason] || ''}${d.rounds}</text>
      <text x="${cx}" y="${h - bottom + 16}" text-anchor="middle" class="ax">${d.id}</text></g>`;
  });
  g += `<line x1="${left}" x2="${w}" y1="${Y(0)}" y2="${Y(0)}" class="baseline"/><text x="${(left + w) / 2}" y="${h - 4}" class="ax" text-anchor="middle">topic #</text>`;
  return svgWrap(w, h, g, 'Rounds per debate');
}

function normFallacy(n) {
  let s = n.toLowerCase().replace(/\(.*?\)/g, '').replace(/fallacy/g, '').replace(/[^a-z\s-]/g, '').replace(/\s+/g, ' ').trim();
  const map = [[/straw/, 'Straw man'], [/special plead/, 'Special pleading'], [/god of the gaps|argument from ignorance|ignorance/, 'Argument from ignorance'], [/beg|circular/, 'Begging the question / circular'], [/goal ?post/, 'Moving the goalposts'], [/false (dilemma|dichotomy)|either/, 'False dilemma'], [/authority/, 'Appeal to authority'], [/popular|ad populum|consensus/, 'Appeal to popularity'], [/red herring/, 'Red herring'], [/ad hominem|genetic/, 'Ad hominem / genetic'], [/equivoc/, 'Equivocation'], [/hasty|overgeneral/, 'Hasty generalization'], [/composition|division/, 'Composition / division'], [/burden/, 'Shifting the burden'], [/no true/, 'No true Scotsman'], [/slippery/, 'Slippery slope'], [/anachron|presentism/, 'Anachronism / presentism'], [/emotion|pity/, 'Appeal to emotion'], [/non sequitur/, 'Non sequitur'], [/cherry|suppress/, 'Cherry picking'], [/tu quoque|whatabout/, 'Tu quoque']];
  for (const [re, label] of map) if (re.test(s)) return label;
  return s ? s[0].toUpperCase() + s.slice(1) : 'Other';
}
function stackedH(w, rows, emptyMsg, ariaLabel) {
  if (!rows.length) return `<p class="empty">${emptyMsg}</p>`;
  const left = Math.min(200, w * 0.42), rowH = 26, barH = 14, h = rows.length * rowH + 4;
  const max = Math.max(...rows.map(r => r.theist + r.atheist));
  const X = lin(0, max, left, w - 34);
  let g = '';
  rows.forEach((r, i) => {
    const y = i * rowH + (rowH - barH) / 2;
    const tt = `<div class="tt-title">${esc(r.label)}</div>${ttRow('Theist', r.theist, 'theist')}${ttRow('Atheist', r.atheist, 'atheist')}`;
    g += `<g ${tipAttr(tt)}><rect x="0" y="${i * rowH}" width="${w}" height="${rowH}" fill="transparent" class="row-hit" rx="5"/><text x="${left - 12}" y="${y + barH - 2}" class="lbl" text-anchor="end">${esc(trunc(r.label, 30))}</text>`;
    const xt = X(r.theist);
    if (r.theist) g += r.atheist ? `<rect x="${left}" y="${y}" width="${Math.max(0, xt - left - 1)}" height="${barH}" class="f-theist"/>` : `<path d="${hbar(left, xt, y, barH)}" class="f-theist"/>`;
    if (r.atheist) g += `<path d="${hbar(r.theist ? xt + 1 : left, X(r.theist + r.atheist), y, barH)}" class="f-atheist"/>`;
    g += `<text x="${X(r.theist + r.atheist) + 6}" y="${y + barH - 2}" class="val">${r.theist + r.atheist}</text></g>`;
  });
  g += `<line x1="${left}" x2="${left}" y1="0" y2="${h}" class="baseline"/>`;
  return svgWrap(w, h, g, ariaLabel);
}
function fallacyBars(w, ds) {
  const m = {};
  ds.forEach(d => d.fallacies.forEach(f => { const k = normFallacy(f.name); (m[k] ||= { label: k, theist: 0, atheist: 0 })[f.side]++; }));
  const rows = Object.values(m).sort((a, b) => (b.theist + b.atheist) - (a.theist + a.atheist)).slice(0, 10);
  return stackedH(w, rows, 'No fallacies flagged.', 'Fallacies by type');
}
function sourceBars(w, ds) {
  const m = {};
  const label = { scripture: 'Scripture', scholarship: 'Scholarship', archaeology: 'Archaeology', manuscript: 'Manuscripts', ancient_source: 'Ancient sources', philosophy: 'Philosophy', science: 'Science', other: 'Other' };
  ds.forEach(d => SIDES.forEach(s => d.sources[s].forEach(x => { const k = label[x.kind] || 'Other'; (m[k] ||= { label: k, theist: 0, atheist: 0 })[s]++; })));
  const rows = Object.values(m).sort((a, b) => (b.theist + b.atheist) - (a.theist + a.atheist));
  return stackedH(w, rows, 'No sources recorded.', 'Sources by type');
}

function highlightReel(ds) {
  const seen = new Set(), items = [];
  ds.forEach(d => d.highlights.forEach(h => {
    const k = d.id + '|' + h.quote.slice(0, 40).toLowerCase();
    if (seen.has(k)) return; seen.add(k); items.push({ ...h, d });
  }));
  // interleave so each debate is represented
  items.sort((a, b) => a.d.id - b.d.id || a.round - b.round);
  const shown = items.slice(0, state.q ? 60 : 24);
  if (!shown.length) return '<p class="empty">No highlights.</p>';
  return shown.map(h => `<button class="hl ${h.side}" data-go="/topic/${h.d.id}/r${h.round}">
    <span class="meta">${dot(h.side)}${SIDE_LABEL[h.side]} · R${h.round} · ${esc(h.d.short)}</span>
    <q>${esc(h.quote)}</q><span class="why">${esc(h.why)}</span><span class="meta">picked by ${esc(JUDGE_LABEL[h.judge] || h.judge)}</span></button>`).join('') +
    (items.length > shown.length ? `<p class="empty">+${items.length - shown.length} more inside individual debates</p>` : '');
}

function leaderboard(ds) {
  const cols = [
    ['id', '#', d => d.id, true], ['short', 'Topic', d => d.short], ['category', 'Category', d => d.category],
    ['rounds', 'Rounds', d => d.rounds, true], ['end', 'Ended by', d => END_LABEL[d.endReason] || d.endReason],
    ['t', 'Theist', d => d.score.theist, true], ['a', 'Atheist', d => d.score.atheist, true], ['gap', 'Margin', d => Math.abs(d.gap), true],
    ['conc', 'Concessions T/A', d => d.conc.theist.length - d.conc.atheist.length, true], ['winner', 'Winner', d => d.winner],
  ];
  const col = cols.find(c => c[0] === state.sort.key) || cols[0];
  const rows = [...ds].sort((a, b) => { const x = col[2](a), y = col[2](b); return (x > y ? 1 : x < y ? -1 : 0) * state.sort.dir; });
  return `<div style="overflow-x:auto"><table class="lb"><thead><tr>${cols.map(c => `<th data-sort="${c[0]}" class="${c[3] ? 'num' : ''}">${c[1]}${state.sort.key === c[0] ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>
  ${rows.map(d => `<tr data-go="/topic/${d.id}"><td class="num">${d.id}</td><td>${esc(d.short)}</td><td>${d.category}</td><td class="num">${d.rounds}</td><td>${END_LABEL[d.endReason] || d.endReason}</td>
    <td class="num">${r2(d.score.theist)}</td><td class="num">${r2(d.score.atheist)}</td><td class="num">${r2(Math.abs(d.gap))}</td><td class="num">${d.conc.theist.length} / ${d.conc.atheist.length}</td>
    <td><span class="pill ${d.winner}">${dot(d.winner)}${SIDE_LABEL[d.winner]} ${d.votes.theist}–${d.votes.atheist}${d.votes.draw ? '–' + d.votes.draw : ''}</span></td></tr>`).join('')}
  </tbody></table></div>`;
}

// ---------- TOPIC ----------
function renderTopic(id, jumpRound) {
  chartJobs = [];
  const d = ALL.find(x => x.id === id);
  const app = $('#app');
  if (!d) { app.innerHTML = `<a class="back" href="/debates">← All debates</a><div class="card"><p class="empty">Debate #${id} not found.</p></div>`; return; }
  const idx = ALL.indexOf(d), prev = ALL[idx - 1], next = ALL[idx + 1];
  const tab = state.judgeTab[id] || d.judges[0]?.judge;
  const q = state.q.toLowerCase();

  const hlQuotes = d.highlights.map(h => h.quote).filter(Boolean);
  const markSpeech = (html) => {
    let out = html;
    for (const hq of hlQuotes) {
      const e = esc(hq).trim(); if (e.length < 12) continue;
      const i = out.indexOf(e); if (i >= 0) out = out.slice(0, i) + `<mark class="hlq" title="Judge highlight">${e}</mark>` + out.slice(i + e.length);
    }
    if (q.length > 1) out = out.replace(new RegExp(`(?![^<]*>)(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
    return out;
  };

  const byRound = {};
  d.turns.forEach(t => (byRound[t.round] ||= []).push(t));
  const roundsList = Object.keys(byRound).map(Number).sort((a, b) => a - b);

  const winnerText = d.winner === 'draw' ? 'Draw' : `${SIDE_LABEL[d.winner]} wins`;
  app.innerHTML = `
  <a class="back" href="/debates">← All debates</a>
  <section class="topic-head">
    <div>
      <div class="eyebrow">Debate #${d.id} · ${d.category}</div>
      <h1>${esc(d.short)}</h1>
      <p class="res">Resolved: “${esc(d.resolution)}”</p>
      <div class="badges">
        <span class="pill ${d.winner}">${dot(d.winner)}${winnerText} · panel ${d.votes.theist}–${d.votes.atheist}${d.votes.draw ? '–' + d.votes.draw : ''}</span>
        <span class="pill">${d.rounds} rounds · ${d.turns.length} speeches</span>
        <span class="pill">${END_GLYPH[d.endReason] || ''} ${END_LABEL[d.endReason] || d.endReason}</span>
        <span class="pill">${d.conc.theist.length + d.conc.atheist.length} concessions</span>
      </div>
    </div>
    <div class="score-duel">
      ${SIDES.map(s => `<div class="duel ${s}"><div class="side">${SIDE_LABEL[s]}</div><div class="score">${r2(d.score[s])}<small>/10</small></div>${d.winner === s ? '<span class="crown">▲ winner</span>' : ''}<div style="font-size:12px;color:var(--text-muted)">rubric-weighted ${r2(d.rubric[s])}</div></div>`).join('')}
    </div>
  </section>

  <section class="grid">
    <div class="card span-5">
      <div class="card-head"><div><h2>Panel scorecard</h2><p class="sub">Each judge's score (T = theist, A = atheist)</p></div></div>
      ${scorecard(d)}
    </div>
    <div class="card span-7">
      <div class="card-head"><div><h2>Criteria head-to-head</h2><p class="sub">Average of the three judges</p></div>${legend2()}</div>
      ${chart('t-crit', w => criteriaBars(w, [d.crit]))}
    </div>

    <div class="card span-7">
      <div class="card-head"><div><h2>Confidence over the debate</h2><p class="sub">Average stated confidence in each debater's claims per round. ◆ = concession made that round.</p></div>${legend2()}</div>
      ${chart('t-conf', w => confidenceLine(w, d))}
    </div>
    <div class="card span-5">
      <div class="card-head"><div><h2>Verdicts</h2></div></div>
      <div class="tabs" role="tablist">${d.judges.map(j => `<button class="tab" role="tab" data-jtab="${j.judge}" aria-selected="${j.judge === tab}">${judgeName(j)}</button>`).join('')}</div>
      ${d.judges.filter(j => j.judge === tab).map(j => `<div class="winline">${dot(j.winner === 'draw' ? 'draw' : j.winner)}<b>${j.winner === 'draw' ? 'Draw' : SIDE_LABEL[j.winner] + ' wins'}</b><span class="tt-muted" style="color:var(--text-muted)">· ${j.margin} margin · turning point R${j.turning_point.round}</span></div>
        <div class="verdict">${md(j.verdict)}</div>
        <div class="verdict" style="font-size:13px"><b>Turning point:</b> ${esc(j.turning_point.description)}</div>`).join('')}
    </div>

    <div class="card span-12">
      <div class="card-head"><div><h2>Best arguments & what went unanswered</h2><p class="sub">From the panel</p></div></div>
      <div class="two-col">
        ${SIDES.map(s => `<div><h3>${dot(s)}${SIDE_LABEL[s]}</h3><ul class="list">
          ${d.judges.map(j => `<li class="${s}"><div class="meta"><b>Best argument</b> · ${JUDGE_LABEL[j.judge] || j.judge}</div>${esc(j.best_argument[s])}</li>`).join('')}
          ${(() => { const u = [...new Set(d.judges.flatMap(j => j.unanswered[s] || []))]; return u.length ? `<li class="${s}"><div class="meta"><b>Left unanswered by the opponent</b></div><ul style="margin:4px 0 0;padding-left:18px">${u.map(x => `<li style="background:none;padding:2px 0;border:0">${esc(x)}</li>`).join('')}</ul></li>` : ''; })()}
        </ul></div>`).join('')}
      </div>
    </div>

    <div class="card span-4">
      <h2>Key concessions</h2><p class="sub">As identified by the judges</p>
      ${issueList(dedupe(d.keyConc, x => x.point), x => `<div class="meta">${dot(x.side)}<b>${SIDE_LABEL[x.side]}</b> · R${x.round} <span class="sev ${x.impact}">${x.impact}</span></div>${esc(x.point)}`, 'No concessions identified.')}
    </div>
    <div class="card span-4">
      <h2>Fallacies flagged</h2><p class="sub">${d.fallacies.length} flags across 3 judges</p>
      ${issueList(d.fallacies, x => `<div class="meta">${dot(x.side)}<b>${esc(x.name)}</b> · R${x.round} · ${JUDGE_LABEL[x.judge] || x.judge}</div><q>${esc(x.quote)}</q><div style="margin-top:4px;color:var(--text-secondary)">${esc(x.explanation)}</div>`, 'No fallacies flagged.')}
    </div>
    <div class="card span-4">
      <h2>Factual errors</h2><p class="sub">${d.errors.length} flags across 3 judges</p>
      ${issueList(d.errors, x => `<div class="meta">${dot(x.side)}<b>${SIDE_LABEL[x.side]}</b> · R${x.round} <span class="sev ${x.severity}">${x.severity}</span> · ${JUDGE_LABEL[x.judge] || x.judge}</div><q>${esc(x.claim)}</q><div style="margin-top:4px;color:var(--text-secondary)"><b>Correction:</b> ${esc(x.correction)}</div>`, 'No factual errors flagged.')}
    </div>

    <div class="card span-12">
      <div class="card-head"><div><h2>Sources cited</h2><p class="sub">${d.sources.theist.length} by the theist · ${d.sources.atheist.length} by the atheist</p></div></div>
      <div class="two-col">${SIDES.map(s => `<div><h3>${dot(s)}${SIDE_LABEL[s]}</h3>${sourceList(d.sources[s])}</div>`).join('')}</div>
    </div>

    <div class="card span-12">
      <div class="card-head"><div><h2>Full transcript</h2><p class="sub">Judge highlights are underlined; concessions are boxed in amber${q ? `; matches for “${esc(state.q)}” highlighted` : ''}.</p></div>${legend2()}</div>
      <div class="transcript-wrap">
        <nav class="round-nav" aria-label="Rounds">${roundsList.map(r => `<a href="/topic/${d.id}/r${r}" class="${byRound[r].some(t => t.concessions.length) ? 'has-c' : ''}">R${r}</a>`).join('')}</nav>
        <div>${roundsList.map(r => `<div class="round" id="round-${r}">
          <div class="round-title">Round ${r} · ${byRound[r][0].type === 'opening' ? 'Opening statements' : byRound[r][0].type === 'closing' ? 'Closing statements' : 'Exchange'}</div>
          <div class="turns">${byRound[r].map(t => turnCard(t, markSpeech, byRound[r].length === 1)).join('')}</div></div>`).join('')}
        </div>
      </div>
    </div>
  </section>
  <nav class="filters" style="margin-top:20px;justify-content:space-between">
    ${prev ? `<a class="chip" href="/topic/${prev.id}">← #${prev.id} ${esc(prev.short)}</a>` : '<span></span>'}
    ${next ? `<a class="chip" href="/topic/${next.id}">#${next.id} ${esc(next.short)} →</a>` : '<span></span>'}
  </nav>`;

  $$('[data-jtab]').forEach(b => b.onclick = () => { state.judgeTab[id] = b.dataset.jtab; const y = scrollY; renderTopic(id, null); scrollTo(0, y); });
  drawCharts();
  if (jumpRound) { const el = document.getElementById('round-' + jumpRound); if (el) el.scrollIntoView({ block: 'start' }); }
  else window.scrollTo(0, 0);
}

function dedupe(arr, key) { const s = new Set(); return arr.filter(x => { const k = key(x).toLowerCase().slice(0, 50); if (s.has(k)) return false; s.add(k); return true; }); }
function issueList(items, fmt, empty) { return items.length ? `<ul class="list">${items.map(x => `<li class="${x.side}">${fmt(x)}</li>`).join('')}</ul>` : `<p class="empty">${empty}</p>`; }
function sourceList(src) {
  if (!src.length) return '<p class="empty">None recorded.</p>';
  const by = {}; src.forEach(s => (by[s.kind] ||= new Set()).add(s.citation));
  return Object.entries(by).sort((a, b) => b[1].size - a[1].size).map(([k, set]) => `<details class="src" open><summary>${esc(k.replace('_', ' '))} (${set.size})</summary><ul>${[...set].map(c => `<li>${esc(c)}</li>`).join('')}</ul></details>`).join('');
}

function scorecard(d) {
  const js = d.judges;
  const cell = (s, k, j) => { const v = j.scores[s][k], o = j.scores[s === 'theist' ? 'atheist' : 'theist'][k]; return `<td class="${v > o ? 'better' : ''}">${v}</td>`; };
  return `<table class="scorecard"><thead><tr><th>Criterion</th>${js.map(j => `<th colspan="2">${JUDGE_LABEL[j.judge] || j.judge}${j.model ? `<br><span style="font-weight:400">${MODEL_LABEL[j.model] || j.model}</span>` : ''}</th>`).join('')}</tr>
    <tr><th></th>${js.map(() => `<th>${dot('theist')}</th><th>${dot('atheist')}</th>`).join('')}</tr></thead><tbody>
    ${CRIT_ALL.map(k => `<tr><td>${CRIT_LABEL[k]}</td>${js.map(j => cell('theist', k, j) + cell('atheist', k, j)).join('')}</tr>`).join('')}
    <tr><td><b>Rubric-weighted</b></td>${js.map(j => `<td class="${j.weighted.theist > j.weighted.atheist ? 'better' : ''}">${r1(j.weighted.theist)}</td><td class="${j.weighted.atheist > j.weighted.theist ? 'better' : ''}">${r1(j.weighted.atheist)}</td>`).join('')}</tr>
    <tr><td><b>Vote</b></td>${js.map(j => `<td colspan="2">${dot(j.winner === 'draw' ? 'draw' : j.winner)} ${SIDE_LABEL[j.winner]}</td>`).join('')}</tr>
    </tbody></table>`;
}

function turnCard(t, markSpeech, solo) {
  return `<article class="turn ${t.side}${solo ? ' solo' : ''}">
    <div class="turn-head"><span class="who">${dot(t.side)}${SIDE_LABEL[t.side]}</span><span class="type">${t.type}</span></div>
    <div class="speech">${markSpeech(md(t.speech))}</div>
    <div class="turn-foot">
      ${t.concessions.length ? `<div class="concede"><b>Concedes:</b> ${t.concessions.map(c => `${esc(c.point)} <span class="sev ${c.significance}">${c.significance}</span>`).join(' · ')}</div>` : ''}
      ${t.questions.length ? `<div class="qs"><b>Asks:</b> ${t.questions.map(esc).join(' <span style="color:var(--text-muted)">|</span> ')}</div>` : ''}
      ${t.signal && t.signal !== 'continue' ? `<div class="signal"><span class="pill">${t.signal === 'propose_closing' ? '⇄ proposes closing' : '⚑ concedes resolution'}</span>${esc(t.signal_reason)}</div>` : ''}
      ${t.claims.length ? `<details class="src"><summary>Claims & stated confidence (${t.claims.length})</summary><div class="claims" style="margin-top:6px">${t.claims.map(c => `<div class="claim"><span>${esc(c.claim)}</span><span class="conf" ${tipAttr(`${c.confidence}% confident`)}><i style="width:${c.confidence}%"></i></span></div>`).join('')}</div></details>` : ''}
      ${t.sources.length ? `<details class="src"><summary>Sources (${t.sources.length})</summary><ul>${t.sources.map(s => `<li>${esc(s.citation)} <span style="color:var(--text-muted)">· ${esc(s.kind.replace('_', ' '))}</span></li>`).join('')}</ul></details>` : ''}
    </div></article>`;
}

function confidenceLine(w, d) {
  const left = 36, right = 16, top = 14, bottom = 30, h = 240;
  const R = d.rounds, X = lin(1, Math.max(2, R), left, w - right);
  const vals = SIDES.flatMap(s => Object.values(d.conf[s]));
  const lo = Math.max(0, Math.floor((Math.min(...vals, 100) - 10) / 10) * 10);
  const Y = lin(lo, 100, h - bottom, top);
  let g = '';
  for (let v = lo; v <= 100; v += 10) g += `<line x1="${left}" x2="${w - right}" y1="${Y(v)}" y2="${Y(v)}" class="gridline"/><text x="${left - 8}" y="${Y(v) + 4}" class="ax" text-anchor="end">${v}</text>`;
  const step = R > 12 ? 2 : 1;
  for (let r = 1; r <= R; r += step) g += `<text x="${X(r)}" y="${h - bottom + 16}" class="ax" text-anchor="middle">R${r}</text>`;
  SIDES.forEach(s => {
    const pts = Object.entries(d.conf[s]).map(([r, v]) => [X(+r), Y(v)]);
    if (pts.length > 1) g += `<path d="M${pts.map(p => p.join(',')).join('L')}" fill="none" class="s-${s}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const concRounds = new Set(d.conc[s].map(c => c.round));
    Object.entries(d.conf[s]).forEach(([r, v]) => {
      const cx = X(+r), cy = Y(v);
      g += concRounds.has(+r)
        ? `<path d="M${cx},${cy - 7}L${cx + 7},${cy}L${cx},${cy + 7}L${cx - 7},${cy}Z" class="f-${s} ring"/>`
        : `<circle cx="${cx}" cy="${cy}" r="4" class="f-${s} ring"/>`;
    });
  });
  g += `<line x1="${left}" x2="${w - right}" y1="${h - bottom}" y2="${h - bottom}" class="baseline"/>`;
  g += `<line class="xhair" x1="0" x2="0" y1="${top}" y2="${h - bottom}" stroke="var(--text-muted)" stroke-width="1" visibility="hidden"/>`;
  g += `<rect class="line-overlay" x="${left}" y="${top}" width="${w - left - right}" height="${h - top - bottom}" fill="transparent" data-left="${left}" data-right="${w - right}" data-r="${R}" data-id="${d.id}"/>`;
  return svgWrap(w, h, g, 'Confidence over rounds');
}
function bindLineCharts() {
  $$('.line-overlay').forEach(ov => {
    const svg = ov.ownerSVGElement, xh = svg.querySelector('.xhair');
    const L = +ov.dataset.left, Rt = +ov.dataset.right, R = +ov.dataset.r, d = ALL.find(x => x.id === +ov.dataset.id);
    ov.onmousemove = e => {
      const bb = svg.getBoundingClientRect(), px = e.clientX - bb.left;
      const r = Math.max(1, Math.min(R, Math.round(1 + (px - L) / ((Rt - L) / Math.max(1, R - 1)))));
      const x = L + (r - 1) * (Rt - L) / Math.max(1, R - 1);
      xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible');
      const cs = SIDES.map(s => d.conc[s].filter(c => c.round === r).length);
      tip.innerHTML = `<div class="tt-title">Round ${r}</div>` + SIDES.map((s, i) => ttRow(SIDE_LABEL[s], d.conf[s][r] != null ? `${Math.round(d.conf[s][r])}%${cs[i] ? ` · ${cs[i]} concession${cs[i] > 1 ? 's' : ''}` : ''}` : '—', s)).join('');
      tip.hidden = false;
    };
    ov.onmouseleave = () => { xh.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    ov.onclick = () => { const r = xh.getAttribute('x1'); go(`/topic/${d.id}/r${Math.max(1, Math.min(R, Math.round(1 + (r - L) / ((Rt - L) / Math.max(1, R - 1)))))}`, true); };
    ov.style.cursor = 'pointer';
  });
}

// ================= EVIDENCE REVIEWS =================
const TOPICS = (RAW.topics || []).slice().sort((a, b) => a.id - b.id);
const REVIEWS = Object.fromEntries((RAW.reviews || []).map(r => [r.topic.id, r]));
const MODEL_SHAPE = { gpt: 'circle', gemini: 'square', grok: 'triangle', opus: 'diamond' };
const MODEL_NAMES = { gpt: 'GPT-6.1', gemini: 'Gemini 3.8', grok: 'Grok 4.7', opus: 'Opus 5.5' };
const MODEL_IDS = Object.keys(MODEL_NAMES);
const rvState = { cat: 'all', tab: {}, sort: 'id' };

function band(c) {
  if (c >= 90) return 'Very likely true';
  if (c >= 70) return 'Likely true';
  if (c >= 56) return 'Leans true';
  if (c >= 45) return 'Toss-up';
  if (c >= 31) return 'Leans false';
  if (c >= 11) return 'Likely false';
  return 'Very likely false';
}
const bandSide = c => c >= 56 ? 'theist' : c <= 44 ? 'atheist' : 'draw';
function credColor(c) { // diverging: orange (claim false) · neutral · blue (claim true)
  const t = Math.min(1, Math.abs(c - 50) / 50);
  const v = c >= 50 ? 'var(--theist)' : 'var(--atheist)';
  return t < 0.12 ? 'var(--mid)' : `color-mix(in oklab, ${v} ${Math.round(25 + t * 75)}%, var(--mid))`;
}
const modelMark = (id, cx, cy, s, extra = '') => shape(MODEL_SHAPE[id], cx, cy, s, 'mmark', extra);
const modelLegend = () => `<div class="legend">${MODEL_IDS.map(id => `<span><svg width="12" height="12">${modelMark(id, 6, 6, 4.5)}</svg>${MODEL_NAMES[id]}</span>`).join('')}<span><svg width="10" height="12"><rect x="4" y="0" width="2.5" height="12" fill="var(--text-primary)"/></svg>Median</span></div>`;
const credLegend = () => `<div class="legend"><span><i class="sw" style="background:var(--atheist)"></i>Claim false</span><span><i class="sw" style="background:var(--mid)"></i>Toss-up</span><span><i class="sw" style="background:var(--theist)"></i>Claim true</span></div>`;
const reviewText = (t, r) => (t.short + ' ' + t.question + ' ' + t.claim + ' ' + (r ? JSON.stringify(r.analyses) + JSON.stringify(r.synthesis || {}) : '')).toLowerCase();

// strip chart: one row per topic, 0-100 axis, 4 model marks + median tick
function credStrip(w, rows) {
  const left = Math.min(230, w * 0.34), right = 18, top = 26, rowH = 34;
  const h = top + rows.length * rowH + 8;
  const x = lin(0, 100, left, w - right);
  let g = '';
  [0, 25, 50, 75, 100].forEach(v => {
    g += `<line x1="${x(v)}" x2="${x(v)}" y1="${top - 6}" y2="${h - 8}" class="gridline" ${v === 50 ? 'stroke-dasharray="3 3"' : ''}/>`;
    g += `<text x="${x(v)}" y="${top - 10}" class="tick" text-anchor="middle">${v}%</text>`;
  });
  rows.forEach(({ t, r }, i) => {
    const y = top + i * rowH, cy = y + rowH / 2;
    g += `<rect x="0" y="${y}" width="${w}" height="${rowH}" class="row-hit clickable" fill="transparent" data-go="/review/${t.id}"/>`;
    g += `<text x="${left - 14}" y="${cy + 4}" class="lbl clickable" text-anchor="end" data-go="/review/${t.id}">${t.id}. ${esc(trunc(t.short, Math.max(10, Math.floor((left - 24) / 6.6))))}</text>`;
    if (!r || !r.stats) {
      g += `<text x="${x(50)}" y="${cy + 4}" class="tick" text-anchor="middle" style="pointer-events:none">not reviewed yet</text>`;
      return;
    }
    const s = r.stats;
    g += `<rect x="${x(s.min)}" y="${cy - 9}" width="${Math.max(2, x(s.max) - x(s.min))}" height="18" rx="9" fill="${credColor(s.median)}" opacity="0.55" style="pointer-events:none"/>`;
    const tt = `<div class="tt-title">${esc(t.short)}</div><div class="tt-q">${esc(t.claim)}</div>` +
      r.analyses.map(a => ttRow(`${MODEL_NAMES[a.id]}`, `${a.credence}% · ${a.verdict}`)).join('') + ttRow('Median', `${s.median}% · ${band(s.median)}`);
    r.analyses.forEach(a => { g += modelMark(a.id, x(a.credence), cy, 5.5, 'style="pointer-events:none"'); });
    g += `<rect x="${x(s.median) - 1.5}" y="${cy - 12}" width="3" height="24" rx="1" fill="var(--text-primary)" style="pointer-events:none"/>`;
    g += `<rect x="${left}" y="${y}" width="${w - left - right}" height="${rowH}" fill="transparent" class="clickable" data-go="/review/${t.id}" ${tipAttr(tt)}/>`;
  });
  return svgWrap(w, h, g, 'Each model\'s probability that the claim is true, per topic');
}

// average credence per model (bias check)
function modelLean(w, done) {
  const left = 92, right = 50, rowH = 30, top = 22, h = top + MODEL_IDS.length * rowH + 6;
  const x = lin(0, 100, left, w - right);
  let g = '';
  [0, 50, 100].forEach(v => { g += `<line x1="${x(v)}" x2="${x(v)}" y1="${top - 6}" y2="${h - 4}" class="gridline" ${v === 50 ? 'stroke-dasharray="3 3"' : ''}/><text x="${x(v)}" y="${top - 10}" class="tick" text-anchor="middle">${v}%</text>`; });
  const grand = mean(done.map(r => r.stats.median));
  MODEL_IDS.forEach((id, i) => {
    const vals = done.map(r => r.analyses.find(a => a.id === id)?.credence).filter(v => v != null);
    const m = mean(vals), dev = mean(done.map(r => { const a = r.analyses.find(a => a.id === id); return a ? a.credence - r.stats.median : 0; }));
    const cy = top + i * rowH + rowH / 2;
    g += `<g ${tipAttr(`<div class="tt-title">${MODEL_NAMES[id]}</div>` + ttRow('Average credence', `${r1(m)}%`) + ttRow('vs. topic median', `${dev >= 0 ? '+' : '−'}${r1(Math.abs(dev))} pts`) + ttRow('Topics', vals.length))}>`;
    g += `<rect x="${left}" y="${cy - 12}" width="${w - left - right}" height="24" fill="transparent"/>`;
    g += `<text x="${left - 10}" y="${cy + 4}" class="lbl" text-anchor="end">${MODEL_NAMES[id]}</text>`;
    g += `<line x1="${x(grand)}" x2="${x(m)}" y1="${cy}" y2="${cy}" stroke="var(--text-muted)" stroke-width="2"/>`;
    g += modelMark(id, x(m), cy, 6);
    g += `<text x="${x(m) + (m >= grand ? 12 : -12)}" y="${cy + 4}" class="tick" text-anchor="${m >= grand ? 'start' : 'end'}">${dev >= 0 ? '+' : '−'}${r1(Math.abs(dev))}</text></g>`;
  });
  return svgWrap(w, h, g, 'Average credence per model');
}

// agreement: spread (max − min) per topic
function spreadBars(w, done) {
  const left = Math.min(170, w * 0.4), right = 36, rowH = 24, top = 4, h = top + done.length * rowH + 22;
  const x = lin(0, 100, left, w - right);
  let g = '';
  [0, 25, 50].forEach(v => { g += `<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${h - 18}" class="gridline"/><text x="${x(v)}" y="${h - 4}" class="tick" text-anchor="middle">${v}</text>`; });
  done.forEach((r, i) => {
    const y = top + i * rowH, s = r.stats.spread;
    const lvl = s <= 15 ? 'Strong agreement' : s <= 30 ? 'Some disagreement' : 'Major disagreement';
    g += `<g class="clickable" data-go="/review/${r.topic.id}" ${tipAttr(`<div class="tt-title">${esc(r.topic.short)}</div>` + ttRow('Range', `${r.stats.min}–${r.stats.max}%`) + ttRow('Spread', `${s} pts · ${lvl}`))}>`;
    g += `<rect x="0" y="${y}" width="${w}" height="${rowH}" class="row-hit" fill="transparent"/>`;
    g += `<text x="${left - 10}" y="${y + rowH / 2 + 4}" class="lbl" text-anchor="end">${esc(trunc(r.topic.short, 20))}</text>`;
    g += `<path d="${hbar(x(0), x(Math.max(s, 0.8)), y + 5, rowH - 10)}" fill="${s <= 15 ? 'var(--text-secondary)' : s <= 30 ? 'var(--text-muted)' : 'var(--atheist)'}"/>`;
    g += `<text x="${x(Math.max(s, 0.8)) + 6}" y="${y + rowH / 2 + 4}" class="tick">${s}</text></g>`;
  });
  return svgWrap(w, h, g, 'Disagreement between models per topic');
}

// category medians
function categoryCred(w, done) {
  const rows = CATS.map(c => ({ c, rs: done.filter(r => r.topic.category === c) })).filter(o => o.rs.length);
  const left = 92, right = 50, rowH = 30, top = 22, h = top + rows.length * rowH + 6;
  const x = lin(0, 100, left, w - right);
  let g = '';
  [0, 50, 100].forEach(v => { g += `<line x1="${x(v)}" x2="${x(v)}" y1="${top - 6}" y2="${h - 4}" class="gridline" ${v === 50 ? 'stroke-dasharray="3 3"' : ''}/><text x="${x(v)}" y="${top - 10}" class="tick" text-anchor="middle">${v}%</text>`; });
  rows.forEach(({ c, rs }, i) => {
    const m = mean(rs.map(r => r.stats.median)), cy = top + i * rowH + rowH / 2;
    g += `<g ${tipAttr(`<div class="tt-title">${c}</div>` + rs.map(r => ttRow(r.topic.short, `${r.stats.median}%`)).join(''))}>`;
    g += `<rect x="${left}" y="${cy - 12}" width="${w - left - right}" height="24" fill="transparent"/>`;
    g += `<text x="${left - 10}" y="${cy + 4}" class="lbl" text-anchor="end">${c}</text>`;
    g += `<path d="${hbar(x(0), x(Math.max(m, 0.8)), cy - 8, 16)}" fill="${credColor(m)}"/>`;
    g += `<text x="${x(Math.max(m, 0.8)) + 6}" y="${cy + 4}" class="tick">${r1(m)}% · ${rs.length}</text></g>`;
  });
  return svgWrap(w, h, g, 'Median credence by category');
}

function renderReviews() {
  chartJobs = [];
  const app = $('#app');
  const q = state.q.toLowerCase();
  const rows = sortRows(TOPICS.map(t => ({ t, r: REVIEWS[t.id] }))
    .filter(({ t, r }) => (rvState.cat === 'all' || t.category === rvState.cat) && (!q || reviewText(t, r).includes(q))));
  const doneRows = rows.filter(o => o.r && o.r.stats);
  const done = rows.filter(o => o.r && o.r.stats).map(o => o.r);
  const allDone = Object.values(REVIEWS).filter(r => r.stats);
  const cnt = f => done.filter(r => f(r.stats.median)).length;
  const agree = done.filter(r => r.stats.spread <= 15).length;
  const tile = (label, value, sub) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}<span class="split"><span>${sub}</span></span></div></div>`;

  app.innerHTML = `
  <section class="hero">
    <div class="hero-record">
      <div class="eyebrow">Evidence reviews · ${allDone.length} of ${TOPICS.length} topics reviewed</div>
      <h1 class="rv-h1">What is most likely true?</h1>
      <p class="rv-intro">${TOPICS.length} of the most debated questions about the Bible and God. Each was given to four AI models from four different companies. Working independently, each weighed the evidence and gave a <b>probability that the traditional claim is true</b>. Nobody argued a side. Where the models agree, that tells you more than any single model. Where they disagree, the page shows why. <a href="/method">How it works →</a></p>
      ${credLegend()}
    </div>
    <div class="tiles">
      ${tile('Claim likely true', cnt(m => m >= 56), 'median ≥ 56%')}
      ${tile('Toss-up', cnt(m => m > 44 && m < 56), '45–55%')}
      ${tile('Claim likely false', cnt(m => m <= 44), 'median ≤ 44%')}
      ${tile('Models agree', `${agree}/${done.length}`, 'spread ≤ 15 pts')}
      ${tile('Median credence', done.length ? r1(mean(done.map(r => r.stats.median))) + '%' : '—', 'across topics shown')}
      ${tile('Reviews written', done.length * 4, '4 models per topic')}
    </div>
  </section>

  <nav class="filters" aria-label="Filters">
    ${['all', ...CATS].map(c => `<button class="chip" data-rcat="${c}" aria-pressed="${rvState.cat === c}">${c === 'all' ? 'All topics' : c}</button>`).join('')}
    <span class="count">${q ? `matching “${esc(state.q)}” · ` : ''}${rows.length} topic${rows.length === 1 ? '' : 's'}</span>
  </nav>

  ${atAGlance(done)}
  <section class="grid">
    <div class="card span-12">
      <div class="card-head"><div><h2>Where the evidence points</h2><p class="sub">Each model's probability that the claim is true. The shaded band spans the four models; the bar is the median. Click or tap a row to open it.</p>${sortBtns()}</div>${modelLegend()}</div>
      ${chart('c-strip', w => credStrip(w, rows))}
    </div>
    ${done.length ? `
    <div class="card span-12">
      <div class="card-head"><div><h2>How sure, and how much agreement?</h2><p class="sub">Each dot is a topic: how likely the claim is (left to right) against how far apart the four models were (bottom to top). Bottom corners are the most settled.</p></div></div>
      ${chart('c-land', w => landscape(w, done))}
    </div>
    <div class="card span-6">
      <div class="card-head"><div><h2>Every verdict at a glance</h2><p class="sub">Each model's probability per topic. Same order as above.</p></div></div>
      ${chart('c-matrix', w => matrix(w, doneRows))}
    </div>
    <div class="card span-6">
      <div class="card-head"><div><h2>What does each answer hinge on?</h2><p class="sub">The key questions the reviewers said each answer turns on, by type. Mostly <b>evidence</b> means facts can settle it; mostly <b>starting assumptions</b> or <b>values</b> means your own views will shape the answer. Numbers are percentages.</p>${cruxLegend()}</div></div><div style="height:10px"></div>
      ${chart('c-crux', w => cruxBars(w, doneRows))}
    </div>
    <div class="card span-6">
      <div class="card-head"><div><h2>Model lean check</h2><p class="sub">Average credence per model. The number is how far it sits from the topic median on average: a bias check.</p></div></div>
      ${chart('c-lean', w => modelLean(w, done))}
    </div>
    <div class="card span-6">
      <div class="card-head"><div><h2>By category</h2><p class="sub">Average of topic medians (number of topics)</p></div></div>
      ${chart('c-rcat', w => categoryCred(w, done))}
    </div>
    <div class="card span-12">
      <div class="card-head"><div><h2>Verdicts</h2><p class="sub">The synthesis of what the four reviews agree on. Click to read the full reviews.</p></div></div>
      <div class="verdicts">${done.map(r => `
        <button class="vcard" data-go="/review/${r.topic.id}" style="border-top-color:${credColor(r.stats.median)}">
          <div class="meta"><b>#${r.topic.id} ${esc(r.topic.short)}</b><span>${r.topic.category}</span></div>
          <div class="vnum"><span>${r.stats.median}%</span><small>${band(r.stats.median)} · range ${r.stats.min}–${r.stats.max}</small></div>
          <p>${esc(trunc(r.synthesis?.what_is_settled || r.analyses[0].bottom_line, 260))}</p>
        </button>`).join('')}</div>
    </div>` : ''}
  </section>`;
  $$('[data-rcat]').forEach(b => b.onclick = () => { rvState.cat = b.dataset.rcat; renderReviews(); });
  $$('[data-rsort]').forEach(b => b.onclick = () => { rvState.sort = b.dataset.rsort; renderReviews(); });
  drawCharts();
}

function credBar(c, wide) {
  return `<span class="cbar${wide ? ' wide' : ''}" ${tipAttr(`${c}% · ${band(c)}`)}><i style="width:${c}%;background:${credColor(c)}"></i></span><b class="cnum">${c}%</b>`;
}
const ul = (xs, cls = '') => xs && xs.length ? `<ul class="plain ${cls}">${xs.map(x => `<li>${esc(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('')}</ul>` : '<p class="empty">None listed.</p>';

function analysisView(a) {
  return `
  <div class="an-head">
    <div><div class="eyebrow">${MODEL_NAMES[a.id]} · ${esc(a.kind)} question · confidence ${esc(a.confidence)}</div>
    <h3>${esc(a.verdict)}</h3></div>
    <div class="an-cred">${credBar(a.credence, true)}</div>
  </div>
  <div class="prose">${md(a.bottom_line)}</div>

  <h4>Sub-claims</h4>
  <div class="subclaims">${a.sub_claims.map(s => `
    <details class="sc">
      <summary><span class="sc-claim">${esc(s.claim)}</span><span class="sc-kind">${esc(s.kind || '')}</span>${s.credence != null ? credBar(s.credence) : ''}</summary>
      <div class="sc-body">
        <p class="sc-verdict"><b>Verdict:</b> ${esc(s.verdict)}</p>
        <div class="two"><div class="for"><h5>Case for</h5><p>${esc(s.case_for)}</p></div><div class="against"><h5>Case against</h5><p>${esc(s.case_against)}</p></div></div>
        <p><b>Expert consensus:</b> ${esc(s.consensus)}</p>
        ${s.evidence?.length ? `<h5>Key evidence</h5>${ul(s.evidence)}` : ''}
      </div>
    </details>`).join('')}</div>

  <h4>What it hinges on</h4>
  <div class="cruxes">${a.cruxes.map(c => `
    <div class="crux"><div class="meta"><span class="pill">${esc(c.type)}</span></div><p class="crux-q">${esc(c.crux)}</p>
      <div class="two"><div><h5>If yes</h5><p>${esc(c.if_yes)}</p></div><div><h5>If no</h5><p>${esc(c.if_no)}</p></div></div>
      ${c.your_view ? `<p class="crux-view"><b>${MODEL_NAMES[a.id]}'s view:</b> ${esc(c.your_view)}</p>` : ''}</div>`).join('')}</div>

  <div class="two gap">
    <div><h4><span class="dot theist"></span>Strongest points for the claim</h4>${ul(a.strongest_for, 'for')}</div>
    <div><h4><span class="dot atheist"></span>Strongest points against</h4>${ul(a.strongest_against, 'against')}</div>
  </div>
  <div class="two gap">
    <div><h4>Weak arguments <i>for</i> it that don't hold up</h4>${ul(a.weak_arguments?.for)}</div>
    <div><h4>Weak arguments <i>against</i> it that don't hold up</h4>${ul(a.weak_arguments?.against)}</div>
  </div>
  <h4>What would change this verdict</h4>${ul(a.would_change)}
  <h4>Sources cited</h4>${a.sources?.length ? `<ul class="plain src">${a.sources.map(s => `<li>${esc(s.citation)} <span class="pill">${esc(s.kind)}</span></li>`).join('')}</ul>` : '<p class="empty">None listed.</p>'}
  <p class="note">Sources are as cited by the model from memory and have not been checked.</p>`;
}

function renderReview(id, r) {
  chartJobs = [];
  const app = $('#app');
  const t = TOPICS.find(x => x.id === id);
  if (!t) { app.innerHTML = `<a class="back" href="/">← All topics</a><div class="card"><p class="empty">Topic #${id} not found.</p></div>`; return; }
  const idx = TOPICS.indexOf(t), prev = TOPICS[idx - 1], next = TOPICS[idx + 1];
  const deb = (RAW.debateIds || []).includes(id);
  const head = `
  <a class="back" href="/">← All topics</a>
  <section class="topic-head">
    <div>
      <div class="eyebrow">Topic #${t.id} · ${t.category}${r?.analyses?.[0] ? ' · ' + esc(r.analyses[0].kind) + ' question' : ''}</div>
      <h1>${esc(t.question)}</h1>
      <p class="res">Claim tested: “${esc(t.claim)}”</p>
      <div class="badges">${deb ? `<a class="pill linkpill" href="/topic/${id}">Read the debate on this topic →</a>` : ''}</div>
    </div>
    ${r?.stats ? `<div class="bigcred" style="--c:${credColor(r.stats.median)}"><div class="eyebrow">Median of 4 models</div><div class="n">${r.stats.median}%</div><div class="b">${band(r.stats.median)}</div><div class="rng">range ${r.stats.min}–${r.stats.max}%</div></div>` : ''}
  </section>`;
  const nav = `<nav class="pn">${prev ? `<a href="/review/${prev.id}">← ${esc(prev.short)}</a>` : '<span></span>'}${next ? `<a href="/review/${next.id}">${esc(next.short)} →</a>` : ''}</nav>`;
  if (!r || !r.analyses?.length) { app.innerHTML = head + `<div class="card"><p class="empty">This topic hasn't been reviewed yet.</p></div>` + nav; return; }
  const tab = rvState.tab[id] || r.analyses[0].id;
  const a = r.analyses.find(x => x.id === tab) || r.analyses[0];
  const s = r.synthesis;
  app.innerHTML = head + `
  <section class="grid">
    <div class="card span-12">
      <div class="card-head"><div><h2>The four verdicts</h2><p class="sub">Probability each model gives that the claim is true</p></div>${credLegend()}</div>
      ${chart('c-one', w => oneStrip(w, r))}
    </div>
    ${s ? `
    <div class="card span-12 synth">
      <div class="card-head"><div><h2>Synthesis</h2><p class="sub">What the four reviews agree and disagree on · summarized by ${esc(MODEL_LABEL[s.model] || s.model)}, which was told not to add its own view · agreement: <b>${esc(s.agreement)}</b></p></div></div>
      <div class="prose lead">${md(s.summary)}</div>
      <div class="two gap">
        <div class="settled"><h4>What is settled</h4><p>${esc(s.what_is_settled)}</p></div>
        <div class="open"><h4>What is still open</h4><p>${esc(s.what_is_open)}</p></div>
      </div>
      <div class="two gap">
        <div><h4>All four agree</h4>${ul(s.agreed)}</div>
        <div><h4>Where they differ</h4>${s.disagreed?.length ? `<ul class="plain">${s.disagreed.map(d => `<li><b>${esc(d.point)}</b><br><span class="muted">${esc(d.positions)}</span></li>`).join('')}</ul>` : '<p class="empty">No substantive disagreements.</p>'}</div>
      </div>
      <h4>The questions that decide it</h4>${ul(s.deciding_cruxes)}
    </div>` : ''}
    <div class="card span-12">
      <div class="card-head"><div><h2>Full reviews</h2><p class="sub">Each model's independent analysis</p></div></div>
      <div class="tabs" role="tablist">${r.analyses.map(x => `<button class="tab" role="tab" data-rtab="${x.id}" aria-selected="${x.id === a.id}"><svg width="12" height="12">${modelMark(x.id, 6, 6, 4.5)}</svg> ${MODEL_NAMES[x.id]} · ${x.credence}%</button>`).join('')}</div>
      <div class="analysis">${analysisView(a)}</div>
    </div>
  </section>` + nav;
  $$('[data-rtab]').forEach(b => b.onclick = () => { rvState.tab[id] = b.dataset.rtab; const y = scrollY; renderReview(id, r); scrollTo(0, y); });
  drawCharts();
}

function oneStrip(w, r) {
  const L = 20, R = 20, x = lin(0, 100, L, w - R);
  // greedy lane assignment so labels never overlap
  const items = r.analyses.slice().sort((a, b) => a.credence - b.credence).map(a => {
    const text = `${MODEL_NAMES[a.id]} ${a.credence}%`, tw = text.length * 7.2 + 10;
    const px = x(a.credence), lx = Math.max(L + tw / 2, Math.min(w - R - tw / 2, px));
    return { a, text, px, x0: lx - tw / 2, x1: lx + tw / 2, lx };
  });
  const lanes = [];
  items.forEach(it => { let k = lanes.findIndex(end => end <= it.x0); if (k < 0) { k = lanes.length; lanes.push(0); } lanes[k] = it.x1; it.lane = k; });
  const laneH = 17, cy = 24 + lanes.length * laneH, h = cy + 64;
  let g = '';
  for (let i = 0; i < 50; i++) g += `<rect x="${x(i * 2)}" y="${cy - 7}" width="${x(2) - x(0) + 0.5}" height="14" fill="${credColor(i * 2 + 1)}"/>`;
  [0, 25, 50, 75, 100].forEach(v => { g += `<line x1="${x(v)}" x2="${x(v)}" y1="${cy + 9}" y2="${cy + 14}" stroke="var(--axis)"/><text x="${x(v)}" y="${cy + 28}" class="tick" text-anchor="middle">${v}%</text>`; });
  g += `<text x="${x(0)}" y="${h - 6}" class="tick">← Claim false</text><text x="${x(100)}" y="${h - 6}" class="tick" text-anchor="end">Claim true →</text>`;
  items.forEach(({ a, text, px, lx, lane }) => {
    const ly = cy - 16 - lane * laneH;
    g += `<g ${tipAttr(`<div class="tt-title">${MODEL_NAMES[a.id]}</div>` + ttRow('Credence', `${a.credence}%`) + `<div class="tt-q">${esc(a.verdict)}</div>`)}>`;
    g += `<path d="M${lx},${ly + 4}L${px},${cy - 9}" stroke="var(--text-muted)" fill="none"/>`;
    g += modelMark(a.id, px, cy, 7, 'stroke="var(--page)" stroke-width="1.5"');
    g += `<text x="${lx}" y="${ly}" class="tick strong" text-anchor="middle">${text}</text></g>`;
  });
  return svgWrap(w, h, g, 'Model credences');
}


// ---------- extra overview charts ----------
const CRUX_T = ['evidence', 'prior', 'value', 'definition'];
const CRUX_LABEL = { evidence: 'Evidence', prior: 'Starting assumptions', value: 'Values', definition: 'Definitions' };
const cruxLegend = () => `<div class="legend">${CRUX_T.map(k => `<span><i class="sw" style="background:var(--c-${k})"></i>${CRUX_LABEL[k]}</span>`).join('')}</div>`;
function sortRows(rows) {
  const k = rvState.sort, med = o => o.r?.stats?.median ?? -1, spr = o => o.r?.stats?.spread ?? -1;
  if (k === 'cred') return rows.slice().sort((a, b) => med(b) - med(a));
  if (k === 'spread') return rows.slice().sort((a, b) => spr(b) - spr(a));
  return rows;
}
const sortBtns = () => `<div class="seg" role="group" aria-label="Sort">${[['id', 'Topic #'], ['cred', 'Most likely true'], ['spread', 'Most disputed']].map(([k, l]) => `<button class="chip" data-rsort="${k}" aria-pressed="${rvState.sort === k}">${l}</button>`).join('')}</div>`;

// topic x model matrix
function matrix(w, rows) {
  const cols = [...MODEL_IDS, 'median'];
  const left = Math.min(200, w * 0.36), top = 30, cellH = 26, gap = 2;
  const cellW = Math.max(40, (w - left) / cols.length);
  const h = top + rows.length * cellH + 4;
  let g = '';
  cols.forEach((c, j) => g += `<text x="${left + j * cellW + (cellW - gap) / 2}" y="${top - 10}" class="ax" text-anchor="middle" ${c === 'median' ? 'font-weight="700"' : ''}>${c === 'median' ? 'Median' : MODEL_NAMES[c]}</text>`);
  rows.forEach(({ t, r }, i) => {
    const y = top + i * cellH;
    g += `<text x="${left - 10}" y="${y + cellH / 2 + 4}" class="lbl clickable" text-anchor="end" data-go="/review/${t.id}">${esc(trunc(`${t.id}. ${t.short}`, Math.max(10, Math.floor((left - 14) / 6.6))))}</text>`;
    cols.forEach((c, j) => {
      const v = c === 'median' ? r.stats.median : r.analyses.find(a => a.id === c)?.credence;
      if (v == null) return;
      const x = left + j * cellW, light = Math.abs(v - 50) > 30;
      g += `<g class="clickable" data-go="/review/${t.id}" ${tipAttr(`<div class="tt-title">${esc(t.short)}</div>` + ttRow(c === 'median' ? 'Median' : MODEL_NAMES[c], `${v}% · ${band(v)}`))}>`;
      g += `<rect x="${x}" y="${y}" width="${cellW - gap}" height="${cellH - gap}" rx="4" fill="${credColor(v)}"/>`;
      g += `<text x="${x + (cellW - gap) / 2}" y="${y + cellH / 2 + 3}" text-anchor="middle" class="cellv${light ? ' on' : ''}" ${c === 'median' ? 'font-weight="700"' : ''}>${v}</text></g>`;
    });
  });
  return svgWrap(w, h, g, 'Credence by topic and model');
}

// what each topic hinges on: crux types, pooled across the 4 reviews
function cruxBars(w, rows) {
  const left = Math.min(200, w * 0.36), right = 8, rowH = 24, top = 4, h = top + rows.length * rowH + 4;
  const x = lin(0, 1, left, w - right);
  let g = '';
  rows.forEach(({ t, r }, i) => {
    const y = top + i * rowH;
    const cnt = Object.fromEntries(CRUX_T.map(k => [k, r.analyses.reduce((s, a) => s + (a.cruxTypes?.[k] || 0), 0)]));
    const tot = CRUX_T.reduce((s, k) => s + cnt[k], 0) || 1;
    g += `<g class="clickable" data-go="/review/${t.id}" ${tipAttr(`<div class="tt-title">${esc(t.short)}</div><div class="tt-q">What the answer hinges on (${tot} key questions across 4 reviews)</div>` + CRUX_T.map(k => ttRow(CRUX_LABEL[k], `${cnt[k]} · ${Math.round(cnt[k] / tot * 100)}%`)).join(''))}>`;
    g += `<rect x="0" y="${y}" width="${w}" height="${rowH}" class="row-hit" fill="transparent"/>`;
    g += `<text x="${left - 10}" y="${y + rowH / 2 + 4}" class="lbl" text-anchor="end">${esc(trunc(`${t.id}. ${t.short}`, Math.max(10, Math.floor((left - 14) / 6.6))))}</text>`;
    let acc = 0;
    CRUX_T.forEach(k => {
      if (!cnt[k]) return;
      const x0 = x(acc / tot), x1 = x((acc + cnt[k]) / tot); acc += cnt[k];
      g += `<rect x="${x0}" y="${y + 4}" width="${Math.max(1, x1 - x0 - 2)}" height="${rowH - 8}" rx="3" fill="var(--c-${k})"/>`;
      if (x1 - x0 > 26) g += `<text x="${(x0 + x1) / 2 - 1}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="cellv on">${Math.round(cnt[k] / tot * 100)}</text>`;
    });
    g += '</g>';
  });
  return svgWrap(w, h, g, 'What each answer hinges on');
}

// certainty landscape: median (x) vs disagreement (y)
function landscape(w, done) {
  const L = 40, R = 16, T = 14, B = 40, h = 340;
  const x = lin(0, 100, L, w - R), y = lin(0, Math.max(40, ...done.map(r => r.stats.spread)) + 5, h - B, T);
  let g = '';
  [0, 25, 50, 75, 100].forEach(v => g += `<line x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${h - B}" class="gridline" ${v === 50 ? 'stroke-dasharray="3 3"' : ''}/><text x="${x(v)}" y="${h - B + 16}" class="ax" text-anchor="middle">${v}%</text>`);
  [0, 20, 40, 60].filter(v => y(v) >= T).forEach(v => g += `<line x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}" class="gridline"/><text x="${L - 8}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`);
  g += `<text x="${(L + w - R) / 2}" y="${h - 4}" class="ax" text-anchor="middle">Median probability the claim is true →</text>`;
  g += `<text x="${L + 6}" y="${T + 10}" class="ax">↑ models disagree more</text>`;
  const pts = done.map(r => ({ r, cx: x(r.stats.median), cy: y(r.stats.spread) }));
  const placed = pts.map(p => [p.cx - 6, p.cy - 6, p.cx + 6, p.cy + 6]);
  const hit = b => placed.some(p => !(b[2] < p[0] || b[0] > p[2] || b[3] < p[1] || b[1] > p[3]));
  const labels = {};
  pts.slice().sort((a, b) => (b.r.stats.spread + Math.abs(b.r.stats.median - 50) / 5) - (a.r.stats.spread + Math.abs(a.r.stats.median - 50) / 5)).forEach(p => {
    const lbl = trunc(p.r.topic.short, 20), tw = lbl.length * 6.1;
    for (const [dx, dy, anchor] of [[9, 4, 'start'], [-9, 4, 'end'], [0, -10, 'middle'], [0, 17, 'middle']]) {
      const lx = p.cx + dx, ly = p.cy + dy;
      const x0 = anchor === 'start' ? lx : anchor === 'end' ? lx - tw : lx - tw / 2, box = [x0, ly - 10, x0 + tw, ly + 2];
      if (box[0] < L || box[2] > w - R || box[1] < T + 14 || hit(box)) continue;
      placed.push(box); labels[p.r.topic.id] = `<text x="${lx}" y="${ly}" class="ax lbl-s" text-anchor="${anchor}">${esc(lbl)}</text>`; break;
    }
  });
  pts.forEach(({ r, cx, cy }) => {
    g += `<g class="clickable" data-go="/review/${r.topic.id}" ${tipAttr(`<div class="tt-title">${esc(r.topic.short)}</div>` + ttRow('Median', `${r.stats.median}% · ${band(r.stats.median)}`) + ttRow('Range', `${r.stats.min}–${r.stats.max}%`))}>`;
    g += `<circle cx="${cx}" cy="${cy}" r="12" fill="transparent"/><circle cx="${cx}" cy="${cy}" r="6" fill="${credColor(r.stats.median)}" stroke="var(--surface-1)" stroke-width="2"/>`;
    g += (labels[r.topic.id] || '') + '</g>';
  });
  return svgWrap(w, h, g, 'Median credence vs disagreement');
}

function atAGlance(done) {
  if (!done.length) return '';
  const by = (f, dir) => done.slice().sort((a, b) => dir * (f(a) - f(b)))[0];
  const hi = by(r => r.stats.median, -1), lo = by(r => r.stats.median + r.stats.spread / 100, 1), dis = by(r => r.stats.spread, -1);
  const item = (lbl, r, v) => `<button class="glance" data-go="/review/${r.topic.id}"><span class="eyebrow">${lbl}</span><b>${esc(r.topic.short)}</b><span>${v}</span></button>`;
  const ev = done.filter(r => r.analyses.some(a => a.kind === 'empirical')).length;
  return `<div class="glances">
    ${item('Strongest support', hi, `${hi.stats.median}% · ${band(hi.stats.median)}`)}
    ${item('Weakest support', lo, `${lo.stats.median}% · range ${lo.stats.min}–${lo.stats.max}`)}
    ${item('Most disputed', dis, `models range ${dis.stats.min}–${dis.stats.max}%`)}
    <div class="glance static"><span class="eyebrow">Claims above 50%</span><b>${done.filter(r => r.stats.median > 50).length} of ${done.length}</b><span>${ev} topics are mainly questions of evidence</span></div>
  </div>`;
}

// ---------- method page ----------
function renderMethod() {
  chartJobs = [];
  const n = TOPICS.length;
  $('#app').innerHTML = `
  <article class="method">
    <div class="eyebrow">How it works</div>
    <h1>Weighing the evidence, not winning the argument</h1>
    <p class="lede">Debates reward whoever argues better. This project asks a different question: setting persuasion aside, what is most likely <i>true</i>?</p>

    <h2>The process</h2>
    <ol class="steps">
      <li><b>${n} questions.</b> Each topic is a neutral question plus the traditional claim being tested, worded to test the claim at full strength rather than a weak version that is easy to defend or attack.</li>
      <li><b>Four independent reviewers.</b> Four AI models from four different companies (OpenAI's GPT-6.1, Google's Gemini 3.8, xAI's Grok 4.7 and Anthropic's Claude Opus 5.5) each reviewed every question separately, without seeing the others' work. None was assigned a side.</li>
      <li><b>Same instructions for all.</b> Each was told to follow the evidence wherever it leads, steelman both sides, report what experts actually think (including religious scholars), separate questions of evidence from questions of starting assumptions and values, and give a probability that the claim is true. They were told not to split the difference to look balanced.</li>
      <li><b>Structured output.</b> Each review breaks the claim into smaller claims, names the questions the answer hinges on, lists the strongest points on both sides, flags popular arguments on each side that don't hold up, and states what would change its mind.</li>
      <li><b>A neutral summary.</b> A fifth step compares the four reviews and reports where they agree and disagree. That model was told not to add its own view.</li>
    </ol>

    <h2>How to read the numbers</h2>
    <p>Each number is a reviewer's probability that the traditional claim is true. 50% means a genuine toss-up; 5% means "almost certainly not"; 95% means "almost certainly so".</p>
    <div class="scale">${[[3, 'Very likely false'], [20, 'Likely false'], [38, 'Leans false'], [50, 'Toss-up'], [62, 'Leans true'], [80, 'Likely true'], [95, 'Very likely true']].map(([v, l]) => `<span style="background:${credColor(v)}" class="${Math.abs(v - 50) > 30 ? 'on' : ''}">${l}</span>`).join('')}</div>
    <p><b>Agreement matters more than any one number.</b> When four independently trained models land in the same place, that is stronger than one model's opinion. Where they disagree, the topic page shows why.</p>
    <p><b>Not every question is the same kind.</b> Historical and scientific questions (the Flood, the Exodus, whether Jesus existed) have fairly clear answers in scholarship. Questions about miracles depend heavily on how likely you think miracles are before looking at the evidence. Moral and philosophical questions depend on values. Each topic page shows which kind of question it is and where your own assumptions would change the answer.</p>

    <h2>Limits, honestly stated</h2>
    <ul class="plain">
      <li><b>AI models can be wrong</b>, including confidently wrong. Treat this as a well-organized map of the arguments and the scholarship, not as a verdict from on high.</li>
      <li><b>Shared bias is possible.</b> All four models learned from largely the same body of human writing, much of it academic scholarship that works without assuming miracles. Using four companies reduces this, but doesn't remove it. The "model lean check" chart shows whether any one model runs consistently high or low.</li>
      <li><b>Sources are cited from memory and have not been checked.</b> Look them up before relying on them.</li>
      <li><b>The wording of a claim matters.</b> Several claims were reworded during the project after it became clear the original wording was ambiguous or tested a weaker or bundled claim. The current wording is shown on every page.</li>
      <li><b>Probabilities on philosophical questions are rough.</b> They summarize where the arguments lean; reasonable people still disagree.</li>
    </ul>

    <h2>Why not debates?</h2>
    <p>The project began as AI-vs-AI debates judged by an AI panel. They were well argued, and they showed the problem with debates as a way to find the truth: the outcome depends on framing and skill. See <a href="/debates">the debate experiment</a> for the case that changed the approach.</p>

    <h2>Open data</h2>
    <p>The project is open source: code, prompts, every review and the raw model replies are on <a href="https://github.com/realTeddy/bible-weighed">GitHub</a> (code MIT, data CC BY 4.0). Every review is also available as JSON, for example <a href="/data/reviews/18.json">/data/reviews/18.json</a>. Found a factual error or a fabricated source? <a href="https://github.com/realTeddy/bible-weighed/issues">Open an issue</a>. Last updated ${esc(RAW.updated || '')}.</p>
  </article>`;
}

function debatesIntro() {
  const r18 = REVIEWS[18], d18 = ALL.find(d => d.id === 18);
  const ev = r18 ? 100 - r18.stats.median : null;
  return `<section class="card why">
    <div class="eyebrow">The debate experiment</div>
    <h1 class="rv-h1">Why not debates?</h1>
    <p class="rv-intro">This project started as AI-vs-AI debates: one model argued for the traditional claim, another against, and a panel of three AI judges from different companies scored them. The debates were careful, honest and full of concessions. And they showed why debates are a poor way to find out what is true.</p>
    ${d18 && r18 ? `<div class="vs-case">
      <div><span class="eyebrow">Debate · Problem of Evil</span><b class="big-n" style="color:var(--theist)">${d18.votes.theist}–${d18.votes.atheist}</b><span>Theist wins on the panel.<br>The resolution asked whether evil is <i>compatible</i> with God. The theist defined that as bare logical consistency in his opening, and the atheist never challenged it.</span></div>
      <div class="arrow">≠</div>
      <div><span class="eyebrow">Evidence review · same topic</span><b class="big-n" style="color:var(--atheist)">~${Math.round(ev)}%</b><span>All four reviewers judge that suffering <i>is</i> significant evidence against the biblical God (median of the probabilities that it is), while agreeing it is not a logical contradiction.</span></div>
    </div>` : ''}
    <p class="rv-intro">The debate was won on a definition. Both results are "correct" for the question each one asked, but only one of them answers the question most people actually care about. That is why the main site uses independent evidence reviews instead. The two debates are kept below as a record of the experiment.</p>
  </section>`;
}

route();
})();
