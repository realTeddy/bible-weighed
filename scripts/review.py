#!/usr/bin/env python3
"""Independent evidence reviews by 4 models, then a neutral synthesis.

  python3 scripts/review.py 11 18      # review specific topics
  python3 scripts/review.py --missing  # topics with no complete review yet
  python3 scripts/review.py --all
Then: python3 scripts/build.py site

GPT, Gemini and Grok run through GitHub Copilot CLI (no Claude quota).
Opus runs through the local Claude CLI (uses Claude quota, one call per topic).
Raw replies are saved in data/review-raw/.
"""
import json
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOPICS = {t["id"]: t for t in json.loads((ROOT / "data" / "topics.json").read_text())}
OUT = ROOT / "data" / "reviews"
RAW = ROOT / "data" / "review-raw"

MODELS = [
    {"id": "gpt", "label": "GPT-6.1", "via": "copilot", "model": "gpt-6.1-terra"},
    {"id": "gemini", "label": "Gemini 3.8", "via": "copilot", "model": "gemini-3.8-flash"},
    {"id": "grok", "label": "Grok 4.7", "via": "copilot", "model": "grok-4.7"},
    {"id": "opus", "label": "Opus 5.5", "via": "claude", "model": "claude-opus-5-5"},
]
SYNTH = {"id": "synth", "label": "GPT-6.1", "via": "copilot", "model": "gpt-6.1-terra"}

SHAPE = """{
  "kind": "empirical" | "philosophical" | "mixed",
  "verdict": "a short plain-language verdict, e.g. 'Almost certainly did not happen'",
  "credence": int 0-100,            // your probability that THE CLAIM is true
  "confidence": "low" | "medium" | "high",   // how robust that number is to reasonable disagreement
  "bottom_line": "3-6 sentences a thoughtful non-specialist can follow",
  "sub_claims": [
    {"claim": "...", "kind": "empirical" | "textual" | "philosophical",
     "case_for": "strongest case that this sub-claim is true",
     "case_against": "strongest case that it is false",
     "consensus": "where relevant experts stand, INCLUDING religious/confessional scholars; say 'no consensus' if so",
     "evidence": ["key specific facts, data, texts"],
     "verdict": "...", "credence": int 0-100}
  ],
  "cruxes": [
    {"crux": "a question the overall answer hinges on",
     "type": "evidence" | "prior" | "value" | "definition",
     "if_yes": "where you land if the answer is yes", "if_no": "where you land if no",
     "your_view": "..."}
  ],
  "strongest_for": ["the best points for the claim, even if you reject it"],
  "strongest_against": ["the best points against the claim, even if you accept it"],
  "weak_arguments": {"for": ["popular arguments FOR the claim that do not hold up, and why"],
                     "against": ["popular arguments AGAINST the claim that do not hold up, and why"]},
  "would_change": ["specific evidence or arguments that would move your credence substantially"],
  "sources": [{"citation": "author, title, year (only real works you are confident exist)", "kind": "scholarship" | "primary" | "scientific" | "scripture" | "other"}]
}"""


def prompt(t):
    return f"""You are an impartial expert reviewer. Your only goal is to find out what is most likely TRUE, using the best available evidence and sound reasoning. You are not on a team. You are not arguing a side. Do not use any tools; answer from your own knowledge.

QUESTION: {t['question']}
THE CLAIM BEING TESTED: "{t['claim']}"

RULES
1. Follow the evidence wherever it leads. Do not split the difference to seem balanced: if the evidence is lopsided, say so plainly and give an extreme credence. If it is genuinely close, say that.
2. Steelman both sides. Present the strongest version of each position, not the popular version.
3. Report what relevant experts actually think, including confessional/religious scholars, and say when the experts are themselves divided or when a field's consensus might reflect its assumptions.
4. Separate the kinds of question: matters of evidence (archaeology, texts, science, history), matters of prior assumptions (e.g. how likely miracles are before looking at evidence), and matters of values or definitions. Where the answer depends on a prior or a value, say so explicitly in the cruxes and show where each choice leads, then still give your own best overall estimate.
5. Be precise about the claim. If the claim is ambiguous, say which reading you are scoring and note how other readings would score.
6. Do not invent facts or sources. If unsure of a detail, say so. Cite only works you are confident exist.
7. Give 3-6 sub-claims, 2-5 cruxes, and 3-6 items per list where possible.

Respond with ONE JSON object, no markdown fences, no commentary before or after, in exactly this shape:
{SHAPE}
"""


def synth_prompt(t, analyses):
    blocks = "\n\n".join(f"=== REVIEW BY {a['label']} ===\n{json.dumps({k: v for k, v in a.items() if k not in ('model', 'id', 'via', 'label')}, ensure_ascii=False)}" for a in analyses)
    return f"""Four AI models independently reviewed the same question. Compare their reviews and report faithfully what they agree and disagree on. Do not add your own position or new arguments, and do not favor any reviewer. Do not use any tools.

QUESTION: {t['question']}
CLAIM: "{t['claim']}"

{blocks}

Respond with ONE JSON object, no markdown fences, in exactly this shape:
{{
  "summary": "4-7 sentences: the overall picture across the four reviews",
  "agreement": "high" | "moderate" | "low",
  "agreed": ["points all or nearly all reviewers agree on"],
  "disagreed": [{{"point": "...", "positions": "who holds what, and why they differ"}}],
  "deciding_cruxes": ["the cruxes that most determine the answer, merged across reviews"],
  "what_is_settled": "what a careful person can treat as established",
  "what_is_open": "what remains genuinely uncertain or depends on prior commitments"
}}
"""


def parse(text):
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.M)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("no JSON object in reply")
    return json.loads(text[start:end + 1])


def validate(r):
    c = r.get("credence")
    if isinstance(c, float) and c.is_integer():
        c = r["credence"] = int(c)
    if not isinstance(c, int) or not 0 <= c <= 100:
        raise ValueError(f"bad credence {c!r}")
    for k in ("verdict", "bottom_line", "sub_claims", "cruxes"):
        if not r.get(k):
            raise ValueError(f"missing {k}")
    for k in ("strongest_for", "strongest_against", "would_change", "sources"):
        r.setdefault(k, [])
    r.setdefault("weak_arguments", {"for": [], "against": []})
    r.setdefault("confidence", "medium")
    r.setdefault("kind", "mixed")
    return r


def run(m, p, cwd, first):
    if m["via"] == "copilot":
        args = ["copilot", "-s", "--model", m["model"], "--no-custom-instructions", "--disable-builtin-mcps",
                "--no-ask-user", "--deny-tool", "shell", "--deny-tool", "write"]
        if first:
            args += ["--reasoning-effort", "high"]
        res = subprocess.run(args, input=p, capture_output=True, text=True, cwd=cwd, timeout=1200)
        return res.stdout, res.stderr
    args = ["claude", "-p", "--model", m["model"], "--tools", "", "--no-session-persistence",
            "--output-format", "json", "--effort", "high" if first else "medium"]
    res = subprocess.run(args, input=p, capture_output=True, text=True, cwd=cwd, timeout=1200)
    out = json.loads(res.stdout)
    if out.get("is_error"):
        raise RuntimeError(out.get("result"))
    return out["result"], res.stderr


def call(m, p, tag, check):
    last = None
    with tempfile.TemporaryDirectory(prefix="review-") as cwd:
        for attempt in range(3):
            try:
                out, err = run(m, p, cwd, attempt == 0)
                RAW.mkdir(parents=True, exist_ok=True)
                (RAW / f"{tag}-{m['id']}-try{attempt}.txt").write_text(out + "\n--- stderr ---\n" + err)
                return check(parse(out))
            except Exception as e:  # noqa: BLE001
                last = e
                print(f"  {tag} {m['id']} attempt {attempt + 1} failed: {e}", flush=True)
    raise RuntimeError(f"{tag} {m['id']}: {last}")


def review(tid):
    t = TOPICS[tid]
    tag = f"{tid:02d}"
    path = OUT / f"{tag}.json"
    doc = json.loads(path.read_text()) if path.exists() else {"topic": t, "analyses": []}
    doc["topic"] = t
    done = {a["id"] for a in doc["analyses"]}
    todo = [m for m in MODELS if m["id"] not in done]
    p = prompt(t)

    def one(m):
        r = call(m, p, tag, validate)
        r.update(id=m["id"], label=m["label"], model=m["model"], via=m["via"])
        print(f"  T{tag} {m['label']:10}: {r['credence']:3}%  {r['verdict']}", flush=True)
        return r

    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = [ex.submit(one, m) for m in todo]
        for f in futs:
            try:
                doc["analyses"].append(f.result())
            except Exception as e:  # noqa: BLE001
                print(f"  !! {e}", flush=True)
    order = [m["id"] for m in MODELS]
    doc["analyses"].sort(key=lambda a: order.index(a["id"]))
    OUT.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False))  # save partial progress
    if len(doc["analyses"]) < len(MODELS):
        print(f"T{tag}: {len(doc['analyses'])}/{len(MODELS)} reviews; rerun to fill the gaps")
        return
    cs = sorted(a["credence"] for a in doc["analyses"])
    doc["stats"] = {"mean": round(sum(cs) / len(cs), 1), "median": (cs[1] + cs[2]) / 2, "min": cs[0], "max": cs[-1], "spread": cs[-1] - cs[0]}
    try:
        doc["synthesis"] = call(SYNTH, synth_prompt(t, doc["analyses"]), tag, lambda r: r if r.get("summary") else (_ for _ in ()).throw(ValueError("no summary")))
        doc["synthesis"]["model"] = SYNTH["model"]
    except Exception as e:  # noqa: BLE001
        print(f"  !! synthesis: {e}")
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    s = doc["stats"]
    print(f"T{tag} {t['short']}: credences {cs} · median {s['median']} · spread {s['spread']}")


def main():
    argv = sys.argv[1:]
    if "--all" in argv:
        ids = sorted(TOPICS)
    elif "--missing" in argv:
        ids = [i for i in sorted(TOPICS) if not (OUT / f"{i:02d}.json").exists()
               or "synthesis" not in json.loads((OUT / f"{i:02d}.json").read_text())]
    else:
        ids = [int(a) for a in argv]
    if not ids:
        sys.exit(__doc__)
    with ThreadPoolExecutor(max_workers=3) as ex:
        list(ex.map(review, ids))


if __name__ == "__main__":
    main()
