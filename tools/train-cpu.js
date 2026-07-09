const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WEIGHTS_PATH = path.join(ROOT, "cpu-weights.json");
const COLORS = ["ember", "tide", "moss", "sun", "stone", "violet"];
const TACTICS = [
  { id: "marshal", type: "tactic", kind: "formation", wild: "leader" },
  { id: "envoy", type: "tactic", kind: "formation", wild: "leader" },
  { id: "charger", type: "tactic", kind: "formation", wild: "rank8" },
  { id: "squires", type: "tactic", kind: "formation", wild: "rank123" },
  { id: "mist", type: "tactic", kind: "environment", effect: "fog" },
  { id: "bog", type: "tactic", kind: "environment", effect: "mud" },
  { id: "scout", type: "tactic", kind: "command", effect: "scout" },
  { id: "shift", type: "tactic", kind: "command", effect: "redeploy" },
  { id: "rout", type: "tactic", kind: "command", effect: "deserter" },
  { id: "turncoat", type: "tactic", kind: "command", effect: "traitor" },
];
const WEIGHT_KEYS = [
  "center",
  "ownClaimedPenalty",
  "opponentClaimedPenalty",
  "progress",
  "immediateThreat",
  "threatPerCard",
  "completeBonus",
  "claimBonus",
  "tacticPenalty",
  "environmentPenalty",
  "completeFormationType",
  "possibleFormationType",
  "total",
  "high",
  "rankTotal",
  "sameColorPartial",
  "nearRunPartial",
  "twoInLine",
  "oneInLine",
  "scoutValue",
  "routValue",
  "turnoverValue",
  "redeployValue",
  "commandTempo",
  "opponentReplyPenalty",
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
  if (key === "opponentReplyPenalty") return Math.max(0, Math.min(2.5, value));
  if (key.endsWith("Penalty")) return Math.max(-240, Math.min(0, value));
  if (["center", "total", "high", "rankTotal"].includes(key)) return Math.max(0.1, Math.min(10, value));
  return Math.max(0, Math.min(320, value));
}

function loadWeights() {
  return JSON.parse(fs.readFileSync(WEIGHTS_PATH, "utf8"));
}

function saveWeights(weights) {
  fs.writeFileSync(`${WEIGHTS_PATH}.tmp`, `${JSON.stringify(weights, null, 2)}\n`);
  fs.renameSync(`${WEIGHTS_PATH}.tmp`, WEIGHTS_PATH);
}

function mutate(weights, rand, strength = 0.18) {
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

function buildTacticDeck() {
  return TACTICS.map((card) => ({ ...card, id: `tactic-${card.id}` }));
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
      { hand: [], rows: Array.from({ length: 9 }, () => []), completedAt: Array(9).fill(null), claimed: [], tacticsPlayed: 0, leaderPlayed: false },
      { hand: [], rows: Array.from({ length: 9 }, () => []), completedAt: Array(9).fill(null), claimed: [], tacticsPlayed: 0, leaderPlayed: false },
    ],
    bannerEffects: Array.from({ length: 9 }, () => ({ fog: false, mud: false })),
    deck: shuffle(buildDeck(), rand),
    tacticDeck: shuffle(buildTacticDeck(), rand),
    active: 0,
    completionCounter: 0,
  };
  for (let i = 0; i < 7; i += 1) {
    drawTroop(state, 0);
    drawTroop(state, 1);
  }
  return state;
}

function drawTroop(state, player) {
  const card = state.deck.shift();
  if (card) state.players[player].hand.push(card);
  return card ?? null;
}

function drawTactic(state, player) {
  const card = state.tacticDeck.shift();
  if (card) state.players[player].hand.push(card);
  return card ?? null;
}

function drawBest(state, player) {
  const tacticCards = state.players[player].hand.filter((card) => card.type === "tactic").length;
  const canDrawTactic = state.tacticDeck.length > 0
    && tacticCards < 2
    && state.players[player].tacticsPlayed <= state.players[1 - player].tacticsPlayed;
  if (canDrawTactic || state.deck.length === 0) return drawTactic(state, player);
  return drawTroop(state, player);
}

function bannerSize(state, banner) {
  return state.bannerEffects[banner].mud ? 4 : 3;
}

function concreteOptions(card) {
  if (card.type !== "tactic") return [card];
  if (card.wild === "leader") return COLORS.flatMap((color) => Array.from({ length: 10 }, (_, i) => concreteTactic(card, color, i + 1)));
  if (card.wild === "rank8") return COLORS.map((color) => concreteTactic(card, color, 8));
  if (card.wild === "rank123") return COLORS.flatMap((color) => [1, 2, 3].map((rank) => concreteTactic(card, color, rank)));
  return [];
}

function concreteTactic(source, color, rank) {
  return { id: `${source.id}-${color}-${rank}`, type: "troop", color, rank, sourceId: source.id };
}

function expandWilds(cards, index = 0, prefix = [], output = []) {
  if (index === cards.length) {
    output.push(prefix);
    return output;
  }
  for (const option of concreteOptions(cards[index])) expandWilds(cards, index + 1, [...prefix, option], output);
  return output;
}

function formation(cards, state, banner) {
  if (cards.length !== bannerSize(state, banner)) return null;
  let best = null;
  for (const variant of expandWilds(cards)) {
    const score = basicFormation(variant, state, banner);
    if (!best || compareFormations(score, best) > 0) best = score;
  }
  return best;
}

function basicFormation(cards, state, banner) {
  const sorted = [...cards].sort((a, b) => a.rank - b.rank);
  const ranks = sorted.map((card) => card.rank);
  const total = ranks.reduce((sum, rank) => sum + rank, 0);
  if (state.bannerEffects[banner].fog) return { type: 0, total, high: ranks[ranks.length - 1] };
  const sameColor = cards.every((card) => card.color === cards[0].color);
  const sameRank = cards.every((card) => card.rank === cards[0].rank);
  const consecutive = ranks.every((rank, index) => index === 0 || ranks[index - 1] + 1 === rank);
  let type = 0;
  if (sameColor && consecutive) type = 4;
  else if (sameRank) type = 3;
  else if (sameColor) type = 2;
  else if (consecutive) type = 1;
  return { type, total, high: ranks[ranks.length - 1] };
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

function canPlace(state, player, banner) {
  return state.players[player].rows[banner].length < bannerSize(state, banner);
}

function markCompleted(state, player, banner) {
  if (state.players[player].rows[banner].length === bannerSize(state, banner) && state.players[player].completedAt[banner] === null) {
    state.completionCounter += 1;
    state.players[player].completedAt[banner] = state.completionCounter;
  }
}

function canPlayTactic(state, player, card) {
  if (!card || card.type !== "tactic") return false;
  if (state.players[player].tacticsPlayed + 1 > state.players[1 - player].tacticsPlayed + 1) return false;
  if (card.wild === "leader" && state.players[player].leaderPlayed) return false;
  return true;
}

function claimAll(state) {
  for (let player = 0; player < 2; player += 1) {
    for (let banner = 0; banner < 9; banner += 1) {
      if (owner(state, banner) !== null) continue;
      const mine = state.players[player].rows[banner];
      const theirs = state.players[1 - player].rows[banner];
      if (mine.length !== bannerSize(state, banner) || theirs.length !== bannerSize(state, banner)) continue;
      const result = compareFormations(formation(mine, state, banner), formation(theirs, state, banner));
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

function chooseAction(state, player, weights, opponentWeights = weights, includeLookahead = true) {
  const actions = actionCandidates(state, player, weights);
  let best = null;
  for (const action of actions) {
    const scored = includeLookahead
      ? scoreWithLookahead(state, player, action, weights, opponentWeights)
      : { ...action, baseScore: action.score };
    if (!best || scored.score > best.score) best = scored;
  }
  return best;
}

function actionCandidates(state, player, weights) {
  const actions = [];
  for (const card of state.players[player].hand) {
    const cardActions = card.type === "tactic" && card.kind === "command"
      ? commandActions(state, player, card, weights)
      : placeActions(state, player, card, weights);
    actions.push(...cardActions);
  }
  return actions;
}

function scoreWithLookahead(state, player, action, weights, opponentWeights) {
  const replyScore = bestOpponentReplyScore(state, player, action, weights, opponentWeights);
  const penalty = Number.isFinite(weights.opponentReplyPenalty) ? weights.opponentReplyPenalty : 0.65;
  return {
    ...action,
    baseScore: action.score,
    replyScore,
    score: action.score - replyScore * penalty,
  };
}

function bestOpponentReplyScore(state, player, action, weights, opponentWeights) {
  const next = JSON.parse(JSON.stringify(state));
  playAction(next, player, action, weights);
  claimAll(next);
  const opponent = 1 - player;
  next.active = opponent;
  const reply = chooseAction(next, opponent, opponentWeights, weights, false);
  return Math.max(0, reply?.baseScore ?? reply?.score ?? 0);
}

function placeActions(state, player, card, w) {
  const output = [];
  for (let banner = 0; banner < 9; banner += 1) {
    if (card.type === "tactic") {
      if (!canPlayTactic(state, player, card)) continue;
      if (card.kind === "formation" && !canPlace(state, player, banner)) continue;
      if (card.kind === "environment" && !canUseEnvironment(state, banner, card)) continue;
    } else if (!canPlace(state, player, banner)) continue;
    const score = card.kind === "environment"
      ? environmentScore(state, player, card, banner, w)
      : moveScore(state, player, card, banner, w) - (card.type === "tactic" ? w.tacticPenalty : 0);
    output.push({ type: "place", card, banner, score });
  }
  return output;
}

function canUseEnvironment(state, banner, card) {
  if (owner(state, banner) !== null) return false;
  if (card.effect === "fog" && state.bannerEffects[banner].fog) return false;
  if (card.effect === "mud" && state.bannerEffects[banner].mud) return false;
  return true;
}

function environmentScore(state, player, card, banner, w) {
  const mine = state.players[player].rows[banner];
  const theirs = state.players[1 - player].rows[banner];
  if (card.effect === "mud") return theirs.length >= 2 && mine.length <= theirs.length ? w.environmentPenalty + w.immediateThreat : -999;
  const mineTotal = mine.reduce((sum, item) => sum + (item.rank ?? 5), 0);
  const theirTotal = theirs.reduce((sum, item) => sum + (item.rank ?? 5), 0);
  return mine.length >= 2 && mineTotal >= theirTotal ? w.environmentPenalty + mineTotal - theirTotal : -999;
}

function commandActions(state, player, card, w) {
  if (!canPlayTactic(state, player, card)) return [];
  if (card.effect === "scout") return state.deck.length + state.tacticDeck.length >= 3 ? [{ type: "scout", card, score: w.scoutValue + w.commandTempo }] : [];
  if (card.effect === "deserter") return routActions(state, player, card, w);
  if (card.effect === "traitor") return turnoverActions(state, player, card, w);
  if (card.effect === "redeploy") return redeployActions(state, player, card, w);
  return [];
}

function routActions(state, player, card, w) {
  const output = [];
  const opponent = 1 - player;
  for (let banner = 0; banner < 9; banner += 1) {
    if (owner(state, banner) !== null) continue;
    state.players[opponent].rows[banner].forEach((target, cardIndex) => {
      output.push({ type: "rout", card, banner, cardIndex, score: w.routValue + boardCardThreat(state, opponent, banner, target, w) });
    });
  }
  return output;
}

function turnoverActions(state, player, card, w) {
  const output = [];
  const opponent = 1 - player;
  for (let sourceBanner = 0; sourceBanner < 9; sourceBanner += 1) {
    if (owner(state, sourceBanner) !== null) continue;
    state.players[opponent].rows[sourceBanner].forEach((target, cardIndex) => {
      if (target.type !== "troop") return;
      for (let destinationBanner = 0; destinationBanner < 9; destinationBanner += 1) {
        if (!canPlace(state, player, destinationBanner)) continue;
        output.push({
          type: "turnover",
          card,
          sourceBanner,
          cardIndex,
          destinationBanner,
          score: w.turnoverValue + moveScore(state, player, target, destinationBanner, w) + boardCardThreat(state, opponent, sourceBanner, target, w),
        });
      }
    });
  }
  return output;
}

function redeployActions(state, player, card, w) {
  const output = [];
  for (let sourceBanner = 0; sourceBanner < 9; sourceBanner += 1) {
    if (owner(state, sourceBanner) !== null) continue;
    state.players[player].rows[sourceBanner].forEach((target, cardIndex) => {
      for (let destinationBanner = 0; destinationBanner < 9; destinationBanner += 1) {
        if (destinationBanner === sourceBanner || !canPlace(state, player, destinationBanner)) continue;
        const score = w.redeployValue + moveScore(state, player, target, destinationBanner, w) - boardCardThreat(state, player, sourceBanner, target, w);
        if (score > w.redeployValue) output.push({ type: "redeploy", card, sourceBanner, cardIndex, destinationBanner, score });
      }
    });
  }
  return output;
}

function moveScore(state, player, card, banner, w) {
  const own = owner(state, banner);
  const mine = state.players[player].rows[banner];
  const theirs = state.players[1 - player].rows[banner];
  const nextMine = [...mine, card];
  const center = (8 - Math.abs(4 - banner)) * w.center;
  const ownerPenalty = own === player ? w.ownClaimedPenalty : own === 1 - player ? w.opponentClaimedPenalty : 0;
  const progress = nextMine.length * w.progress;
  const threat = theirs.length === bannerSize(state, banner) - 1 && own === null ? w.immediateThreat : theirs.length * w.threatPerCard;
  let score = formationValue(nextMine, state, banner, w) + center + ownerPenalty + progress + threat + linePressure(state, player, banner, w);
  if (nextMine.length === bannerSize(state, banner)) score += w.completeBonus + wouldClaim(state, player, card, banner) * w.claimBonus;
  return score;
}

function formationValue(cards, state, banner, w) {
  const complete = formation(cards, state, banner);
  if (complete) return complete.type * w.completeFormationType + complete.total * w.total + complete.high * w.high;
  const ranks = cards.map((card) => card.rank ?? 5);
  const rankTotal = ranks.reduce((sum, rank) => sum + rank, 0) * w.rankTotal;
  const sameColor = cards.length > 1 && cards.every((card) => card.color && card.color === cards[0].color) ? w.sameColorPartial : 0;
  const sorted = [...ranks].sort((a, b) => a - b);
  const nearRun = sorted.every((rank, index) => index === 0 || rank - sorted[index - 1] <= 2) ? w.nearRunPartial : 0;
  return rankTotal + sameColor + nearRun;
}

function boardCardThreat(state, player, banner, card, w) {
  const row = state.players[player].rows[banner];
  return (card.rank ?? 5) * w.high + formationValue(row, state, banner, w) / Math.max(1, row.length) + row.length * w.threatPerCard;
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
  if (theirs.length !== bannerSize(state, banner)) return 0;
  const result = compareFormations(formation([...mine, card], state, banner), formation(theirs, state, banner));
  return result > 0 ? 1 : 0;
}

function commitTactic(state, player, card) {
  state.players[player].tacticsPlayed += 1;
  if (card.wild === "leader") state.players[player].leaderPlayed = true;
}

function playAction(state, player, action, weights) {
  const hand = state.players[player].hand;
  const handIndex = hand.findIndex((card) => card.id === action.card.id);
  if (handIndex === -1) return;
  const [card] = hand.splice(handIndex, 1);
  let shouldDraw = true;
  if (card.type === "tactic") commitTactic(state, player, card);

  if (action.type === "place") {
    if (card.kind === "environment") state.bannerEffects[action.banner][card.effect] = true;
    else {
      state.players[player].rows[action.banner].push(card);
      markCompleted(state, player, action.banner);
    }
  } else if (action.type === "scout") {
    shouldDraw = false;
    const drawn = [];
    for (let i = 0; i < 3; i += 1) {
      const drawnCard = drawBest(state, player);
      if (drawnCard) drawn.push(drawnCard);
    }
    const returned = drawn
      .filter(Boolean)
      .sort((a, b) => scoutKeepScore(state, player, a, weights) - scoutKeepScore(state, player, b, weights))
      .slice(0, 2);
    for (const returnedCard of returned) {
      const index = state.players[player].hand.findIndex((item) => item.id === returnedCard.id);
      if (index !== -1) state.players[player].hand.splice(index, 1);
    }
    [...returned].reverse().forEach((returnedCard) => {
      if (returnedCard.type === "tactic") state.tacticDeck.unshift(returnedCard);
      else state.deck.unshift(returnedCard);
    });
  } else if (action.type === "rout") {
    const opponent = 1 - player;
    state.players[opponent].rows[action.banner].splice(action.cardIndex, 1);
    state.players[opponent].completedAt[action.banner] = null;
  } else if (action.type === "turnover") {
    const opponent = 1 - player;
    const [flipped] = state.players[opponent].rows[action.sourceBanner].splice(action.cardIndex, 1);
    state.players[opponent].completedAt[action.sourceBanner] = null;
    state.players[player].rows[action.destinationBanner].push(flipped);
    markCompleted(state, player, action.destinationBanner);
  } else if (action.type === "redeploy") {
    const [moved] = state.players[player].rows[action.sourceBanner].splice(action.cardIndex, 1);
    state.players[player].completedAt[action.sourceBanner] = null;
    state.players[player].rows[action.destinationBanner].push(moved);
    markCompleted(state, player, action.destinationBanner);
  }
  if (shouldDraw) drawBest(state, player);
}

function scoutKeepScore(state, player, card, weights) {
  if (card.type === "tactic") {
    if (card.kind === "command") return weights.commandTempo;
    if (card.kind === "environment") return weights.environmentPenalty;
    return weights.completeFormationType * 0.35;
  }
  let best = 0;
  for (let banner = 0; banner < 9; banner += 1) {
    if (canPlace(state, player, banner)) best = Math.max(best, moveScore(state, player, card, banner, weights));
  }
  return best;
}

function playGame(weightsByPlayer, seed) {
  const rand = rng(seed);
  const state = newGame(rand);
  for (let turn = 0; turn < 140; turn += 1) {
    claimAll(state);
    const won = winner(state);
    if (won !== null) return won;
    const player = state.active;
    const action = chooseAction(state, player, weightsByPlayer[player], weightsByPlayer[1 - player]);
    if (action) playAction(state, player, action, weightsByPlayer[player]);
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
      const candidate = mutate(best, rand, 0.16 + generation * 0.006);
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
