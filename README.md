# The Bible, Weighed

**Live site: https://bible.tewodros.me**

32 of the most debated questions about the Bible and God (the Flood, the Exodus, the Resurrection, the problem of evil, and more). Each question was given to four AI models from four different companies. Each one, working independently and assigned no side, weighed the evidence and gave a **probability that the traditional claim is true**, along with a structured review: sub-claims, the questions the answer hinges on, the strongest points on each side, weak arguments on each side, and what would change its mind. A fifth step summarizes where the four agree and disagree.

| Reviewer | Model | Run via |
|---|---|---|
| GPT | `gpt-6.1-terra` | GitHub Copilot CLI |
| Gemini | `gemini-3.8-flash` | GitHub Copilot CLI |
| Grok | `grok-4.7` | GitHub Copilot CLI |
| Claude | `claude-opus-5-5` | Claude Code CLI |
| Synthesis | `gpt-6.1-terra` | GitHub Copilot CLI |

## Why not debates?

The project started as AI-vs-AI debates judged by an AI panel. They showed why debates are a poor way to find the truth: the Problem of Evil debate was won 3–0 by the theist on a definition ("compatible" taken as bare logical consistency), while the independent reviews found that suffering is significant evidence against the biblical God. The two debates are kept on the site as a case study.

## Limits

- AI models can be wrong, including confidently wrong. This is a map of the evidence and arguments, not a final word.
- All four models learned from largely the same body of writing; using four companies reduces shared bias but does not remove it.
- **Sources are cited from memory and have not been checked.** Corrections are welcome.
- Probabilities on moral and philosophical questions are rough summaries of where the arguments lean.

## Repository layout

```
data/topics.json          the 32 questions and the exact claims tested
data/reviews/NN.json      the four reviews + synthesis for each topic (what the site shows)
data/review-raw/          raw model replies, including retries
data/reviews-old/         earlier reviews of claims that were later reworded
data/debates/             the two pilot debates (turns + judge verdicts)
data/judge-raw/           raw judge replies
scripts/review.py         runs the four reviews and the synthesis for a topic
scripts/judge.py          judges a debate with the 3-model panel
scripts/debate-workflow.js  the Claude Code workflow that ran the debates
scripts/build.py          builds site/ (summary data, per-topic JSON, static pages, sitemap)
scripts/page.html         page template
site/                     the static site (vanilla JS + hand-built SVG, no dependencies)
```

## Reproduce or extend

Requires Python 3.11+, the [GitHub Copilot CLI](https://github.com/features/copilot/cli) and [Claude Code](https://claude.com/claude-code), both logged in.

```bash
# add or edit a topic in data/topics.json, then:
python3 scripts/review.py 33          # or --missing for every unreviewed topic
python3 scripts/build.py site
python3 scripts/serve.py              # preview at http://127.0.0.1:8765
npx wrangler deploy                   # deploy (Cloudflare Workers static assets)
python3 scripts/submit_index.py       # notify search engines via IndexNow
```

The full reviewer prompt is in `scripts/review.py` (`prompt()`); the synthesis prompt is `synth_prompt()`.

## Contributing

Found a factual error, a fabricated source, or a claim worded unfairly to one side? Please open an issue. Suggestions for new topics are welcome too; the bar is "frequently debated, and answerable with evidence or argument".

## License

Code: [MIT](LICENSE). Data and written content (`data/`, the reviews and text on the site): [CC BY 4.0](LICENSE-DATA).
