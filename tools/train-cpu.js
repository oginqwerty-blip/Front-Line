const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WEIGHTS_PATH = path.join(ROOT, "cpu-weights.json");
const COLORS = ["ember", "tide", "moss", "sun", "stone", "violet"];
const WEIGHT_KEYS = [
  "center",
  "ownClaimedPenalty",
  "opponentClaimedPenalty",
  "progress",
  "immediateThreat",
  "threatPerCard",
  "completeBonus",
  "claimBonus",
  "completeFormationType",
  "possibleFormationType",
  "total",
  "high",
  "rankTotal",
  "sameColorPartial",
  "nearRunPartial",
  "twoInLine",
  "oneInLine",
];

function args() {
  const out = { generations: 12, games: 160, candidates: 8, seed: Date.now(), write: false };
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--write") out.write = true;
    else if (arg.startsWith("--")) out[arg.slice(2)] = Number(process.argv[i + 1]);
  }
  return out;
}

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomNormal(rand) {
  return Math.sqrt(-2 * Math.log(Math.max(0.000001, rand()))) * Math.cos(2 * Math.PI * rand());
}

function clampWeight(key, value) {
  if (key.endsWith("Penalty")) return Math.max(-220, Math.min(0, value));
  if (["center", "total", "high", "rankTotal"].includes(key)) return Math.max(0.1, Math.min(8, value));
  return Math.max(0, Math.min(260, value));
}

function loadWeights() {
  return JSON.parse(fs.readFileSync(WEIGHTS_PATH, "utf8"));
}

function saveWeights(weights) {
  fs.writeFileSync(`${WEIGHTS_PATH}.tmp`, `${JSON.stringify(weights, null, 2)}\n`);
  fs.renameSync(`${WEIGHTS_PATH}.tmp`, WEIGHTS_PATH);
}

function mutate(weights, rand, strength = 0.22) {
  const next = { ...weights };
  for (const key of WEIGHT_KEYS) {
    const base = Number(next[key] ?? 0);
    const scale = Math.max(2, Math.abs(base) * strength);
    next[key] = Number(clampWeight(key, base + randomNormal(rand) * scale).toFixed(3));
  }
  return next;
}

function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    for (let rank = 1; rank <= 10; rank += 1) {
      deck.push({ id: `${color}-${rank}`, type: "troop", color, rank });
    }
  }
  return deck;
}

function shuffle(items, rand) {
  const deck = [...items];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function newGame(rand) {
  const state = {
    players: [
      { hand: [], rows: Array.from({ length: 9 }, () => []), completedAt: Array(9).fill(null), claimed: [] },
      { hand: [], rows: Array.from({ length: 9 }, () => []), completedAt: Array(9).fill(null), claimed: [] },
    ],
    deck: shuffle(buildDeck(), rand),
    active: 0,
    completionCounter: 0,
  };
  for (let i = 0; i < 7; i += 1) {
    draw(state, 0);
    draw(state, 1);
  }
  return state;
}

function draw(state, player) {
  const card = state.deck.shift();
  if (card) state.players[player].hand.push(card);
}

function formation(cards) {
  if (cards.length !== 3) return null;
  const sorted = [...cards].sort((a, b) => a.rank - b.rank);
  const ranks = sorted.map((card) => card.rank);
  const total = ranks.reduce((sum, rank) => sum + rank, 0);
  const sameColor = cards.every((card) => card.color === cards[0].color);
  const sameRank = cards.every((card) => card.rank === cards[0].rank);
  const consecutive = ranks.every((rank, index) => index === 0 || ranks[index - 1] + 1 === rank);
  let type = 0;
  if (sameColor && consecutive) type = 4;
  else if (sameRank) type = 3;
  else if (sameColor) type = 2;
  else if (consecutive) type = 1;
  return { type, total, high: ranks[2] };
}

function compareFormations(left, right) {
  if (!left || !right) return 0;
  if (left.type !== right.type) return left.type - right.type;
  if (left.total !== right.total) return left.total - right.total;
  return left.high - right.high;
}

function owner(state, banner) {
  if (state.players[0].claimed.includes(banner)) return 0;
  if (state.players[1].claimed.includes(banner)) return 1;
  return null;
}

function markCompleted(state, player, banner) {
  if (state.players[player].rows[banner].length === 3 && state.players[player].completedAt[banner] === null) {
    state.completionCounter += 1;
    state.players[player].completedAt[banner] = state.completionCounter;
  }
}

function claimAll(state) {
  for (let player = 0; player < 2; player += 1) {
    for (let banner = 0; banner < 9; banner += 1) {
      if (owner(state, banner) !== null) continue;
      const mine = state.players[player].rows[banner];
      const theirs = state.players[1 - player].rows[banner];
      if (mine.length !== 3 || theirs.length !== 3) continue;
      const result = compareFormations(formation(mine), formation(theirs));
      const tieBreak = state.players[player].completedAt[banner] < state.players[1 - player].completedAt[banner] ? 1 : -1;
      if (result > 0 || (result === 0 && tieBreak > 0)) state.players[player].claimed.push(banner);
    }
  }
}

function winner(state) {
  for (let player = 0; player < 2; player += 1) {
    const claimed = state.players[player].claimed;
    if (claimed.length >= 5) return player;
    const sorted = [...claimed].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 2; i += 1) {
      if (sorted[i] + 1 === sorted[i + 1] && sorted[i + 1] + 1 === sorted[i + 2]) return player;
    }
  }
  return null;
}

function chooseMove(state, player, weights) {
  let best = null;
  for (const card of state.players[player].hand) {
    for (let banner = 0; banner < 9; banner += 1) {
      if (state.players[player].rows[banner].length >= 3) continue;
      const score = moveScore(state, player, card, banner, weights);
      if (!best || score > best.score) best = { card, banner, score };
    }
  }
  return best;
}

function moveScore(state, player, card, banner, w) {
  const own = owner(state, banner);
  const mine = state.players[player].rows[banner];
  const theirs = state.players[1 - player].rows[banner];
  const nextMine = [...mine, card];
  const center = (8 - Math.abs(4 - banner)) * w.center;
  const ownerPenalty = own === player ? w.ownClaimedPenalty : own === 1 - player ? w.opponentClaimedPenalty : 0;
  const progress = nextMine.length * w.progress;
  const threat = theirs.length === 2 && own === null ? w.immediateThreat : theirs.length * w.threatPerCard;
  let score = formationValue(nextMine, w) + center + ownerPenalty + progress + threat + linePressure(state, player, banner, w);
  if (nextMine.length === 3) score += w.completeBonus + wouldClaim(state, player, card, banner) * w.claimBonus;
  return score;
}

function formationValue(cards, w) {
  const complete = formation(cards);
  if (complete) return complete.type * w.completeFormationType + complete.total * w.total + complete.high * w.high;
  const ranks = cards.map((card) => card.rank);
  const rankTotal = ranks.reduce((sum, rank) => sum + rank, 0) * w.rankTotal;
  const sameColor = cards.length > 1 && cards.every((card) => card.color === cards[0].color) ? w.sameColorPartial : 0;
  const sorted = [...ranks].sort((a, b) => a - b);
  const nearRun = sorted.every((rank, index) => index === 0 || rank - sorted[index - 1] <= 2) ? w.nearRunPartial : 0;
  return rankTotal + sameColor + nearRun;
}

function linePressure(state, player, banner, w) {
  const claimed = new Set(state.players[player].claimed);
  let score = 0;
  for (const offset of [-2, -1, 0]) {
    const line = [banner + offset, banner + offset + 1, banner + offset + 2];
    if (line.some((index) => index < 0 || index > 8)) continue;
    const owned = line.filter((index) => claimed.has(index)).length;
    if (owned === 2) score += w.twoInLine;
    else if (owned === 1) score += w.oneInLine;
  }
  return score;
}

function wouldClaim(state, player, card, banner) {
  const mine = state.players[player].rows[banner];
  const theirs = state.players[1 - player].rows[banner];
  if (theirs.length !== 3) return 0;
  const result = compareFormations(formation([...mine, card]), formation(theirs));
  return result > 0 ? 1 : 0;
}

function playGame(weightsByPlayer, seed) {
  const rand = rng(seed);
  const state = newGame(rand);
  for (let turn = 0; turn < 120; turn += 1) {
    claimAll(state);
    const won = winner(state);
    if (won !== null) return won;
    const player = state.active;
    const move = chooseMove(state, player, weightsByPlayer[player]);
    if (move) {
      const hand = state.players[player].hand;
      hand.splice(hand.findIndex((card) => card.id === move.card.id), 1);
      state.players[player].rows[move.banner].push(move.card);
      markCompleted(state, player, move.banner);
      draw(state, player);
    }
    claimAll(state);
    const afterMoveWinner = winner(state);
    if (afterMoveWinner !== null) return afterMoveWinner;
    state.active = 1 - state.active;
  }
  const diff = state.players[0].claimed.length - state.players[1].claimed.length;
  return diff === 0 ? -1 : diff > 0 ? 0 : 1;
}

function evaluate(candidate, baseline, games, seed) {
  let score = 0;
  for (let i = 0; i < games; i += 1) {
    const candidateSide = i % 2;
    const winnerIndex = playGame(
      candidateSide === 0 ? [candidate, baseline] : [baseline, candidate],
      seed + i * 9973,
    );
    if (winnerIndex === -1) score += 0.5;
    else if (winnerIndex === candidateSide) score += 1;
  }
  return score / games;
}

function main() {
  const options = args();
  const rand = rng(options.seed);
  let best = loadWeights();
  let bestRate = 0.5;
  for (let generation = 1; generation <= options.generations; generation += 1) {
    let generationBest = best;
    let generationRate = bestRate;
    for (let candidateIndex = 0; candidateIndex < options.candidates; candidateIndex += 1) {
      const candidate = mutate(best, rand, 0.18 + generation * 0.008);
      const rate = evaluate(candidate, best, options.games, options.seed + generation * 100000 + candidateIndex * 1000);
      if (rate > generationRate) {
        generationRate = rate;
        generationBest = candidate;
      }
    }
    best = generationBest;
    bestRate = generationRate;
    console.log(`generation ${generation}: best win rate ${(bestRate * 100).toFixed(1)}%`);
  }
  console.log(JSON.stringify(best, null, 2));
  if (options.write) {
    saveWeights(best);
    console.log(`wrote ${path.relative(process.cwd(), WEIGHTS_PATH)}`);
  }
}

main();
