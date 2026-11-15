#!/usr/bin/env python3
"""Judge debates with a 3-model panel via GitHub Copilot CLI (no Claude quota).

  python3 scripts/judge.py 02 18        # judge specific debates
  python3 scripts/judge.py --all        # judge every debate in data/debates
  python3 scripts/judge.py --missing    # only debates with no copilot verdicts yet
Then: python3 scripts/build.py site
"""
import json
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEBATES = ROOT / "data" / "debates"
RAW = ROOT / "data" / "judge-raw"

JUDGES = [
    {"id": "historian", "model": "gpt-6.1-terra",
     "lens": "a historian of antiquity and biblical scholar. You pay special attention to the factual and historical accuracy of claims about texts, manuscripts, archaeology, and scholarship"},
    {"id": "philosopher", "model": "gemini-3.8-flash",
     "lens": "an analytic philosopher and logician. You pay special attention to argument validity, burden of proof, and logical fallacies"},
    {"id": "adjudicator", "model": "grok-4.7",
     "lens": "an experienced competitive-debate adjudicator. You pay special attention to clash, responsiveness to questions, and intellectual honesty"},
]
CRIT = ["evidence", "logic", "engagement", "honesty", "clarity", "overall"]
W = {"evidence": 0.25, "logic": 0.25, "engagement": 0.20, "honesty": 0.15, "clarity": 0.15}
SIDES = ("theist", "atheist")

SHAPE = """{
  "scores": {"theist": {"evidence": int, "logic": int, "engagement": int, "honesty": int, "clarity": int, "overall": int},
             "atheist": {same keys}},
  "winner": "theist" | "atheist" | "draw",
  "margin": "narrow" | "clear" | "decisive",
  "verdict": "150-300 words",
  "highlights": [{"round": int, "side": "theist"|"atheist", "quote": "exact short quote", "why": "..."}],
  "fallacies": [{"round": int, "side": ..., "name": "...", "quote": "exact quote", "explanation": "..."}],
  "factual_errors": [{"round": int, "side": ..., "claim": "...", "correction": "...", "severity": "minor"|"moderate"|"major"}],
  "key_concessions": [{"round": int, "side": ..., "point": "...", "impact": "minor"|"moderate"|"major"}],
  "turning_point": {"round": int, "description": "..."},
  "best_argument": {"theist": "...", "atheist": "..."},
  "unanswered": {"theist": ["arguments made BY the theist the atheist never adequately answered"], "atheist": [...]}
}"""


def render(turns):
    out = []
    for t in turns:
        s = f"--- Round {t['round']} · {t['side'].upper()} · {t['type']} ---\n{t['speech']}"
        if t["concessions"]:
            s += "\n[Concessions: " + "; ".join(f"{c['point']} ({c['significance']})" for c in t["concessions"]) + "]"
        if t["questions"]:
            s += "\n[Questions to opponent: " + " | ".join(t["questions"]) + "]"
        if t.get("signal", "continue") != "continue":
            s += f"\n[Signal: {t['signal']} — {t['signal_reason']}]"
        out.append(s)
    return "\n\n".join(out)


def prompt(d, j):
    return f"""You are a judge on a 3-person panel evaluating a debate. You are {j['lens']}.
Be strictly impartial: score the QUALITY OF ARGUMENTATION, not your own opinion on whether the resolution is true.
Do not use any tools. Read the transcript below and answer with JSON only.

RESOLUTION: "{d['topic']['resolution']}" (theist argues FOR, atheist argues AGAINST; the affirmative carries the burden of proof)
Debate ended by: {d['endReason']}

SCORING (integers 1-10 per side):
- evidence: accuracy and quality of evidence and sources (penalize fabricated or wrong facts)
- logic: soundness of reasoning
- engagement: directly answering the opponent's actual arguments and questions
- honesty: intellectual honesty, appropriate concessions, charity, no dodging or goalpost-moving
- clarity: clarity and persuasiveness
- overall: your holistic rating of the debater's performance in THIS debate

CALIBRATION — use the whole scale and differentiate; do not default to 7-9:
1-2 very poor · 3-4 weak · 5 competent · 6 good · 7 strong · 8 excellent (top published scholar level) · 9 exceptional · 10 flawless, essentially no weaknesses.
Two debaters rarely deserve identical scores on every criterion; if one was better on a criterion, show it.

CONSISTENCY RULES:
- "winner" MUST be the side with the higher "overall" score. If the overall scores are equal, winner = "draw".
- A warranted concession is a mark of honesty, not of losing. But if a debater's concessions gave away the substance of the resolution, that belongs in logic/evidence/overall, not as an honesty bonus that outweighs it.

Also provide: 3-5 highlights (exact short quotes with round), every logical fallacy you detect (with exact quote), every factual error (with correction), key concessions and their impact, the turning point, each side's best argument, and arguments each side made that the opponent left unanswered. Use empty arrays where nothing applies.

Respond with ONE JSON object, no markdown fences, no commentary, in exactly this shape:
{SHAPE}

FULL TRANSCRIPT:
{render(d['turns'])}
"""


def parse(text):
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.M)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("no JSON object in reply")
    return json.loads(text[start:end + 1])


def validate(r):
    for s in SIDES:
        for k in CRIT:
            v = r["scores"][s][k]
            if not isinstance(v, int) or not 1 <= v <= 10:
                raise ValueError(f"bad score {s}.{k}={v!r}")
    if r["winner"] not in ("theist", "atheist", "draw"):
        raise ValueError(f"bad winner {r['winner']!r}")
    for k in ("verdict", "turning_point", "best_argument"):
        if k not in r:
            raise ValueError(f"missing {k}")
    for k in ("highlights", "fallacies", "factual_errors", "key_concessions"):
        r.setdefault(k, [])
    r.setdefault("unanswered", {"theist": [], "atheist": []})
    r.setdefault("margin", "narrow")
    # enforce the consistency rule
    to, ao = r["scores"]["theist"]["overall"], r["scores"]["atheist"]["overall"]
    expected = "theist" if to > ao else "atheist" if ao > to else "draw"
    if r["winner"] != expected:
        r["winner_stated"] = r["winner"]
        r["winner"] = expected
    return r


def call(d, j, tid):
    p = prompt(d, j)
    last_err = None
    with tempfile.TemporaryDirectory(prefix="judge-") as cwd:
        for attempt in range(3):
            args = ["copilot", "-s", "--model", j["model"], "--no-custom-instructions", "--disable-builtin-mcps",
                    "--no-ask-user", "--deny-tool", "shell", "--deny-tool", "write"]
            if attempt == 0:
                args += ["--reasoning-effort", "high"]
            try:
                res = subprocess.run(args, input=p, capture_output=True, text=True, cwd=cwd, timeout=900)
                RAW.mkdir(parents=True, exist_ok=True)
                (RAW / f"{tid}-{j['id']}-try{attempt}.txt").write_text(res.stdout + "\n--- stderr ---\n" + res.stderr)
                r = validate(parse(res.stdout))
                r["judge"], r["model"] = j["id"], j["model"]
                r["weighted"] = {s: round(sum(r["scores"][s][k] * w for k, w in W.items()), 2) for s in SIDES}
                print(f"  T{tid} {j['id']:12} ({j['model']}): {r['winner']:7} T{r['scores']['theist']['overall']} A{r['scores']['atheist']['overall']}"
                      + (f"  [stated {r['winner_stated']}, corrected]" if "winner_stated" in r else ""), flush=True)
                return r
            except Exception as e:  # noqa: BLE001
                last_err = e
                print(f"  T{tid} {j['id']} attempt {attempt + 1} failed: {e}", flush=True)
    raise RuntimeError(f"T{tid} {j['id']}: {last_err}")


def avg(xs):
    return round(sum(xs) / len(xs), 2)


def judge_file(path):
    d = json.loads(path.read_text())
    tid = path.stem
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = [ex.submit(call, d, j, tid) for j in JUDGES]
        results = []
        for f in futs:
            try:
                results.append(f.result())
            except Exception as e:  # noqa: BLE001
                print(f"  !! {e}")
    if len(results) < 3:
        print(f"T{tid}: only {len(results)}/3 judges succeeded; file NOT updated")
        return
    if d.get("judges") and not d.get("judges_v1") and not d["judges"][0].get("model"):
        d["judges_v1"] = d["judges"]  # keep the original same-model panel for reference
    votes = {"theist": 0, "atheist": 0, "draw": 0}
    for r in results:
        votes[r["winner"]] += 1
    d["judges"] = results
    d["panel"] = {
        "votes": votes,
        "winner": "theist" if votes["theist"] >= 2 else "atheist" if votes["atheist"] >= 2 else "draw",
        "overall": {s: avg([r["scores"][s]["overall"] for r in results]) for s in SIDES},
        "weighted": {s: avg([r["weighted"][s] for r in results]) for s in SIDES},
    }
    path.write_text(json.dumps(d, indent=1, ensure_ascii=False))
    p = d["panel"]
    print(f"T{tid} {d['topic']['short']}: panel {p['winner']} {votes} · rating T {p['overall']['theist']} / A {p['overall']['atheist']}")


def main():
    argv = sys.argv[1:]
    files = sorted(DEBATES.glob("*.json"))
    if "--missing" in argv:
        files = [f for f in files if not any(j.get("model") for j in json.loads(f.read_text()).get("judges", []))]
    elif "--all" not in argv:
        files = [DEBATES / f"{int(a):02d}.json" for a in argv]
    if not files:
        sys.exit(__doc__)
    with ThreadPoolExecutor(max_workers=2) as ex:
        list(ex.map(judge_file, files))


if __name__ == "__main__":
    main()
