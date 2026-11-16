#!/usr/bin/env python3
"""Build debate data for the dashboard.

  python3 scripts/build.py extract <journal.jsonl> [<journal.jsonl> ...]
      Rebuild data/debates/NN.json from workflow journals (turns + judge verdicts).
  python3 scripts/build.py site
      Bundle data/debates/*.json into site/data.js.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEBATES = ROOT / "data" / "debates"
TOPICS = {t["id"]: t for t in json.loads((ROOT / "data" / "topics.json").read_text())}
W = {"evidence": 0.25, "logic": 0.25, "engagement": 0.20, "honesty": 0.15, "clarity": 0.15}
JUDGE_ORDER = ["historian", "philosopher", "adjudicator"]
TURN_RE = re.compile(r"^T(\d+) R(\d+) (theist|atheist)( closing)?$")
JUDGE_RE = re.compile(r"^T(\d+) judge:(\w+)$")


def weighted(s):
    return round(sum(s[k] * w for k, w in W.items()), 2)


def avg(xs):
    return round(sum(xs) / len(xs), 2) if xs else 0


def extract(journals):
    labels, results = {}, {}
    for jp in journals:
        for line in Path(jp).read_text().splitlines():
            e = json.loads(line)
            if e.get("type") == "started":
                labels[e["agentId"]] = e["label"]
            elif e.get("type") == "result" and isinstance(e.get("result"), dict):
                results[e["agentId"]] = e["result"]

    debates = {}
    for aid, res in results.items():
        label = labels.get(aid, "")
        if m := TURN_RE.match(label):
            tid, rnd, side, closing = int(m[1]), int(m[2]), m[3], bool(m[4])
            typ = "closing" if closing else ("opening" if rnd == 1 else "exchange")
            turn = {"round": rnd, "side": side, "type": typ, **res}
            if typ == "closing":
                turn["signal"] = "continue"
            debates.setdefault(tid, {"turns": [], "judges": []})["turns"].append(turn)
        elif m := JUDGE_RE.match(label):
            tid, judge = int(m[1]), m[2]
            j = {"judge": judge, **res}
            j["weighted"] = {s: weighted(res["scores"][s]) for s in ("theist", "atheist")}
            debates.setdefault(tid, {"turns": [], "judges": []})["judges"].append(j)

    DEBATES.mkdir(parents=True, exist_ok=True)
    for tid, d in sorted(debates.items()):
        turns = sorted(d["turns"], key=lambda t: (t["round"], t["type"] == "closing", t["side"] != "theist"))
        judges = sorted(d["judges"], key=lambda j: JUDGE_ORDER.index(j["judge"]) if j["judge"] in JUDGE_ORDER else 99)
        if not judges or not any(t["type"] == "closing" for t in turns):
            print(f"T{tid:02d}: incomplete ({len(turns)} turns, {len(judges)} judges) — skipped")
            continue
        non_closing = [t for t in turns if t["type"] != "closing"]
        conceded = next((t["side"] for t in non_closing if t["signal"] == "concede_resolution" and t["round"] >= 2), None)
        max_round = max(t["round"] for t in non_closing)
        if conceded:
            end = f"{conceded}_conceded"
        elif any(t["type"] == "closing" and t["round"] == 20 for t in turns) and max_round >= 19:
            end = "max_rounds"
        else:
            end = "mutual_close"
        votes = {"theist": 0, "atheist": 0, "draw": 0}
        for j in judges:
            votes[j["winner"]] += 1
        winner = "theist" if votes["theist"] >= 2 else "atheist" if votes["atheist"] >= 2 else "draw"
        panel = {
            "votes": votes,
            "winner": winner,
            "overall": {s: avg([j["scores"][s]["overall"] for j in judges]) for s in ("theist", "atheist")},
            "weighted": {s: avg([j["weighted"][s] for j in judges]) for s in ("theist", "atheist")},
        }
        out = {"topic": TOPICS[tid], "endReason": end, "conceded": conceded, "turns": turns, "judges": judges, "panel": panel}
        (DEBATES / f"{tid:02d}.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
        print(f"T{tid:02d} {TOPICS[tid]['short']}: {len(turns)} turns, {end}, winner {winner} {votes}, "
              f"T {panel['weighted']['theist']} / A {panel['weighted']['atheist']}")


BASE = "https://bible.tewodros.me"


def band(c):
    return ("Very likely true" if c >= 90 else "Likely true" if c >= 70 else "Leans true" if c >= 56 else
            "Toss-up" if c >= 45 else "Leans false" if c >= 31 else "Likely false" if c >= 11 else "Very likely false")


def prerender(topics, reviews, debates):
    """Write a static, crawlable HTML page for every route, plus sitemap.xml, robots.txt and 404.html."""
    import html, re, time, datetime
    e = html.escape
    tpl = (ROOT / "scripts" / "page.html").read_text()
    v = str(int(time.time()))
    tpl = re.sub(r'(styles\.css|app\.js|data\.js)(\?v=\d+)?"', rf'\1?v={v}"', tpl)
    site = ROOT / "site"
    today = datetime.date.today().isoformat()
    urls = []

    def page(path, title, desc, body):
        out = tpl
        out = re.sub(r"<title>.*?</title>", f"<title>{e(title)}</title>", out, flags=re.S)
        out = re.sub(r'(<meta name="description" content=")[^"]*', lambda m: m.group(1) + e(desc), out)
        out = re.sub(r'(<meta property="og:description" content=")[^"]*', lambda m: m.group(1) + e(desc), out)
        out = re.sub(r'(<meta property="og:title" content=")[^"]*', lambda m: m.group(1) + e(title), out)
        out = re.sub(r'(<meta property="og:url" content=")[^"]*', lambda m: m.group(1) + BASE + path, out)
        out = re.sub(r'(<link rel="canonical" href=")[^"]*', lambda m: m.group(1) + BASE + path, out)
        out = out.replace('<main id="app" class="viz-root"></main>', f'<main id="app" class="viz-root">{body}</main>')
        f = site / path.strip("/") / "index.html" if path != "/" else site / "index.html"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(out)
        urls.append(path)

    rv = {r["topic"]["id"]: r for r in reviews}
    # home
    items = "".join(
        f'<li><a href="/review/{t["id"]}/">{e(t["question"])}</a> '
        + (f'<b>{rv[t["id"]]["stats"]["median"]:g}%</b> · {band(rv[t["id"]]["stats"]["median"])}' if t["id"] in rv else "")
        + "</li>" for t in topics)
    page("/", "The Bible, Weighed: what is most likely true?",
         f"{len(topics)} of the most debated questions about the Bible and God, each weighed independently by four AI models from four companies. Probabilities, where they agree, and why.",
         f'<section class="card"><h1>What is most likely true?</h1><p>{len(topics)} of the most debated questions about the Bible and God. Four AI models from four companies (GPT-6.1, Gemini 3.8, Grok 4.7, Claude Opus 5.5) each weighed the evidence independently and gave a probability that the traditional claim is true. <a href="/method/">How it works</a>.</p><ol class="plain">{items}</ol></section>')
    # reviews
    for r in reviews:
        t, st, syn = r["topic"], r["stats"], r.get("synthesis", {})
        verdicts = "".join(f'<li><b>{e(a["label"])}: {a["credence"]}%</b> · {e(a["verdict"])}<p>{e(a.get("bottom_line", ""))}</p></li>' for a in r["analyses"])
        agreed = "".join(f"<li>{e(x)}</li>" for x in syn.get("agreed", []) or [])
        body = (f'<a class="back" href="/">← All topics</a><section class="card"><div class="eyebrow">Topic #{t["id"]} · {e(t["category"])}</div>'
                f'<h1>{e(t["question"])}</h1><p>Claim tested: “{e(t["claim"])}”</p>'
                f'<p><b>Median of 4 AI models: {st["median"]:g}% ({band(st["median"])})</b>, range {st["min"]}–{st["max"]}%.</p>'
                f'<h2>Synthesis</h2><p>{e(syn.get("summary") or "")}</p><h3>What is settled</h3><p>{e(syn.get("what_is_settled") or "")}</p>'
                f'<h3>What is still open</h3><p>{e(syn.get("what_is_open") or "")}</p><h3>All four agree</h3><ul class="plain">{agreed}</ul>'
                f'<h2>The four reviews</h2><ul class="plain">{verdicts}</ul></section>')
        desc = f'{band(st["median"])} ({st["median"]:g}%), say four independent AI reviews. ' + (syn.get("what_is_settled") or "")
        page(f'/review/{t["id"]}/', f'{t["question"]} · The Bible, Weighed', desc[:300], body)
    # method
    page("/method/", "How it works · The Bible, Weighed",
         "How four AI models from four companies independently weighed the evidence on 32 questions about the Bible and God, and the limits of the approach.",
         '<article class="method"><h1>Weighing the evidence, not winning the argument</h1><p>Debates reward whoever argues better. This project asks what is most likely true. Four AI models from four companies each reviewed every question independently, without being assigned a side, and gave a probability that the traditional claim is true. The code, prompts and all reviews are open source on <a href="https://github.com/realTeddy/bible-weighed">GitHub</a>.</p></article>')
    # debates
    page("/debates/", "Why not debates? · The Bible, Weighed",
         "AI-vs-AI debates judged by an AI panel showed why debates are a poor way to find the truth: the Problem of Evil debate was won on a definition.",
         '<section class="card"><h1>Why not debates?</h1><p>This project started as AI-vs-AI debates judged by a panel of three AI models. The Problem of Evil debate was won 3–0 by the theist on a definition, while independent evidence reviews found suffering is significant evidence against the biblical God.</p>'
         + "".join(f'<p><a href="/topic/{d["topic"]["id"]}/">Debate: {e(d["topic"]["short"])}</a></p>' for d in debates) + "</section>")
    for d in debates:
        t = d["topic"]
        page(f'/topic/{t["id"]}/', f'Debate · {t["short"]} · The Bible, Weighed',
             f'AI-vs-AI debate on “{t["resolution"]}”, judged by GPT, Gemini and Grok.',
             f'<section class="card"><h1>{e(t["short"])}</h1><p>Resolution: “{e(t["resolution"])}”</p></section>')
    # 404, sitemap, robots
    (site / "404.html").write_text(re.sub(r"<title>.*?</title>", "<title>Not found · The Bible, Weighed</title>", tpl, flags=re.S)
        .replace('<main id="app" class="viz-root"></main>', '<main id="app" class="viz-root"><section class="card"><h1>Page not found</h1><p><a href="/">Back to all topics</a></p></section></main>')
        .replace('<script src="/app.js', '<script data-off src="/app.js'))
    (site / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{BASE}{u}</loc><lastmod>{today}</lastmod></url>\n" for u in urls) + "</urlset>\n")
    key = (ROOT / "data" / "indexnow.key").read_text().strip()
    (site / f"{key}.txt").write_text(key)
    (site / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n")
    return urls


def site():
    """Write site/data.js (small summary for the overview) plus per-topic JSON loaded on demand."""
    import datetime, shutil
    out = ROOT / "site" / "data"
    if out.exists():
        shutil.rmtree(out)
    (out / "reviews").mkdir(parents=True)
    topics = json.loads((ROOT / "data" / "topics.json").read_text())
    summary, search = [], {}

    def strings(x):
        if isinstance(x, str):
            yield x
        elif isinstance(x, dict):
            for k, v in x.items():
                if k not in ("id", "model", "via", "kind", "type", "confidence", "agreement", "cruxTypes"):
                    yield from strings(v)
        elif isinstance(x, list):
            for v in x:
                yield from strings(v)
    for p in sorted((ROOT / "data" / "reviews").glob("*.json")):
        r = json.loads(p.read_text())
        search[r["topic"]["id"]] = re.sub(r"\s+", " ", " ".join(strings(r)))
        (out / "reviews" / p.name).write_text(json.dumps(r, ensure_ascii=False, separators=(",", ":")))
        if "stats" not in r:
            continue
        syn = r.get("synthesis", {})
        summary.append({
            "topic": r["topic"], "stats": r["stats"],
            "synthesis": {k: syn.get(k) for k in ("summary", "what_is_settled", "what_is_open", "agreement")},
            "analyses": [{
                "id": a["id"], "label": a["label"], "credence": a["credence"], "verdict": a["verdict"],
                "confidence": a.get("confidence"), "kind": a.get("kind"), "bottom_line": a.get("bottom_line", ""),
                "cruxTypes": {t: sum(1 for c in a.get("cruxes", []) if c.get("type") == t) for t in ("evidence", "prior", "value", "definition")},
            } for a in r["analyses"]],
        })
    (out / "search.json").write_text(json.dumps(search, ensure_ascii=False, separators=(",", ":")))
    debates = [json.loads(p.read_text()) for p in sorted(DEBATES.glob("*.json"))]
    (out / "debates.json").write_text(json.dumps({"debates": debates}, ensure_ascii=False, separators=(",", ":")))
    payload = json.dumps({"topics": topics, "reviews": summary, "debateIds": [d["topic"]["id"] for d in debates],
                          "updated": datetime.date.today().isoformat()}, ensure_ascii=False, separators=(",", ":"))
    (ROOT / "site" / "data.js").write_text(f"window.SITE_DATA = {payload};\n")
    urls = prerender(topics, [json.loads(p.read_text()) for p in sorted((ROOT / "data" / "reviews").glob("*.json"))], debates)
    print(f"{len(urls)} pages prerendered")
    print(f"site/data.js: {len(summary)} reviews, {len(payload) // 1024} KB; {len(debates)} debates in site/data/debates.json")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "site"
    if cmd == "extract":
        extract(sys.argv[2:])
        site()
    else:
        site()
