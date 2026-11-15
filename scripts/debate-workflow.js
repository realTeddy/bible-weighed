export const meta = {
  name: 'bible-debates',
  description: 'Theist vs atheist debates (up to 20 rounds, early stop) judged by a 3-judge panel',
  phases: [
    { title: 'Debate', detail: 'theist and atheist alternate turns; stop on concession or mutual close' },
    { title: 'Judge', detail: '3 independent judges score each debate' },
  ],
}

const TOPICS = args.topics
const MAX_ROUNDS = args.maxRounds || 20
const MIN_EXIT_ROUND = 4

const str = { type: 'string' }
const int10 = { type: 'integer', minimum: 1, maximum: 10 }
const sideEnum = { type: 'string', enum: ['theist', 'atheist'] }

const TURN_SCHEMA = {
  type: 'object',
  properties: {
    speech: { type: 'string', description: 'Your spoken contribution, markdown allowed' },
    claims: { type: 'array', items: { type: 'object', properties: { claim: str, confidence: { type: 'integer', minimum: 0, maximum: 100 } }, required: ['claim', 'confidence'] } },
    concessions: { type: 'array', items: { type: 'object', properties: { point: str, significance: { type: 'string', enum: ['minor', 'moderate', 'major'] } }, required: ['point', 'significance'] } },
    sources: { type: 'array', items: { type: 'object', properties: { citation: str, kind: { type: 'string', enum: ['scripture', 'scholarship', 'archaeology', 'manuscript', 'ancient_source', 'philosophy', 'science', 'other'] } }, required: ['citation', 'kind'] } },
    questions: { type: 'array', items: str },
    signal: { type: 'string', enum: ['continue', 'propose_closing', 'concede_resolution'] },
    signal_reason: str,
  },
  required: ['speech', 'claims', 'concessions', 'sources', 'questions', 'signal', 'signal_reason'],
}

const sideScores = {
  type: 'object',
  properties: { evidence: int10, logic: int10, engagement: int10, honesty: int10, clarity: int10, overall: int10 },
  required: ['evidence', 'logic', 'engagement', 'honesty', 'clarity', 'overall'],
}

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    scores: { type: 'object', properties: { theist: sideScores, atheist: sideScores }, required: ['theist', 'atheist'] },
    winner: { type: 'string', enum: ['theist', 'atheist', 'draw'] },
    margin: { type: 'string', enum: ['narrow', 'clear', 'decisive'] },
    verdict: str,
    highlights: { type: 'array', items: { type: 'object', properties: { round: { type: 'integer' }, side: sideEnum, quote: str, why: str }, required: ['round', 'side', 'quote', 'why'] } },
    fallacies: { type: 'array', items: { type: 'object', properties: { round: { type: 'integer' }, side: sideEnum, name: str, quote: str, explanation: str }, required: ['round', 'side', 'name', 'quote', 'explanation'] } },
    factual_errors: { type: 'array', items: { type: 'object', properties: { round: { type: 'integer' }, side: sideEnum, claim: str, correction: str, severity: { type: 'string', enum: ['minor', 'moderate', 'major'] } }, required: ['round', 'side', 'claim', 'correction', 'severity'] } },
    key_concessions: { type: 'array', items: { type: 'object', properties: { round: { type: 'integer' }, side: sideEnum, point: str, impact: { type: 'string', enum: ['minor', 'moderate', 'major'] } }, required: ['round', 'side', 'point', 'impact'] } },
    turning_point: { type: 'object', properties: { round: { type: 'integer' }, description: str }, required: ['round', 'description'] },
    best_argument: { type: 'object', properties: { theist: str, atheist: str }, required: ['theist', 'atheist'] },
    unanswered: { type: 'object', properties: { theist: { type: 'array', items: str }, atheist: { type: 'array', items: str } }, required: ['theist', 'atheist'], description: 'Arguments made BY each side that the opponent never adequately answered' },
  },
  required: ['scores', 'winner', 'margin', 'verdict', 'highlights', 'fallacies', 'factual_errors', 'key_concessions', 'turning_point', 'best_argument', 'unanswered'],
}

const PERSONA = {
  theist: 'a Christian scholar and apologist (classical/evangelical tradition) with deep expertise in biblical studies, history, and philosophy of religion, arguing at the level of the best published academic defenders of Christianity',
  atheist: 'a secular scholar and philosopher with deep expertise in biblical criticism, ancient history, science, and philosophy of religion, arguing at the level of the best published academic critics of Christianity',
}

function renderTranscript(turns) {
  if (!turns.length) return '(no turns yet — you speak first)'
  return turns.map(t => {
    let s = `--- Round ${t.round} · ${t.side.toUpperCase()} · ${t.type} ---\n${t.speech}`
    if (t.concessions.length) s += `\n[Concessions: ${t.concessions.map(c => `${c.point} (${c.significance})`).join('; ')}]`
    if (t.questions.length) s += `\n[Questions to opponent: ${t.questions.join(' | ')}]`
    if (t.signal !== 'continue') s += `\n[Signal: ${t.signal} — ${t.signal_reason}]`
    return s
  }).join('\n\n')
}

const TYPE_INSTR = {
  opening: 'This is your OPENING STATEMENT (max ~450 words). Lay out your strongest case. If your opponent has already opened, you may briefly note their points but focus on your own case.',
  exchange: 'This is an EXCHANGE turn (max ~300 words). Respond directly to your opponent\'s most recent turn: answer every question they asked you directly and honestly first, then rebut, press your strongest unanswered points, and optionally ask up to 2 pointed questions. Do not simply repeat earlier speeches — advance the debate.',
  closing: 'This is your CLOSING STATEMENT (max ~400 words). No new arguments. Summarize where the debate stands, state plainly what you concede, and what you believe still stands. Set signal to "continue" (signals are ignored in closings).',
}

function debaterPrompt(topic, side, round, type, turns) {
  const stance = side === 'theist' ? 'FOR (affirming)' : 'AGAINST (denying)'
  const opp = side === 'theist' ? 'atheist' : 'theist'
  return `You are the ${side.toUpperCase()} debater in a formal, honest, moderated debate. You are ${PERSONA[side]}.

RESOLUTION: "${topic.resolution}"
You argue ${stance} the resolution. Your opponent is the ${opp} debater.

It is ROUND ${round} of at most ${MAX_ROUNDS}. ${TYPE_INSTR[type]}

HONESTY RULES (the judges score these heavily):
- Steelman: engage your opponent's strongest version of their argument, never a strawman.
- Concede a point when the evidence or logic genuinely requires it. You are never obligated to concede, but refusing an obviously sound point, dodging questions, or moving goalposts will be penalized. Record every concession you make (in this turn only) in "concessions".
- Cite specific, real sources (verses with references, named scholars and works, archaeological sites, manuscripts, ancient authors). NEVER invent a source, quote, or statistic. If unsure of a detail, say so.
- In "claims", list the main claims you make THIS turn with your honest confidence (0-100).
- Stay civil, rigorous, and on-topic. Do not use any tools; argue from your own knowledge.

ENDING THE DEBATE (signal field):
- "continue": the debate is still productive.
- "propose_closing": you believe the debate has stopped advancing (positions are clear, arguments are repeating). If BOTH debaters propose closing back-to-back (from round ${MIN_EXIT_ROUND} on), the debate moves to closing statements. Only propose this honestly — not to escape a hard question.
- "concede_resolution": you are genuinely persuaded that your side of the resolution cannot be maintained. This ends the debate. Use only if honestly warranted.
Explain your choice in "signal_reason" (one sentence; this is visible to the opponent and judges).

TRANSCRIPT SO FAR:
${renderTranscript(turns)}

Now give your ${type} turn as the ${side}. Put the full spoken text in "speech".`
}

const lastTwoBothClose = (turns) => {
  if (turns.length < 2) return false
  const [a, b] = turns.slice(-2)
  return a.side !== b.side && a.signal === 'propose_closing' && b.signal === 'propose_closing' && b.round >= MIN_EXIT_ROUND
}

async function runDebate(topic) {
  const tag = `T${String(topic.id).padStart(2, '0')}`
  const turns = []
  let endReason = 'max_rounds'
  let conceded = null
  const takeTurn = async (side, round, type) => {
    const t = await agent(debaterPrompt(topic, side, round, type, turns), {
      label: `${tag} R${round} ${side}${type === 'closing' ? ' closing' : ''}`,
      phase: 'Debate', schema: TURN_SCHEMA, effort: 'medium',
    })
    if (!t) throw new Error(`${tag} R${round} ${side} failed`)
    turns.push({ round, side, type, ...t, signal: type === 'closing' ? 'continue' : t.signal })
    return turns[turns.length - 1]
  }

  let round = 1
  outer: for (; round <= MAX_ROUNDS; round++) {
    const type = round === 1 ? 'opening' : round === MAX_ROUNDS ? 'closing' : 'exchange'
    for (const side of ['theist', 'atheist']) {
      const t = await takeTurn(side, round, type)
      if (type === 'closing') continue
      if (t.signal === 'concede_resolution' && round >= 2) { conceded = side; endReason = `${side}_conceded`; break outer }
      if (lastTwoBothClose(turns)) { endReason = 'mutual_close'; break outer }
    }
    if (type === 'closing') break
  }
  if (turns[turns.length - 1].type !== 'closing') {
    const closeRound = Math.min(round + 1, MAX_ROUNDS)
    for (const side of ['theist', 'atheist']) await takeTurn(side, closeRound, 'closing')
  }
  log(`${tag} ${topic.short}: ${turns.length} turns, ended by ${endReason}`)
  return { topic, turns, endReason, conceded }
}

const JUDGES = [
  { id: 'historian', lens: 'a historian of antiquity and biblical scholar. You pay special attention to factual and historical accuracy of claims about texts, manuscripts, archaeology, and scholarship' },
  { id: 'philosopher', lens: 'an analytic philosopher and logician. You pay special attention to argument validity, burden of proof, and logical fallacies' },
  { id: 'adjudicator', lens: 'an experienced competitive-debate adjudicator. You pay special attention to clash, responsiveness to questions, and intellectual honesty' },
]

function judgePrompt(d, j) {
  return `You are a judge on a 3-person panel evaluating a debate. You are ${j.lens}. You must be strictly impartial: score the QUALITY OF ARGUMENTATION, not your own opinion on whether the resolution is true. Do not favor either side because of your own beliefs or because of what you think is the "safe" answer.

RESOLUTION: "${d.topic.resolution}" (theist argues FOR, atheist argues AGAINST)
Debate ended by: ${d.endReason}

Score each side 1-10 on:
- evidence: accuracy and quality of evidence and sources (penalize fabricated or wrong facts)
- logic: soundness of reasoning
- engagement: directly answering the opponent's actual arguments and questions
- honesty: intellectual honesty — appropriate concessions, charity, no dodging or goalpost-moving (conceding a point is NOT a weakness when warranted)
- clarity: clarity and persuasiveness
- overall: your holistic 1-10 score for the debater
Use the full scale; 5 is average for an expert debater, 8+ is excellent, 10 is near-flawless.

Also give: winner and margin; a 150-300 word verdict; 3-5 highlights (exact short quotes with round); every logical fallacy you detect (with quote); every factual error (with correction); the key concessions and their impact; the turning point; each side's best argument; and arguments each side made that the opponent left unanswered. Use empty arrays where nothing applies. Quote accurately from the transcript.

FULL TRANSCRIPT:
${renderTranscript(d.turns)}`
}

const W = { evidence: 0.25, logic: 0.25, engagement: 0.20, honesty: 0.15, clarity: 0.15 }
const weighted = s => Math.round(Object.keys(W).reduce((a, k) => a + s[k] * W[k], 0) * 100) / 100
const avg = xs => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 100) / 100

async function judgeDebate(d) {
  const tag = `T${String(d.topic.id).padStart(2, '0')}`
  const results = (await parallel(JUDGES.map(j => () =>
    agent(judgePrompt(d, j), { label: `${tag} judge:${j.id}`, phase: 'Judge', schema: JUDGE_SCHEMA, effort: 'high' })
      .then(r => r && { judge: j.id, ...r, weighted: { theist: weighted(r.scores.theist), atheist: weighted(r.scores.atheist) } })
  ))).filter(Boolean)
  const votes = { theist: 0, atheist: 0, draw: 0 }
  results.forEach(r => votes[r.winner]++)
  const panelWinner = votes.theist >= 2 ? 'theist' : votes.atheist >= 2 ? 'atheist' : 'draw'
  const panel = {
    votes, winner: panelWinner,
    overall: { theist: avg(results.map(r => r.scores.theist.overall)), atheist: avg(results.map(r => r.scores.atheist.overall)) },
    weighted: { theist: avg(results.map(r => r.weighted.theist)), atheist: avg(results.map(r => r.weighted.atheist)) },
  }
  return { ...d, judges: results, panel }
}

const out = await pipeline(TOPICS, runDebate, judgeDebate)
const done = out.filter(Boolean)
return {
  summary: done.map(d => ({ id: d.topic.id, short: d.topic.short, turns: d.turns.length, endReason: d.endReason, panel: d.panel })),
  failed: TOPICS.filter(t => !done.find(d => d.topic.id === t.id)).map(t => t.id),
}
