const COLORS = [
  { id: "ember", label: "Ember", value: "#b63c2d" },
  { id: "tide", label: "Tide", value: "#2676b8" },
  { id: "moss", label: "Moss", value: "#3e8a45" },
  { id: "sun", label: "Sun", value: "#c8941d" },
  { id: "stone", label: "Stone", value: "#747b83" },
  { id: "violet", label: "Violet", value: "#7350a8" },
];

const FORMATIONS = [
  "Company",
  "Run",
  "Color Guard",
  "Triple",
  "Royal Run",
];

const TACTICS = [
  { id: "marshal", name: "Free Marshal", kind: "formation", wild: "leader", text: "Wild color and rank. One leader per player." },
  { id: "envoy", name: "Silver Envoy", kind: "formation", wild: "leader", text: "Wild color and rank. One leader per player." },
  { id: "charger", name: "Knight", kind: "formation", wild: "rank8", text: "Rank 8, any color." },
  { id: "squires", name: "Little Shields", kind: "formation", wild: "rank123", text: "Rank 1, 2, or 3, any color." },
  { id: "mist", name: "Mistfall", kind: "environment", effect: "fog", text: "This banner is won by total strength only." },
  { id: "bog", name: "Bogland", kind: "environment", effect: "mud", text: "This banner needs four cards on each side." },
  { id: "scout", name: "Pathfinder", kind: "command", effect: "scout", text: "Draw three cards, then return two of those cards to the top of their decks." },
  { id: "shift", name: "Forced March", kind: "command", effect: "redeploy", text: "Move one of your unclaimed banner cards, or discard it." },
  { id: "rout", name: "Rout", kind: "command", effect: "deserter", text: "Discard one opposing card from an unclaimed banner." },
  { id: "turncoat", name: "Turnover", kind: "command", effect: "traitor", text: "Flip one opposing troop card to your side of an unclaimed banner." },
];

const state = {
  players: [
    { name: "North", hand: [], rows: Array.from({ length: 9 }, () => []), completedAt: Array(9).fill(null), claimed: [], tacticsPlayed: 0, leaderPlayed: false },
    { name: "South", hand: [], rows: Array.from({ length: 9 }, () => []), completedAt: Array(9).fill(null), claimed: [], tacticsPlayed: 0, leaderPlayed: false },
  ],
  bannerEffects: Array.from({ length: 9 }, () => ({ fog: false, mud: false })),
  completionCounter: 0,
  deck: [],
  tacticDeck: [],
  active: 1,
  selectedCardId: null,
  selectedBanner: 0,
  mustDraw: false,
  hasPlayedThisTurn: false,
  pendingCommand: null,
  gameOver: false,
  message: "",
  turnEvents: [],
  lastTurnSummary: null,
  routedCards: [],
  usedCommands: [],
  awaitingTurnStart: false,
  gameOverUndoState: null,
  cpu: { enabled: false, player: null },
};

let undoSnapshot = null;
let scoutReturnSnapshot = null;
let draggedCardId = null;
let pointerDrag = null;
let suppressCardClickUntil = 0;
let cpuTurnTimer = null;
let cpuThinking = false;
let confirmingNewGame = false;
let networkSeat = null;
let networkReady = false;
let applyingRemoteState = false;

const els = {
  opponentRows: document.querySelector("#opponentRows"),
  playerRows: document.querySelector("#playerRows"),
  boardShell: document.querySelector("#boardShell"),
  banners: document.querySelector("#banners"),
  routedCards: document.querySelector("#routedCards"),
  northUsedCommands: document.querySelector("#northUsedCommands"),
  southUsedCommands: document.querySelector("#southUsedCommands"),
  opponentHand: document.querySelector("#opponentHand"),
  opponentHandCount: document.querySelector("#opponentHandCount"),
  hand: document.querySelector("#hand"),
  handTitle: document.querySelector("#handTitle"),
  selectedHint: document.querySelector("#selectedHint"),
  turnCard: document.querySelector("#turnCard"),
  northMarker: document.querySelector("#northMarker"),
  southMarker: document.querySelector("#southMarker"),
  turnLabel: document.querySelector("#turnLabel"),
  deckCount: document.querySelector("#deckCount"),
  tacticDeckCount: document.querySelector("#tacticDeckCount"),
  northTacticsUsed: document.querySelector("#northTacticsUsed"),
  southTacticsUsed: document.querySelector("#southTacticsUsed"),
  message: document.querySelector("#message"),
  claimButton: document.querySelector("#claimButton"),
  drawButton: document.querySelector("#drawButton"),
  drawTacticButton: document.querySelector("#drawTacticButton"),
  playTacticButton: document.querySelector("#playTacticButton"),
  endTurnButton: document.querySelector("#endTurnButton"),
  undoButton: document.querySelector("#undoButton"),
  newGameButton: document.querySelector("#newGameButton"),
  newGameConfirm: document.querySelector("#newGameConfirm"),
  confirmNewGameButton: document.querySelector("#confirmNewGameButton"),
  cancelNewGameButton: document.querySelector("#cancelNewGameButton"),
  cpuToggleButton: document.querySelector("#cpuToggleButton"),
  cpuStatusText: document.querySelector("#cpuStatusText"),
  tacticGuideList: document.querySelector("#tacticGuideList"),
  winOverlay: document.querySelector("#winOverlay"),
  winnerName: document.querySelector("#winnerName"),
  turnPassOverlay: document.querySelector("#turnPassOverlay"),
  turnPassPlayer: document.querySelector("#turnPassPlayer"),
  turnPassButton: document.querySelector("#turnPassButton"),
  cardTooltip: document.querySelector("#cardTooltip"),
};

function saveUndo() {
  undoSnapshot = JSON.stringify(state);
}

function undoLastAction() {
  if (state.gameOver && state.gameOverUndoState) {
    const previous = JSON.parse(state.gameOverUndoState);
    Object.assign(state, previous);
    undoSnapshot = null;
    scoutReturnSnapshot = null;
    state.gameOverUndoState = null;
    state.message = "Final claim undone.";
    hideWinOverlay();
    render();
    publishNetworkState("undo-game-over");
    return;
  }
  if (!undoSnapshot) return;
  const previous = JSON.parse(undoSnapshot);
  Object.assign(state, previous);
  undoSnapshot = null;
  scoutReturnSnapshot = state.pendingCommand?.effect === "scout" && state.pendingCommand.step === "return"
    ? JSON.stringify(state)
    : null;
  state.message = scoutReturnSnapshot
    ? "Pathfinder: choose two cards to return again."
    : "Last action undone.";
  render();
}

function buildDeck() {
  return COLORS.flatMap((color) =>
    Array.from({ length: 10 }, (_, index) => ({
      id: `${color.id}-${index + 1}`,
      type: "troop",
      color: color.id,
      colorLabel: color.label,
      colorValue: color.value,
      rank: index + 1,
    })),
  );
}

function buildTacticDeck() {
  return TACTICS.map((card) => ({
    ...card,
    type: "tactic",
    id: `tactic-${card.id}`,
    colorValue: "#1f1f1d",
  }));
}

function shuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function newGame(startingPlayerIndex = playerIndexForSeat(networkSeat) ?? 1) {
  const cpuWasEnabled = isCpuEnabled() && !isNetworkMatch();
  confirmingNewGame = false;
  state.deck = shuffle(buildDeck());
  state.tacticDeck = shuffle(buildTacticDeck());
  state.players = [
    { name: "North", hand: [], rows: Array.from({ length: 9 }, () => []), completedAt: Array(9).fill(null), claimed: [], tacticsPlayed: 0, leaderPlayed: false },
    { name: "South", hand: [], rows: Array.from({ length: 9 }, () => []), completedAt: Array(9).fill(null), claimed: [], tacticsPlayed: 0, leaderPlayed: false },
  ];
  state.bannerEffects = Array.from({ length: 9 }, () => ({ fog: false, mud: false }));
  state.completionCounter = 0;
  state.active = startingPlayerIndex;
  state.selectedCardId = null;
  state.selectedBanner = 0;
  state.mustDraw = false;
  state.hasPlayedThisTurn = false;
  state.pendingCommand = null;
  state.gameOver = false;
  state.turnEvents = [];
  state.lastTurnSummary = null;
  state.routedCards = [];
  state.usedCommands = [];
  state.awaitingTurnStart = false;
  state.gameOverUndoState = null;
  state.cpu = {
    enabled: cpuWasEnabled,
    player: cpuWasEnabled ? 1 - humanPlayerIndex() : null,
  };
  state.message = `${state.players[state.active].name} begins. Play one card to any open banner, then draw.`;
  undoSnapshot = null;
  scoutReturnSnapshot = null;
  hideWinOverlay();

  for (let i = 0; i < 7; i += 1) {
    drawTo(0);
    drawTo(1);
  }
  render();
  publishNetworkState("new-game");
}

function drawTo(playerIndex) {
  const card = state.deck.shift();
  if (card) state.players[playerIndex].hand.push(card);
  return card ?? null;
}

function drawTacticTo(playerIndex) {
  const card = state.tacticDeck.shift();
  if (card) state.players[playerIndex].hand.push(card);
  return card ?? null;
}

function activePlayer() {
  return state.players[state.active];
}

function inactivePlayer() {
  return state.players[1 - state.active];
}

function playerIndexForSeat(seat) {
  if (seat === "North") return 0;
  if (seat === "South") return 1;
  return null;
}

function cpuState() {
  if (!state.cpu || typeof state.cpu !== "object") state.cpu = { enabled: false, player: null };
  return state.cpu;
}

function humanPlayerIndex() {
  const networkIndex = playerIndexForSeat(networkSeat);
  return networkIndex ?? 1;
}

function isCpuEnabled() {
  const cpu = cpuState();
  return !isNetworkMatch() && Boolean(cpu.enabled) && Number.isInteger(cpu.player);
}

function isCpuTurn() {
  return isCpuEnabled() && state.active === cpuState().player && !state.gameOver;
}

function isNetworkMatch() {
  return networkReady && (networkSeat === "North" || networkSeat === "South" || networkSeat === "Spectator");
}

function viewerPlayerIndex() {
  if (isCpuEnabled()) return humanPlayerIndex();
  if (!isNetworkMatch()) return state.active;
  return playerIndexForSeat(networkSeat) ?? state.active;
}

function canActNow() {
  if (isCpuTurn()) return false;
  if (!isNetworkMatch()) return true;
  return playerIndexForSeat(networkSeat) === state.active;
}

function networkBlockedMessage() {
  if (networkSeat === "Spectator") return "You are spectating this match.";
  return `Waiting for ${activePlayer().name}'s turn.`;
}

function selectedCard() {
  if (!canActNow()) return null;
  return activePlayer().hand.find((card) => card.id === state.selectedCardId) ?? null;
}

function canPlayTacticCard(card) {
  if (!card || card.type !== "tactic") return false;
  const mine = activePlayer().tacticsPlayed;
  const theirs = inactivePlayer().tacticsPlayed;
  if (mine + 1 > theirs + 1) return false;
  if (card.wild === "leader" && activePlayer().leaderPlayed) return false;
  return true;
}

function addTurnEvent(event) {
  state.turnEvents.push({
    player: state.active,
    banners: [],
    lanes: [],
    ...event,
  });
}

function lastTurnEvents() {
  return state.lastTurnSummary?.events ?? [];
}

function isLastTurnBanner(bannerIndex) {
  return lastTurnEvents().some((event) => (event.banners ?? []).includes(bannerIndex));
}

function isLastTurnLane(playerIndex, bannerIndex) {
  return lastTurnEvents().some((event) =>
    (event.lanes ?? []).some((lane) => lane.player === playerIndex && lane.banner === bannerIndex),
  );
}

function lastTurnText() {
  const info = lastTurnInfo();
  return info ? `${info.label}: ${info.detail}` : "";
}

function lastTurnInfo() {
  const summary = state.lastTurnSummary;
  if (!summary) return null;
  const playerName = state.players[summary.player]?.name ?? "Player";
  const details = (summary.events ?? []).map((event) => event.text).filter(Boolean).join(" / ");
  return {
    label: `Last turn (${playerName})`,
    detail: details || "No visible board change.",
  };
}

function canPlaceOnBanner(playerIndex, bannerIndex) {
  return Number.isInteger(bannerIndex)
    && bannerIndex >= 0
    && bannerIndex < 9
    && state.players[playerIndex].rows[bannerIndex].length < bannerSize(bannerIndex);
}

function canActivePlaceAnyCard() {
  return activePlayer().hand.some((card) => {
    if (card.type === "tactic" && card.kind !== "formation") return false;
    if (card.type === "tactic" && !canPlayTacticCard(card)) return false;
    return state.players[state.active].rows.some((_, bannerIndex) => canPlaceOnBanner(state.active, bannerIndex));
  });
}

function activeSideFull() {
  return activePlayer().rows.every((row, bannerIndex) => row.length >= bannerSize(bannerIndex));
}

function claimOwner(bannerIndex) {
  if (state.players[0].claimed.includes(bannerIndex)) return 0;
  if (state.players[1].claimed.includes(bannerIndex)) return 1;
  return null;
}

function bannerSize(bannerIndex) {
  return state.bannerEffects[bannerIndex].mud ? 4 : 3;
}

function concreteOptions(card) {
  if (card.type !== "tactic") return [card];
  if (card.wild === "leader") return COLORS.flatMap((color) => rankOptions(1, 10, color));
  if (card.wild === "rank8") return COLORS.map((color) => concreteTactic(card, color, 8));
  if (card.wild === "rank123") return COLORS.flatMap((color) => rankOptions(1, 3, color, card));
  return [];
}

function rankOptions(min, max, color, source = null) {
  const output = [];
  for (let rank = min; rank <= max; rank += 1) {
    output.push(concreteTactic(source, color, rank));
  }
  return output;
}

function concreteTactic(source, color, rank) {
  return {
    id: `${source?.id ?? "wild"}-${color.id}-${rank}`,
    type: "troop",
    sourceId: source?.id,
    color: color.id,
    colorLabel: color.label,
    colorValue: color.value,
    rank,
  };
}

function formation(cards, bannerIndex = null) {
  const size = bannerIndex === null ? cards.length : bannerSize(bannerIndex);
  if (cards.length !== size) return null;
  const variants = expandWilds(cards);
  let best = null;
  for (const variant of variants) {
    const result = basicFormation(variant, bannerIndex);
    if (result && (!best || compareFormationValues(result, best) > 0)) best = result;
  }
  return best;
}

function expandWilds(cards, index = 0, prefix = [], output = []) {
  if (index === cards.length) {
    output.push(prefix);
    return output;
  }
  for (const option of concreteOptions(cards[index])) {
    expandWilds(cards, index + 1, [...prefix, option], output);
  }
  return output;
}

function basicFormation(cards, bannerIndex) {
  const sorted = [...cards].sort((a, b) => a.rank - b.rank);
  const ranks = sorted.map((card) => card.rank);
  const total = ranks.reduce((sum, rank) => sum + rank, 0);
  if (bannerIndex !== null && state.bannerEffects[bannerIndex].fog) {
    return { type: 0, total, high: ranks[ranks.length - 1], label: "Fog Company" };
  }
  const sameColor = cards.every((card) => card.color === cards[0].color);
  const sameRank = cards.every((card) => card.rank === cards[0].rank);
  const consecutive = ranks.every((rank, index) => index === 0 || ranks[index - 1] + 1 === rank);

  let type = 0;
  if (sameColor && consecutive) type = 4;
  else if (sameRank) type = 3;
  else if (sameColor) type = 2;
  else if (consecutive) type = 1;

  return { type, total, high: ranks[ranks.length - 1], label: FORMATIONS[type] };
}

function canClaim(playerIndex, bannerIndex) {
  const owner = claimOwner(bannerIndex);
  if (owner !== null) return false;

  const mine = state.players[playerIndex].rows[bannerIndex];
  const theirs = state.players[1 - playerIndex].rows[bannerIndex];
  if (mine.length !== bannerSize(bannerIndex)) return false;

  if (theirs.length === bannerSize(bannerIndex)) {
    return compareCompletedBanner(playerIndex, bannerIndex) > 0;
  }

  const possibleBest = bestPossibleFormation(theirs, availableForProof(bannerIndex), bannerIndex);
  if (!possibleBest) return false;
  const mineFormation = formation(mine, bannerIndex);
  return compareFormationValues(mineFormation, possibleBest) >= 0;
}

function compareFormationValues(left, right) {
  if (left.type !== right.type) return left.type > right.type ? 1 : -1;
  if (left.total !== right.total) return left.total > right.total ? 1 : -1;
  if (left.high !== right.high) return left.high > right.high ? 1 : -1;
  return 0;
}

function compareCompletedBanner(playerIndex, bannerIndex) {
  const opponentIndex = 1 - playerIndex;
  const mine = formation(state.players[playerIndex].rows[bannerIndex], bannerIndex);
  const theirs = formation(state.players[opponentIndex].rows[bannerIndex], bannerIndex);
  const result = compareFormationValues(mine, theirs);
  if (result !== 0) return result;

  const mineCompleted = state.players[playerIndex].completedAt[bannerIndex];
  const theirsCompleted = state.players[opponentIndex].completedAt[bannerIndex];
  if (mineCompleted === null || theirsCompleted === null) return 0;
  return mineCompleted < theirsCompleted ? 1 : -1;
}

function availableForProof(bannerIndex) {
  const playedCards = state.players.flatMap((player) => player.rows.flat().filter((card) => card.type === "troop"));
  const playedIds = new Set(playedCards.map((card) => card.id));
  return buildDeck().filter((card) => !playedIds.has(card.id));
}

function bestPossibleFormation(existing, available, bannerIndex = state.selectedBanner) {
  const needed = bannerSize(bannerIndex) - existing.length;
  if (needed < 0) return null;
  if (needed === 0) return formation(existing, bannerIndex);

  let best = null;
  const candidates = combinations(available.filter((card) => !existing.some((item) => item.id === card.id)), needed);
  for (const combo of candidates) {
    const result = formation([...existing, ...combo], bannerIndex);
    if (result && (!best || compareFormationValues(result, best) > 0)) best = result;
  }
  return best;
}

function combinations(items, size, start = 0, prefix = [], output = []) {
  if (prefix.length === size) {
    output.push(prefix);
    return output;
  }
  for (let i = start; i <= items.length - (size - prefix.length); i += 1) {
    combinations(items, size, i + 1, [...prefix, items[i]], output);
  }
  return output;
}

function playSelectedCard(bannerIndex) {
  if (!canActNow()) {
    state.message = networkBlockedMessage();
    render();
    return;
  }
  if (state.pendingCommand?.step === "destination") {
    finishDestinationCommand(bannerIndex);
    return;
  }
  if (state.pendingCommand) {
    state.message = "Finish or cancel the current tactic target selection.";
    render();
    return;
  }
  if (state.gameOver || state.mustDraw || state.hasPlayedThisTurn) {
    if (state.hasPlayedThisTurn && !state.mustDraw) {
      state.message = "You have already played this turn. End your turn.";
      render();
    }
    return;
  }
  const player = activePlayer();
  const card = selectedCard();
  if (card?.type === "tactic") {
    playSelectedTactic(bannerIndex);
    return;
  }
  if (!canPlaceOnBanner(state.active, bannerIndex)) {
    state.message = "That side of the banner is full.";
    render();
    return;
  }

  const cardIndex = player.hand.findIndex((card) => card.id === state.selectedCardId);
  if (cardIndex === -1) {
    state.selectedBanner = bannerIndex;
    state.message = "Choose a card from your hand first.";
    render();
    return;
  }

  saveUndo();
  const [playedCard] = player.hand.splice(cardIndex, 1);
  player.rows[bannerIndex].push(playedCard);
  if (player.rows[bannerIndex].length === bannerSize(bannerIndex)) {
    state.completionCounter += 1;
    player.completedAt[bannerIndex] = state.completionCounter;
  }
  state.selectedCardId = null;
  state.selectedBanner = bannerIndex;
  state.hasPlayedThisTurn = true;
  state.mustDraw = state.deck.length > 0 || state.tacticDeck.length > 0;
  addTurnEvent({
    text: `Placed ${cardLabel(playedCard)} on Banner ${bannerIndex + 1}.`,
    banners: [bannerIndex],
    lanes: [{ player: state.active, banner: bannerIndex }],
  });
  state.message = state.mustDraw ? "Card placed. Draw to refill your hand." : "Card placed. Both decks are empty; end your turn.";
  render();
}

function playCardById(cardId, bannerIndex) {
  state.selectedCardId = cardId;
  playSelectedCard(bannerIndex);
}

function playSelectedTactic(bannerIndex = state.selectedBanner) {
  if (!canActNow()) {
    state.message = networkBlockedMessage();
    render();
    return;
  }
  if (state.gameOver || state.mustDraw || state.hasPlayedThisTurn) return;
  const player = activePlayer();
  const cardIndex = player.hand.findIndex((card) => card.id === state.selectedCardId);
  const card = player.hand[cardIndex];
  if (!canPlayTacticCard(card)) {
    state.message = card?.wild === "leader" && player.leaderPlayed
      ? "You have already played a leader tactic."
      : "You cannot play more than one tactic ahead of your opponent.";
    render();
    return;
  }

  if (card.kind === "formation") {
    playFormationTactic(card, cardIndex, bannerIndex);
  } else if (card.kind === "environment") {
    playEnvironmentTactic(card, cardIndex, bannerIndex);
  } else {
    playCommandTactic(card, cardIndex);
  }
}

function commitTactic(cardIndex, target = null) {
  const player = activePlayer();
  const [card] = player.hand.splice(cardIndex, 1);
  player.tacticsPlayed += 1;
  if (card.wild === "leader") player.leaderPlayed = true;
  if (card.kind === "command") {
    state.usedCommands.push({
      card,
      player: state.active,
    });
  }
  state.selectedCardId = null;
  state.hasPlayedThisTurn = true;
  state.mustDraw = state.deck.length > 0 || state.tacticDeck.length > 0;
  state.message = target === null
    ? `${card.name} resolved. Draw a card.`
    : `${card.name} played to Banner ${target + 1}. Draw a card.`;
  return card;
}

function playFormationTactic(card, cardIndex, bannerIndex) {
  const player = activePlayer();
  if (!canPlaceOnBanner(state.active, bannerIndex)) {
    state.message = "That side of the banner is full.";
    render();
    return;
  }
  saveUndo();
  const played = commitTactic(cardIndex, bannerIndex);
  player.rows[bannerIndex].push(played);
  if (player.rows[bannerIndex].length === bannerSize(bannerIndex)) {
    state.completionCounter += 1;
    player.completedAt[bannerIndex] = state.completionCounter;
  }
  addTurnEvent({
    text: `Played ${played.name} on Banner ${bannerIndex + 1}.`,
    banners: [bannerIndex],
    lanes: [{ player: state.active, banner: bannerIndex }],
  });
  render();
}

function playEnvironmentTactic(card, cardIndex, bannerIndex) {
  if (claimOwner(bannerIndex) !== null) {
    state.message = "That banner has already been secured.";
    render();
    return;
  }
  if (card.effect === "fog" && state.bannerEffects[bannerIndex].fog) {
    state.message = "This banner already has a mist effect.";
    render();
    return;
  }
  if (card.effect === "mud" && state.bannerEffects[bannerIndex].mud) {
    state.message = "This banner already has a bog effect.";
    render();
    return;
  }
  saveUndo();
  const played = commitTactic(cardIndex, bannerIndex);
  state.bannerEffects[bannerIndex][card.effect] = true;
  state.players.forEach((player) => {
    if (player.rows[bannerIndex].length < bannerSize(bannerIndex)) player.completedAt[bannerIndex] = null;
  });
  addTurnEvent({
    text: `Changed Banner ${bannerIndex + 1} with ${played.name}.`,
    banners: [bannerIndex],
  });
  render();
}

function playCommandTactic(card, cardIndex) {
  if (card.effect === "scout") {
    saveUndo();
    const played = commitTactic(cardIndex);
    state.mustDraw = false;
    state.pendingCommand = {
      effect: "scout",
      step: "draw",
      drawsRemaining: 3,
      returnsRemaining: 2,
      drawnCardIds: [],
      returnedCards: [],
    };
    addTurnEvent({ text: `Played ${played.name}.` });
    state.message = "Pathfinder: draw three cards from either deck.";
    render();
    return;
  }
  saveUndo();
  state.pendingCommand = { effect: card.effect, tacticCardId: card.id, step: "target" };
  state.message = commandPrompt(card.effect);
  render();
}

function commandPrompt(effect) {
  if (effect === "redeploy") return "Forced March: click one of your cards on an unclaimed banner.";
  if (effect === "deserter") return "Rout: click one opposing card on an unclaimed banner to discard it.";
  if (effect === "traitor") return "Turnover: click one opposing troop card on an unclaimed banner.";
  return "Choose a target on the board.";
}

function cancelPendingCommand() {
  if (state.pendingCommand?.effect === "scout" && undoSnapshot) {
    undoLastAction();
    state.message = "Pathfinder canceled.";
    return;
  }
  if (state.pendingCommand?.effect === "scout") {
    state.message = "Pathfinder cannot be canceled after drawing.";
    render();
    return;
  }
  state.pendingCommand = null;
  state.message = "Tactic target selection canceled.";
  render();
}

function validOpenBanner(bannerIndex) {
  return Number.isInteger(bannerIndex) && bannerIndex >= 0 && bannerIndex < 9 && claimOwner(bannerIndex) === null;
}

function validDestinationBanner(playerIndex, bannerIndex) {
  return canPlaceOnBanner(playerIndex, bannerIndex);
}

function markCompletedIfFull(playerIndex, bannerIndex) {
  const player = state.players[playerIndex];
  if (player.rows[bannerIndex].length === bannerSize(bannerIndex)) {
    state.completionCounter += 1;
    player.completedAt[bannerIndex] = state.completionCounter;
  }
}

function handleBoardCardClick(playerIndex, bannerIndex, cardIndex) {
  if (!canActNow()) {
    state.message = networkBlockedMessage();
    render();
    return;
  }
  const pending = state.pendingCommand;
  if (!pending || pending.step !== "target") return;
  if (claimOwner(bannerIndex) !== null) {
    state.message = "Choose a card on an unclaimed banner.";
    render();
    return;
  }
  if (pending.effect === "redeploy" && playerIndex !== state.active) {
    state.message = "Forced March can only target your own cards.";
    render();
    return;
  }
  if ((pending.effect === "deserter" || pending.effect === "traitor") && playerIndex === state.active) {
    state.message = "Choose an opposing card.";
    render();
    return;
  }
  const card = state.players[playerIndex].rows[bannerIndex][cardIndex];
  if (pending.effect === "traitor" && card.type !== "troop") {
    state.message = "Turnover can only flip a troop card.";
    render();
    return;
  }

  if (pending.effect === "deserter") {
    const tactic = commitPendingTactic();
    if (!tactic) return;
    const [removed] = state.players[playerIndex].rows[bannerIndex].splice(cardIndex, 1);
    state.routedCards.push({
      card: removed,
      fromPlayer: playerIndex,
      banner: bannerIndex,
      byPlayer: state.active,
    });
    state.players[playerIndex].completedAt[bannerIndex] = null;
    state.pendingCommand = null;
    addTurnEvent({
      text: `Used ${tactic.name} to remove ${cardLabel(removed)} from Banner ${bannerIndex + 1}.`,
      banners: [bannerIndex],
      lanes: [{ player: playerIndex, banner: bannerIndex }],
    });
    state.message = "Rout resolved. Draw a card.";
    render();
    return;
  }

  state.pendingCommand = {
    ...pending,
    step: "destination",
    sourcePlayer: playerIndex,
    sourceBanner: bannerIndex,
    sourceCard: cardIndex,
  };
  state.selectedBanner = bannerIndex;
  state.message = pending.effect === "redeploy"
    ? "Forced March: click a destination banner, or click the same card again to discard it."
    : "Turnover: click one of your open banners with space.";
  render();
}

function finishDestinationCommand(destinationBanner) {
  const pending = state.pendingCommand;
  if (!pending || pending.step !== "destination") return;
  const sourcePlayer = state.players[pending.sourcePlayer];
  const sourceRow = sourcePlayer.rows[pending.sourceBanner];
  const card = sourceRow[pending.sourceCard];
  if (!card) {
    state.pendingCommand = null;
    state.message = "That target is no longer available.";
    render();
    return;
  }
  const destinationPlayerIndex = pending.effect === "traitor" ? state.active : pending.sourcePlayer;
  if (!validDestinationBanner(destinationPlayerIndex, destinationBanner)) {
    state.message = "Choose an open destination banner with space.";
    render();
    return;
  }

  const tactic = commitPendingTactic();
  if (!tactic) return;
  const [moved] = sourceRow.splice(pending.sourceCard, 1);
  sourcePlayer.completedAt[pending.sourceBanner] = null;
  state.players[destinationPlayerIndex].rows[destinationBanner].push(moved);
  markCompletedIfFull(destinationPlayerIndex, destinationBanner);
  state.pendingCommand = null;
  state.selectedBanner = destinationBanner;
  addTurnEvent({
    text: pending.effect === "traitor"
      ? `Used ${tactic.name} to flip ${cardLabel(moved)} from Banner ${pending.sourceBanner + 1} to Banner ${destinationBanner + 1}.`
      : `Used ${tactic.name} to move ${cardLabel(moved)} from Banner ${pending.sourceBanner + 1} to Banner ${destinationBanner + 1}.`,
    banners: [...new Set([pending.sourceBanner, destinationBanner])],
    lanes: [
      { player: pending.sourcePlayer, banner: pending.sourceBanner },
      { player: destinationPlayerIndex, banner: destinationBanner },
    ],
  });
  state.message = pending.effect === "traitor" ? "Turnover resolved. Draw a card." : "Forced March resolved. Draw a card.";
  render();
}

function discardRedeploySource(playerIndex, bannerIndex, cardIndex) {
  const pending = state.pendingCommand;
  if (!pending || pending.effect !== "redeploy" || pending.step !== "destination") return false;
  if (pending.sourcePlayer !== playerIndex || pending.sourceBanner !== bannerIndex || pending.sourceCard !== cardIndex) return false;
  const tactic = commitPendingTactic();
  if (!tactic) return false;
  const [discarded] = state.players[playerIndex].rows[bannerIndex].splice(cardIndex, 1);
  state.players[playerIndex].completedAt[bannerIndex] = null;
  state.pendingCommand = null;
  addTurnEvent({
    text: `Used ${tactic.name} to discard ${cardLabel(discarded)} from Banner ${bannerIndex + 1}.`,
    banners: [bannerIndex],
    lanes: [{ player: playerIndex, banner: bannerIndex }],
  });
  state.message = "Forced March discarded the selected card. Draw a card.";
  render();
  return true;
}

function commitPendingTactic() {
  const index = activePlayer().hand.findIndex((card) => card.id === state.pendingCommand?.tacticCardId);
  if (index === -1) {
    state.pendingCommand = null;
    state.message = "That tactic card is no longer available.";
    render();
    return false;
  }
  return commitTactic(index);
}

function isBoardCardTargetable(playerIndex, bannerIndex, cardIndex) {
  const pending = state.pendingCommand;
  if (!pending) return false;
  if (claimOwner(bannerIndex) !== null) return false;
  if (pending.step === "destination") {
    return pending.effect === "redeploy"
      && pending.sourcePlayer === playerIndex
      && pending.sourceBanner === bannerIndex
      && pending.sourceCard === cardIndex;
  }
  if (pending.effect === "redeploy") return playerIndex === state.active;
  if (pending.effect === "deserter") return playerIndex !== state.active;
  if (pending.effect === "traitor") return playerIndex !== state.active && state.players[playerIndex].rows[bannerIndex][cardIndex]?.type === "troop";
  return false;
}

function claimSelected() {
  if (!canActNow()) {
    state.message = networkBlockedMessage();
    render();
    return;
  }
  if (state.gameOver) return;
  if (!canClaim(state.active, state.selectedBanner)) {
    state.message = "This banner cannot be claimed yet.";
    render();
    return;
  }

  saveUndo();
  activePlayer().claimed.push(state.selectedBanner);
  addTurnEvent({
    text: `Secured Banner ${state.selectedBanner + 1}.`,
    banners: [state.selectedBanner],
  });
  state.message = `${activePlayer().name} secured Banner ${state.selectedBanner + 1}.`;
  const winner = winnerIndex();
  if (winner !== null) {
    state.gameOverUndoState = undoSnapshot;
    state.gameOver = true;
    state.message = `${state.players[winner].name} wins the line. Start a new game when ready.`;
    showWinOverlayForCurrentViewer(winner);
    publishNetworkState("game-over");
  }
  render();
}

function winnerIndex() {
  for (let playerIndex = 0; playerIndex < 2; playerIndex += 1) {
    const claimed = state.players[playerIndex].claimed;
    if (claimed.length >= 5) return playerIndex;
    const sorted = [...claimed].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 2; i += 1) {
      if (sorted[i] + 1 === sorted[i + 1] && sorted[i + 1] + 1 === sorted[i + 2]) return playerIndex;
    }
  }
  return null;
}

function drawCard() {
  if (!canActNow()) {
    state.message = networkBlockedMessage();
    render();
    return;
  }
  if (state.pendingCommand?.effect === "scout" && state.pendingCommand.step === "draw") {
    scoutDraw("troop");
    return;
  }
  if (!state.mustDraw || state.gameOver) return;
  if (state.deck.length === 0) {
    state.message = "The troop deck is empty. Draw a tactic instead.";
    render();
    return;
  }
  drawTo(state.active);
  undoSnapshot = null;
  scoutReturnSnapshot = null;
  state.mustDraw = false;
  addTurnEvent({ text: "Drew a troop card." });
  state.message = "Hand refilled. End your turn.";
  render();
}

function drawTacticCard() {
  if (!canActNow()) {
    state.message = networkBlockedMessage();
    render();
    return;
  }
  if (state.pendingCommand?.effect === "scout" && state.pendingCommand.step === "draw") {
    scoutDraw("tactic");
    return;
  }
  if (!state.mustDraw || state.gameOver) return;
  if (state.tacticDeck.length === 0) {
    state.message = "The tactic deck is empty. Draw a troop instead.";
    render();
    return;
  }
  drawTacticTo(state.active);
  undoSnapshot = null;
  scoutReturnSnapshot = null;
  state.mustDraw = false;
  addTurnEvent({ text: "Drew a tactic card." });
  state.message = "Hand refilled. End your turn.";
  render();
}

function scoutDraw(deckType) {
  if (!canActNow()) {
    state.message = networkBlockedMessage();
    render();
    return;
  }
  if (state.gameOver || state.pendingCommand?.effect !== "scout" || state.pendingCommand.step !== "draw") return;
  let drawn = null;
  if (deckType === "troop") {
    if (state.deck.length === 0) {
      state.message = "The troop deck is empty. Draw from tactics.";
      render();
      return;
    }
    drawn = drawTo(state.active);
  } else {
    if (state.tacticDeck.length === 0) {
      state.message = "The tactic deck is empty. Draw from troops.";
      render();
      return;
    }
    drawn = drawTacticTo(state.active);
  }
  if (drawn) state.pendingCommand.drawnCardIds.push(drawn.id);
  undoSnapshot = null;
  addTurnEvent({ text: `Pathfinder drew a ${deckType === "troop" ? "troop" : "tactic"} card.` });
  state.pendingCommand.drawsRemaining -= 1;
  if (state.pendingCommand.drawsRemaining > 0) {
    state.message = `Pathfinder: draw ${state.pendingCommand.drawsRemaining} more card${state.pendingCommand.drawsRemaining === 1 ? "" : "s"}.`;
  } else {
    state.pendingCommand.step = "return";
    state.message = "Pathfinder: return two of the three drawn cards.";
    scoutReturnSnapshot = JSON.stringify(state);
  }
  render();
}

function canReturnScoutCard(card) {
  return Boolean(card)
    && canActNow()
    && state.pendingCommand?.effect === "scout"
    && state.pendingCommand.step === "return"
    && (state.pendingCommand.drawnCardIds ?? []).includes(card.id);
}

function returnScoutCard(cardId) {
  if (!canActNow()) {
    state.message = networkBlockedMessage();
    render();
    return;
  }
  if (state.pendingCommand?.effect !== "scout" || state.pendingCommand.step !== "return") return;
  if (!(state.pendingCommand.drawnCardIds ?? []).includes(cardId)) {
    state.message = "Pathfinder can only return cards drawn by Pathfinder.";
    render();
    return;
  }
  const player = activePlayer();
  const index = player.hand.findIndex((card) => card.id === cardId);
  if (index === -1) return;
  const [card] = player.hand.splice(index, 1);
  state.pendingCommand.drawnCardIds = state.pendingCommand.drawnCardIds.filter((id) => id !== card.id);
  state.pendingCommand.returnedCards.push(card);
  state.pendingCommand.returnsRemaining -= 1;
  if (state.pendingCommand.returnsRemaining > 0) {
    state.message = "Pathfinder: return one more card drawn by Pathfinder.";
  } else {
    placeScoutReturnedCardsOnDecks(state.pendingCommand.returnedCards);
    addTurnEvent({ text: "Pathfinder returned two cards." });
    state.pendingCommand = null;
    undoSnapshot = scoutReturnSnapshot;
    state.message = "Pathfinder resolved. End your turn.";
  }
  render();
}

function placeScoutReturnedCardsOnDecks(cards) {
  [...cards].reverse().forEach((card) => {
    if (card.type === "tactic") state.tacticDeck.unshift(card);
    else state.deck.unshift(card);
  });
}

function endTurn() {
  if (!canActNow()) {
    state.message = networkBlockedMessage();
    render();
    return;
  }
  if (state.gameOver || state.mustDraw) return;
  if (!state.hasPlayedThisTurn && !activeSideFull()) {
    state.message = "Play a card first, or use End Turn only when every banner on your side is full.";
    render();
    return;
  }
  finishCurrentTurn();
}

function finishCurrentTurn() {
  state.lastTurnSummary = {
    player: state.active,
    events: state.turnEvents.length
      ? state.turnEvents.slice()
      : [{ player: state.active, text: "Passed with every banner full.", banners: [], lanes: [] }],
  };
  state.turnEvents = [];
  state.active = 1 - state.active;
  state.selectedCardId = null;
  state.hasPlayedThisTurn = false;
  state.awaitingTurnStart = !isNetworkMatch() && !isCpuEnabled();
  undoSnapshot = null;
  scoutReturnSnapshot = null;
  state.message = state.awaitingTurnStart
    ? `Pass the screen to ${activePlayer().name}.`
    : `${activePlayer().name}'s turn. Play one card to a banner.`;
  render();
  publishNetworkState("end-turn");
}

function revealTurnHand() {
  if (!state.awaitingTurnStart) return;
  state.awaitingTurnStart = false;
  state.message = `${activePlayer().name}'s turn. Play one card to a banner.`;
  render();
}

function toggleCpuOpponent() {
  if (isNetworkMatch()) {
    state.message = "CPU opponent is only available while no online opponent is in the room.";
    render();
    return;
  }
  const cpu = cpuState();
  if (cpu.enabled) {
    cpu.enabled = false;
    cpu.player = null;
    cancelCpuTurn();
    state.message = "CPU opponent disabled.";
  } else {
    cpu.enabled = true;
    cpu.player = 1 - humanPlayerIndex();
    state.awaitingTurnStart = false;
    state.message = `${state.players[cpu.player].name} CPU joined the match.`;
  }
  render();
}

function cancelCpuTurn() {
  if (cpuTurnTimer) window.clearTimeout(cpuTurnTimer);
  cpuTurnTimer = null;
  cpuThinking = false;
}

function scheduleCpuTurn() {
  if (!isCpuTurn() || state.awaitingTurnStart || cpuThinking || cpuTurnTimer) return;
  cpuTurnTimer = window.setTimeout(() => {
    cpuTurnTimer = null;
    runCpuTurn();
  }, 650);
}

async function runCpuTurn() {
  if (!isCpuTurn() || cpuThinking) return;
  cpuThinking = true;
  state.message = `${activePlayer().name} CPU is thinking...`;
  render();
  await delay(600);

  if (!isCpuTurn() || state.gameOver) {
    cpuThinking = false;
    render();
    return;
  }

  cpuClaimAvailable();
  if (state.gameOver) {
    cpuThinking = false;
    render();
    publishNetworkState("game-over");
    return;
  }

  if (state.mustDraw) {
    cpuDrawBestCard();
    await delay(250);
    finishCurrentTurn();
    cpuThinking = false;
    return;
  }

  if (!state.hasPlayedThisTurn && !activeSideFull()) {
    const move = chooseCpuMove();
    if (move) {
      cpuPlayMove(move);
      await delay(350);
      cpuClaimAvailable();
      if (state.gameOver) {
        cpuThinking = false;
        render();
        publishNetworkState("game-over");
        return;
      }
    }
  }

  if (state.mustDraw) {
    cpuDrawBestCard();
    await delay(250);
  }
  finishCurrentTurn();
  cpuThinking = false;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function cpuClaimAvailable() {
  let claimed = false;
  for (let i = 0; i < 9; i += 1) {
    if (!canClaim(state.active, i)) continue;
    state.selectedBanner = i;
    activePlayer().claimed.push(i);
    addTurnEvent({
      text: `CPU secured Banner ${i + 1}.`,
      banners: [i],
    });
    claimed = true;
    const winner = winnerIndex();
    if (winner !== null) {
      state.gameOverUndoState = null;
      state.gameOver = true;
      state.message = `${state.players[winner].name} wins the line.`;
      showWinOverlayForCurrentViewer(winner);
      return true;
    }
  }
  if (claimed) state.message = `${activePlayer().name} CPU secured a banner.`;
  return claimed;
}

function chooseCpuMove() {
  const player = activePlayer();
  let best = null;
  player.hand.forEach((card) => {
    for (let bannerIndex = 0; bannerIndex < 9; bannerIndex += 1) {
      if (!cpuCanPlayCard(card, bannerIndex)) continue;
      const score = cpuMoveScore(card, bannerIndex);
      if (!best || score > best.score) best = { card, bannerIndex, score };
    }
  });
  return best;
}

function cpuCanPlayCard(card, bannerIndex) {
  if (!card || state.gameOver || state.pendingCommand || state.mustDraw || state.hasPlayedThisTurn) return false;
  if (card.type !== "tactic") return canPlaceOnBanner(state.active, bannerIndex);
  if (!canPlayTacticCard(card)) return false;
  if (card.kind === "formation") return canPlaceOnBanner(state.active, bannerIndex);
  if (card.kind === "environment") return canUseEnvironmentOnBanner(card, bannerIndex) && cpuShouldUseEnvironment(card, bannerIndex);
  return false;
}

function cpuMoveScore(card, bannerIndex) {
  const owner = claimOwner(bannerIndex);
  const mine = state.players[state.active].rows[bannerIndex];
  const theirs = state.players[1 - state.active].rows[bannerIndex];
  const size = bannerSize(bannerIndex);
  const nextMine = [...mine, card];
  const centerBonus = 8 - Math.abs(4 - bannerIndex);
  const ownerPenalty = owner === state.active ? -45 : owner === 1 - state.active ? -70 : 0;
  const progressScore = nextMine.length * 18;
  const threatScore = theirs.length === size - 1 && owner === null ? 42 : theirs.length * 8;
  const claimLineScore = cpuLinePressureScore(bannerIndex);
  let formationScore = cpuFormationValue(nextMine, bannerIndex);
  if (nextMine.length === size) {
    formationScore += 95;
    if (cpuWouldClaimAfter(card, bannerIndex)) formationScore += 160;
  }
  if (card.type === "tactic") formationScore -= card.kind === "environment" ? 4 : 12;
  return formationScore + progressScore + threatScore + claimLineScore + centerBonus + ownerPenalty;
}

function cpuFormationValue(cards, bannerIndex) {
  const complete = formation(cards, bannerIndex);
  if (complete) return complete.type * 70 + complete.total + complete.high;
  const size = bannerSize(bannerIndex);
  const knownRanks = cards.map((card) => card.rank ?? 5);
  const rankTotal = knownRanks.reduce((sum, rank) => sum + rank, 0);
  const colorBonus = cards.length > 1 && cards.every((card) => card.color && card.color === cards[0].color) ? 24 : 0;
  const sortedRanks = [...knownRanks].sort((a, b) => a - b);
  const nearRunBonus = sortedRanks.every((rank, index) => index === 0 || rank - sortedRanks[index - 1] <= 2) ? 18 : 0;
  if (cards.length < size - 1) return rankTotal + colorBonus + nearRunBonus;
  const possible = bestPossibleFormation(cards, availableForProof(bannerIndex), bannerIndex);
  if (!possible) return cards.reduce((sum, card) => sum + (card.rank ?? 5), 0);
  return possible.type * 42 + possible.total + possible.high;
}

function cpuLinePressureScore(bannerIndex) {
  const claimed = new Set(state.players[state.active].claimed);
  let score = 0;
  for (const offset of [-2, -1, 0]) {
    const line = [offset, offset + 1, offset + 2].map((step) => bannerIndex + step);
    if (line.some((index) => index < 0 || index > 8)) continue;
    const owned = line.filter((index) => claimed.has(index)).length;
    if (owned === 2) score += 70;
    else if (owned === 1) score += 18;
  }
  return score;
}

function cpuWouldClaimAfter(card, bannerIndex) {
  const row = state.players[state.active].rows[bannerIndex];
  const previousCounter = state.completionCounter;
  const previousCompletedAt = state.players[state.active].completedAt[bannerIndex];
  row.push(card);
  if (row.length === bannerSize(bannerIndex)) {
    state.completionCounter += 1;
    state.players[state.active].completedAt[bannerIndex] = state.completionCounter;
  }
  const result = canClaim(state.active, bannerIndex);
  row.pop();
  state.completionCounter = previousCounter;
  state.players[state.active].completedAt[bannerIndex] = previousCompletedAt;
  return result;
}

function cpuShouldUseEnvironment(card, bannerIndex) {
  const mine = state.players[state.active].rows[bannerIndex];
  const theirs = state.players[1 - state.active].rows[bannerIndex];
  if (card.effect === "mud") return theirs.length >= 2 && mine.length <= theirs.length;
  if (card.effect === "fog") {
    const mineTotal = mine.reduce((sum, item) => sum + (item.rank ?? 5), 0);
    const theirTotal = theirs.reduce((sum, item) => sum + (item.rank ?? 5), 0);
    return mine.length >= 2 && mineTotal >= theirTotal;
  }
  return false;
}

function cpuPlayMove(move) {
  const player = activePlayer();
  const cardIndex = player.hand.findIndex((card) => card.id === move.card.id);
  if (cardIndex === -1) return;

  if (move.card.type === "tactic") {
    const played = commitTactic(cardIndex, move.bannerIndex);
    if (played.kind === "environment") {
      state.bannerEffects[move.bannerIndex][played.effect] = true;
      state.players.forEach((targetPlayer) => {
        if (targetPlayer.rows[move.bannerIndex].length < bannerSize(move.bannerIndex)) targetPlayer.completedAt[move.bannerIndex] = null;
      });
      addTurnEvent({ text: `CPU changed Banner ${move.bannerIndex + 1} with ${played.name}.`, banners: [move.bannerIndex] });
    } else {
      player.rows[move.bannerIndex].push(played);
      markCompletedIfFull(state.active, move.bannerIndex);
      addTurnEvent({
        text: `CPU played ${played.name} on Banner ${move.bannerIndex + 1}.`,
        banners: [move.bannerIndex],
        lanes: [{ player: state.active, banner: move.bannerIndex }],
      });
    }
  } else {
    const [played] = player.hand.splice(cardIndex, 1);
    player.rows[move.bannerIndex].push(played);
    markCompletedIfFull(state.active, move.bannerIndex);
    state.selectedCardId = null;
    state.hasPlayedThisTurn = true;
    state.mustDraw = state.deck.length > 0 || state.tacticDeck.length > 0;
    addTurnEvent({
      text: `CPU placed ${cardLabel(played)} on Banner ${move.bannerIndex + 1}.`,
      banners: [move.bannerIndex],
      lanes: [{ player: state.active, banner: move.bannerIndex }],
    });
    state.message = "CPU placed a card.";
  }
}

function cpuDrawBestCard() {
  if (!state.mustDraw || state.gameOver) return;
  if (state.deck.length === 0 && state.tacticDeck.length > 0) {
    drawTacticTo(state.active);
    addTurnEvent({ text: "CPU drew a tactic card." });
  } else {
    drawTo(state.active);
    addTurnEvent({ text: "CPU drew a troop card." });
  }
  undoSnapshot = null;
  scoutReturnSnapshot = null;
  state.mustDraw = false;
  state.message = "CPU refilled its hand.";
}

function render() {
  const topIndex = 0;
  const bottomIndex = 1;
  const turnLocked = state.awaitingTurnStart && (!isNetworkMatch() || canActNow());
  const actionBlocked = turnLocked || !canActNow();
  const handOwnerIndex = viewerPlayerIndex();
  hideCardTooltip();
  document.body.classList.toggle("north-turn", state.active === 0);
  document.body.classList.toggle("south-turn", state.active === 1);
  renderRows(els.opponentRows, topIndex);
  renderRows(els.playerRows, bottomIndex);
  renderBanners();
  renderRoutedCards();
  renderUsedCommands();
  renderHand();
  renderOpponentHand();
  renderTurnPassOverlay();

  els.turnLabel.textContent = activePlayer().name;
  els.turnCard.className = `turn-card active-${state.active === 0 ? "north" : "south"}`;
  els.northMarker.className = `side-marker ${state.active === 0 ? "active-north" : ""}`;
  els.southMarker.className = `side-marker ${state.active === 1 ? "active-south" : ""}`;
  els.northMarker.textContent = state.active === 0 ? "North - ACTIVE" : "North";
  els.southMarker.textContent = state.active === 1 ? "South - ACTIVE" : "South";
  els.deckCount.textContent = String(state.deck.length);
  els.tacticDeckCount.textContent = String(state.tacticDeck.length);
  els.northTacticsUsed.textContent = tacticUseText(0);
  els.southTacticsUsed.textContent = tacticUseText(1);
  renderMessage();
  renderSelectedHint();
  els.handTitle.textContent = turnLocked ? `${state.players[handOwnerIndex].name} Hand Hidden` : `${state.players[handOwnerIndex].name} Hand`;

  const card = selectedCard();
  const scoutDrawing = state.pendingCommand?.effect === "scout" && state.pendingCommand.step === "draw";
  els.drawButton.textContent = scoutDrawing ? "Pathfinder: Troop" : "Draw Troop";
  els.drawTacticButton.textContent = scoutDrawing ? "Pathfinder: Tactic" : "Draw Tactic";
  els.claimButton.disabled = actionBlocked || state.gameOver || Boolean(state.pendingCommand) || !canClaim(state.active, state.selectedBanner);
  els.drawButton.disabled = actionBlocked || state.gameOver || (!scoutDrawing && (Boolean(state.pendingCommand) || !state.mustDraw)) || state.deck.length === 0;
  els.drawTacticButton.disabled = actionBlocked || state.gameOver || (!scoutDrawing && (Boolean(state.pendingCommand) || !state.mustDraw)) || state.tacticDeck.length === 0;
  els.playTacticButton.textContent = state.pendingCommand ? "Cancel Tactic" : "Play Tactic";
  const scoutCannotCancel = state.pendingCommand?.effect === "scout" && !undoSnapshot;
  els.playTacticButton.disabled = actionBlocked || state.gameOver || scoutCannotCancel || (!state.pendingCommand && (state.mustDraw || state.hasPlayedThisTurn || !canPlayTacticCard(card)));
  els.endTurnButton.disabled = actionBlocked || state.gameOver || Boolean(state.pendingCommand) || state.mustDraw || (!state.hasPlayedThisTurn && !activeSideFull());
  const canUndoPendingScout = state.pendingCommand?.effect === "scout" && state.pendingCommand.step === "draw" && Boolean(undoSnapshot);
  const canUndoGameOver = state.gameOver && Boolean(state.gameOverUndoState);
  els.undoButton.disabled = canUndoGameOver
    ? false
    : actionBlocked || !undoSnapshot || (Boolean(state.pendingCommand) && !canUndoPendingScout);
  els.newGameButton.hidden = confirmingNewGame;
  els.newGameConfirm.hidden = !confirmingNewGame;
  renderCpuControls();
  scheduleCpuTurn();
}

function handleNewGameButton() {
  if (!confirmingNewGame) {
    confirmingNewGame = true;
    state.message = "Start a new game?";
    render();
    return;
  }
  newGame();
}

function cancelNewGameConfirm() {
  confirmingNewGame = false;
  state.message = "New game canceled.";
  render();
}

function renderMessage() {
  renderTurnSummary(els.message);
}

function renderSelectedHint() {
  renderTurnSummary(els.selectedHint);
}

function renderTurnSummary(container) {
  container.innerHTML = "";
  const viewerIndex = viewerPlayerIndex();
  const turnLabel = isCpuTurn()
    ? `CPU turn (${activePlayer().name})`
    : isNetworkMatch()
    ? `Your side (${state.players[viewerIndex]?.name ?? "Spectator"}) / Current turn (${activePlayer().name})`
    : `Your turn (${activePlayer().name})`;
  const detail = isCpuTurn()
    ? state.message
    : isNetworkMatch() && !canActNow()
    ? `${networkBlockedMessage()} ${state.message}`
    : state.message;
  appendTurnSummaryBlock(container, turnLabel, detail, "current-turn-line");
  const last = lastTurnInfo();
  if (last) {
    appendTurnSummaryBlock(container, last.label, last.detail, "last-turn-line");
  }
}

function appendTurnSummaryBlock(container, label, detail, className) {
  const line = document.createElement("div");
  line.className = `message-line ${className}`;
  const labelElement = document.createElement("span");
  labelElement.className = "summary-label";
  labelElement.textContent = `${label}:`;
  const detailElement = document.createElement("span");
  detailElement.className = "summary-detail";
  detailElement.textContent = detail;
  line.append(labelElement, detailElement);
  container.append(line);
}

function renderCpuControls() {
  if (!els.cpuToggleButton || !els.cpuStatusText) return;
  const cpu = cpuState();
  const unavailable = isNetworkMatch();
  els.cpuToggleButton.disabled = unavailable;
  els.cpuToggleButton.classList.toggle("cpu-active", cpu.enabled && !unavailable);
  els.cpuToggleButton.textContent = cpu.enabled && !unavailable ? "CPU: ON" : "CPU Opponent";
  if (unavailable) {
    els.cpuStatusText.textContent = "Online opponent connected";
  } else if (cpu.enabled) {
    els.cpuStatusText.textContent = `${state.players[cpu.player]?.name ?? "CPU"} is controlled by CPU`;
  } else {
    els.cpuStatusText.textContent = "Solo only";
  }
}

function exportNetworkState() {
  return JSON.parse(JSON.stringify(state));
}

function applyNetworkState(remoteState) {
  if (!remoteState || typeof remoteState !== "object") return;
  applyingRemoteState = true;
  Object.assign(state, JSON.parse(JSON.stringify(remoteState)));
  if (networkReady && state.cpu?.enabled) {
    state.cpu.enabled = false;
    state.cpu.player = null;
  }
  state.selectedCardId = null;
  confirmingNewGame = false;
  undoSnapshot = null;
  scoutReturnSnapshot = null;
  hideWinOverlay();
  if (state.gameOver) {
    const winner = winnerIndex();
    if (winner !== null) showWinOverlayForCurrentViewer(winner);
  }
  render();
  applyingRemoteState = false;
}

function setNetworkInfo(seat, ready) {
  networkSeat = seat || null;
  networkReady = Boolean(ready);
  if (networkReady && cpuState().enabled) {
    cancelCpuTurn();
    state.cpu.enabled = false;
    state.cpu.player = null;
    state.message = "Online opponent joined. CPU opponent disabled.";
  }
  render();
}

function publishNetworkState(reason) {
  if (applyingRemoteState) return;
  if (!window.FrontLineNetwork?.publishState) return;
  window.FrontLineNetwork.publishState(reason, exportNetworkState());
}

window.FrontLineGame = {
  applyState: applyNetworkState,
  exportState: exportNetworkState,
  setNetworkInfo,
};

function tacticUseText(playerIndex) {
  const used = state.players[playerIndex].tacticsPlayed;
  const opponentUsed = state.players[1 - playerIndex].tacticsPlayed;
  return `${used} / ${opponentUsed + 1}`;
}

function renderRows(container, playerIndex) {
  container.innerHTML = "";
  for (let i = 0; i < 9; i += 1) {
    const lane = document.createElement("div");
    lane.dataset.playerIndex = String(playerIndex);
    lane.dataset.bannerIndex = String(i);
    lane.className = [
      "lane",
      isLaneDropTarget(playerIndex, i) ? "lane-drop-target" : "",
      isDestinationLane(playerIndex, i) ? "destination-lane" : "",
      isLastTurnLane(playerIndex, i) ? "last-turn-lane" : "",
    ].filter(Boolean).join(" ");
    lane.addEventListener("dragover", (event) => {
      if (canDropCardOnLane(event, playerIndex, i)) {
        event.preventDefault();
        lane.classList.add("drag-over");
      }
    });
    lane.addEventListener("dragleave", () => {
      lane.classList.remove("drag-over");
    });
    lane.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      lane.classList.remove("drag-over");
      const cardId = draggedCardId || event.dataTransfer.getData("text/plain");
      if (cardId) playCardById(cardId, i);
    });
    lane.addEventListener("click", (event) => {
      if (event.target.closest(".card")) return;
      if (state.pendingCommand?.step === "destination" && isDestinationLane(playerIndex, i)) {
        finishDestinationCommand(i);
        return;
      }
      if (!state.selectedCardId || playerIndex !== state.active) return;
      playSelectedCard(i);
    });
    const cards = state.players[playerIndex].rows[i];
    cards.forEach((card, cardIndex) => lane.append(cardElement(card, playerIndex, i, cardIndex)));
    const score = formation(cards, i);
    const label = document.createElement("div");
    label.className = "formation";
    label.textContent = score ? `${score.label} ${score.total}` : `${cards.length}/${bannerSize(i)}`;
    lane.append(label);
    container.append(lane);
  }
}

function renderBanners() {
  els.banners.innerHTML = "";
  for (let i = 0; i < 9; i += 1) {
    const owner = claimOwner(i);
    const banner = document.createElement("div");
    banner.dataset.bannerIndex = String(i);
    banner.className = [
      "banner",
      i === state.selectedBanner ? "selected" : "",
      isDestinationBanner(i) ? "destination" : "",
      isPlaceableBanner(i) ? "placeable" : "",
      state.bannerEffects[i].fog ? "weather-mist" : "",
      state.bannerEffects[i].mud ? "weather-bog" : "",
      isLastTurnBanner(i) ? "last-turn-banner" : "",
      owner === 0 ? "claimed-top" : "",
      owner === 1 ? "claimed-bottom" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const title = document.createElement("div");
    title.className = "banner-title";
    title.textContent = `Banner ${i + 1}`;
    const ownerLabel = document.createElement("div");
    ownerLabel.className = "banner-owner";
    ownerLabel.textContent = owner === null ? "Open" : `${state.players[owner].name} secured`;
    const effectBadges = document.createElement("div");
    effectBadges.className = "effect-badges";
    if (state.bannerEffects[i].fog) effectBadges.append(effectBadge("MIST", "Total only", "mist"));
    if (state.bannerEffects[i].mud) effectBadges.append(effectBadge("BOG", "Four cards", "bog"));
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `Select Banner ${i + 1}`);
    banner.addEventListener("dragover", (event) => {
      if (canDropCardOnBanner(event, i)) {
        event.preventDefault();
        banner.classList.add("drag-over");
      }
    });
    banner.addEventListener("dragleave", () => {
      banner.classList.remove("drag-over");
    });
    banner.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      banner.classList.remove("drag-over");
      const cardId = draggedCardId || event.dataTransfer.getData("text/plain");
      if (cardId) playCardById(cardId, i);
    });
    button.addEventListener("click", () => {
      state.selectedBanner = i;
      if (state.selectedCardId) playSelectedCard(i);
      else render();
    });
    banner.append(title, ownerLabel, effectBadges, button);
    els.banners.append(banner);
  }
}

function activeHandCardById(cardId) {
  return activePlayer().hand.find((item) => item.id === cardId) ?? null;
}

function canDropCardOnBannerById(cardId, bannerIndex) {
  if (!canActNow()) return false;
  const card = activeHandCardById(cardId);
  if (!card || state.gameOver || state.pendingCommand || state.mustDraw || state.hasPlayedThisTurn) return false;
  if (card.type === "tactic" && !canPlayTacticCard(card)) return false;
  if (card.type !== "tactic") return canPlaceOnBanner(state.active, bannerIndex);
  if (card.kind === "formation") return canPlaceOnBanner(state.active, bannerIndex);
  if (card.kind === "environment") return canUseEnvironmentOnBanner(card, bannerIndex);
  return false;
}

function canDropCardOnBanner(event, bannerIndex) {
  const cardId = draggedCardId || event.dataTransfer?.getData("text/plain");
  return canDropCardOnBannerById(cardId, bannerIndex);
}

function canDropCardOnLaneById(cardId, playerIndex, bannerIndex) {
  const card = activeHandCardById(cardId);
  return playerIndex === state.active && card?.kind !== "environment" && canDropCardOnBannerById(cardId, bannerIndex);
}

function canDropCardOnLane(event, playerIndex, bannerIndex) {
  const cardId = draggedCardId || event.dataTransfer?.getData("text/plain");
  return canDropCardOnLaneById(cardId, playerIndex, bannerIndex);
}

function canUseEnvironmentOnBanner(card, bannerIndex) {
  if (claimOwner(bannerIndex) !== null) return false;
  if (card.effect === "fog" && state.bannerEffects[bannerIndex].fog) return false;
  if (card.effect === "mud" && state.bannerEffects[bannerIndex].mud) return false;
  return true;
}

function draggedHandCard(event) {
  if (!canActNow()) return null;
  const cardId = draggedCardId || event.dataTransfer?.getData("text/plain");
  return activeHandCardById(cardId);
}

function canDropCommandOnBoardById(cardId) {
  const card = activeHandCardById(cardId);
  return Boolean(card)
    && card.type === "tactic"
    && card.kind === "command"
    && !state.gameOver
    && !state.pendingCommand
    && !state.mustDraw
    && !state.hasPlayedThisTurn
    && canPlayTacticCard(card);
}

function canDropCommandOnBoard(event) {
  const card = draggedHandCard(event);
  return canDropCommandOnBoardById(card?.id);
}

function playCommandCardById(cardId) {
  const card = activePlayer().hand.find((item) => item.id === cardId);
  if (!card || card.type !== "tactic" || card.kind !== "command") return;
  state.selectedCardId = cardId;
  playSelectedTactic(state.selectedBanner);
}

function beginPointerCardDrag(event, card, sourceElement) {
  if (event.pointerType === "mouse" || sourceElement.disabled) return;
  pointerDrag = {
    cardId: card.id,
    pointerId: event.pointerId,
    sourceElement,
    startX: event.clientX,
    startY: event.clientY,
    dragging: false,
    ghost: null,
  };
  sourceElement.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", handlePointerCardMove, { passive: false });
  window.addEventListener("pointerup", finishPointerCardDrag, { passive: false });
  window.addEventListener("pointercancel", cancelPointerCardDrag, { passive: false });
}

function startPointerCardDrag(event) {
  if (!pointerDrag || pointerDrag.dragging) return;
  const sourceRect = pointerDrag.sourceElement.getBoundingClientRect();
  const ghost = pointerDrag.sourceElement.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.style.height = `${sourceRect.height}px`;
  ghost.style.width = `${sourceRect.width}px`;
  document.body.append(ghost);
  pointerDrag.ghost = ghost;
  pointerDrag.dragging = true;
  draggedCardId = pointerDrag.cardId;
  pointerDrag.sourceElement.classList.add("drag-source");
  document.body.classList.add("touch-card-dragging");
  refreshPointerDropTargets();
  movePointerGhost(event.clientX, event.clientY);
  updatePointerHover(event.clientX, event.clientY);
}

function handlePointerCardMove(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const deltaX = event.clientX - pointerDrag.startX;
  const deltaY = event.clientY - pointerDrag.startY;
  if (!pointerDrag.dragging && Math.hypot(deltaX, deltaY) > 8) startPointerCardDrag(event);
  if (!pointerDrag.dragging) return;
  event.preventDefault();
  movePointerGhost(event.clientX, event.clientY);
  updatePointerHover(event.clientX, event.clientY);
}

function finishPointerCardDrag(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const target = pointerDrag.dragging ? pointerDropTargetFromPoint(event.clientX, event.clientY) : null;
  const cardId = pointerDrag.cardId;
  const didDrag = pointerDrag.dragging;
  cleanupPointerCardDrag();
  if (!didDrag) return;
  suppressCardClickUntil = Date.now() + 450;
  event.preventDefault();
  if (target?.type === "lane" || target?.type === "banner") playCardById(cardId, target.bannerIndex);
  if (target?.type === "command") playCommandCardById(cardId);
}

function cancelPointerCardDrag(event) {
  if (event && pointerDrag && event.pointerId !== pointerDrag.pointerId) return;
  cleanupPointerCardDrag();
}

function cleanupPointerCardDrag() {
  if (!pointerDrag) return;
  pointerDrag.sourceElement.classList.remove("drag-source");
  pointerDrag.sourceElement.releasePointerCapture?.(pointerDrag.pointerId);
  pointerDrag.ghost?.remove();
  pointerDrag = null;
  draggedCardId = null;
  clearPointerDropTargets();
  document.body.classList.remove("touch-card-dragging");
  window.removeEventListener("pointermove", handlePointerCardMove);
  window.removeEventListener("pointerup", finishPointerCardDrag);
  window.removeEventListener("pointercancel", cancelPointerCardDrag);
}

function movePointerGhost(x, y) {
  if (!pointerDrag?.ghost) return;
  pointerDrag.ghost.style.left = `${x}px`;
  pointerDrag.ghost.style.top = `${y}px`;
}

function refreshPointerDropTargets() {
  const cardId = pointerDrag?.cardId;
  if (!cardId) return;
  document.querySelectorAll(".banner").forEach((banner) => {
    const bannerIndex = Number(banner.dataset.bannerIndex);
    banner.classList.toggle("touch-drop-target", canDropCardOnBannerById(cardId, bannerIndex));
  });
  document.querySelectorAll(".lane").forEach((lane) => {
    const playerIndex = Number(lane.dataset.playerIndex);
    const bannerIndex = Number(lane.dataset.bannerIndex);
    lane.classList.toggle("touch-drop-target", canDropCardOnLaneById(cardId, playerIndex, bannerIndex));
  });
  els.boardShell.classList.toggle("command-drop-target", canDropCommandOnBoardById(cardId));
}

function clearPointerDropTargets() {
  document.querySelectorAll(".touch-drop-target, .drag-over").forEach((element) => {
    element.classList.remove("touch-drop-target", "drag-over");
  });
  els.boardShell.classList.remove("command-drop-target");
}

function updatePointerHover(x, y) {
  document.querySelectorAll(".drag-over").forEach((element) => element.classList.remove("drag-over"));
  const target = pointerDropTargetFromPoint(x, y);
  target?.element?.classList.add("drag-over");
}

function pointerDropTargetFromPoint(x, y) {
  const cardId = pointerDrag?.cardId;
  if (!cardId) return null;
  const element = document.elementFromPoint(x, y);
  if (!element) return null;

  const lane = element.closest(".lane");
  if (lane) {
    const playerIndex = Number(lane.dataset.playerIndex);
    const bannerIndex = Number(lane.dataset.bannerIndex);
    if (canDropCardOnLaneById(cardId, playerIndex, bannerIndex)) {
      return { type: "lane", bannerIndex, element: lane };
    }
  }

  const banner = element.closest(".banner");
  if (banner) {
    const bannerIndex = Number(banner.dataset.bannerIndex);
    if (canDropCardOnBannerById(cardId, bannerIndex)) {
      return { type: "banner", bannerIndex, element: banner };
    }
  }

  if (els.boardShell.contains(element) && canDropCommandOnBoardById(cardId)) {
    return { type: "command", element: els.boardShell };
  }

  return null;
}

function effectBadge(label, title, variant = "") {
  const badge = document.createElement("span");
  badge.className = ["effect-badge", variant ? `effect-${variant}` : ""].filter(Boolean).join(" ");
  badge.textContent = label;
  badge.title = title;
  return badge;
}

function isDestinationBanner(bannerIndex) {
  if (state.pendingCommand?.step !== "destination") return false;
  const playerIndex = state.pendingCommand.effect === "traitor" ? state.active : state.pendingCommand.sourcePlayer;
  return validDestinationBanner(playerIndex, bannerIndex);
}

function isDestinationLane(playerIndex, bannerIndex) {
  if (state.pendingCommand?.step !== "destination") return false;
  const destinationPlayer = state.pendingCommand.effect === "traitor" ? state.active : state.pendingCommand.sourcePlayer;
  return playerIndex === destinationPlayer && validDestinationBanner(playerIndex, bannerIndex);
}

function isLaneDropTarget(playerIndex, bannerIndex) {
  return playerIndex === state.active && isPlaceableBanner(bannerIndex);
}

function isPlaceableBanner(bannerIndex) {
  if (!canActNow()) return false;
  if (state.gameOver || state.pendingCommand || state.mustDraw || state.hasPlayedThisTurn) return false;
  const card = selectedCard();
  if (card?.type === "tactic") return card.kind === "formation" && canPlayTacticCard(card) && canPlaceOnBanner(state.active, bannerIndex);
  return canActivePlaceAnyCard() && canPlaceOnBanner(state.active, bannerIndex);
}

function renderHand() {
  els.hand.innerHTML = "";
  const ownerIndex = viewerPlayerIndex();
  const owner = state.players[ownerIndex];
  const turnLocked = state.awaitingTurnStart && (!isNetworkMatch() || canActNow());
  if (turnLocked) {
    owner.hand.forEach(() => {
      const back = document.createElement("div");
      back.className = "card-back hand-guard-back";
      els.hand.append(back);
    });
    return;
  }
  owner
    .hand.slice()
    .sort((a, b) => cardSortKey(a).localeCompare(cardSortKey(b)))
    .forEach((card) => {
      const canReturnScout = canReturnScoutCard(card);
      const scoutReturning = canActNow() && state.pendingCommand?.effect === "scout" && state.pendingCommand.step === "return";
      const button = document.createElement("button");
      button.type = "button";
      button.className = [
        "card",
        "in-hand",
        card.type === "tactic" ? "tactic-card" : "",
        card.type === "tactic" ? tacticVisualClass(card) : "",
        canActNow() && state.selectedCardId === card.id ? "selected" : "",
        canReturnScout ? "returnable" : "",
      ].filter(Boolean).join(" ");
      button.style.setProperty("--card-color", card.colorValue);
      attachTacticTooltip(button, card);
      button.disabled = !canActNow() || state.gameOver || (!canReturnScout && (state.mustDraw || state.hasPlayedThisTurn || Boolean(state.pendingCommand)));
      button.draggable = !button.disabled && !canReturnScout;
      button.addEventListener("dragstart", (event) => {
        draggedCardId = card.id;
        event.dataTransfer.setData("text/plain", card.id);
        event.dataTransfer.effectAllowed = "move";
      });
      button.addEventListener("dragend", () => {
        draggedCardId = null;
      });
      button.addEventListener("pointerdown", (event) => {
        if (scoutReturning) return;
        beginPointerCardDrag(event, card, button);
      });
      button.addEventListener("click", () => {
        if (Date.now() < suppressCardClickUntil) return;
        if (canReturnScout) {
          returnScoutCard(card.id);
          return;
        }
        state.selectedCardId = state.selectedCardId === card.id ? null : card.id;
        render();
      });
      button.append(cardFace(card));
      els.hand.append(button);
    });
}

function renderTurnPassOverlay() {
  const showOverlay = state.awaitingTurnStart && (!isNetworkMatch() || canActNow());
  els.turnPassOverlay.hidden = !showOverlay;
  if (!showOverlay) return;
  els.turnPassPlayer.textContent = `${activePlayer().name}'s turn`;
  els.turnPassButton.textContent = `Show ${activePlayer().name} Hand`;
}

function renderOpponentHand() {
  const viewerIndex = viewerPlayerIndex();
  const opponent = state.players[viewerIndex === 0 ? 1 : 0];
  els.opponentHand.innerHTML = "";
  els.opponentHandCount.textContent = String(opponent.hand.length);
  opponent.hand.forEach((card) => {
    const back = document.createElement("div");
    back.className = `card-back ${card.type === "tactic" ? "tactic-back" : "troop-back"}`;
    if (card.type === "tactic") {
      const mark = document.createElement("span");
      mark.textContent = "?";
      back.append(mark);
    }
    els.opponentHand.append(back);
  });
}

function renderRoutedCards() {
  els.routedCards.innerHTML = "";
  if (state.routedCards.length === 0) {
    const empty = document.createElement("span");
    empty.className = "routed-empty";
    empty.textContent = "-";
    els.routedCards.append(empty);
    return;
  }
  state.routedCards.forEach((entry) => {
    const card = cardElement(entry.card);
    card.classList.add("routed-card");
    card.title = `${cardLabel(entry.card)} removed from Banner ${entry.banner + 1}`;
    els.routedCards.append(card);
  });
}

function renderUsedCommands() {
  renderUsedCommandGroup(els.northUsedCommands, 0);
  renderUsedCommandGroup(els.southUsedCommands, 1);
}

function renderUsedCommandGroup(container, playerIndex) {
  container.innerHTML = "";
  const commands = state.usedCommands.filter((entry) => entry.player === playerIndex);
  if (commands.length === 0) {
    const empty = document.createElement("span");
    empty.className = "used-command-empty";
    empty.textContent = "-";
    container.append(empty);
    return;
  }
  commands.forEach((entry) => {
    const card = cardElement(entry.card);
    card.classList.add("used-command-card");
    card.title = `${state.players[playerIndex].name} used ${entry.card.name}`;
    container.append(card);
  });
}

function renderTacticGuide() {
  els.tacticGuideList.innerHTML = "";
  TACTICS.forEach((card) => {
    const previewCard = {
      ...card,
      type: "tactic",
      id: `guide-${card.id}`,
      colorValue: "#1f1f1d",
    };
    const item = document.createElement("article");
    item.className = "tactic-guide-card";
    const preview = cardElement(previewCard);
    preview.classList.add("guide-preview");
    const title = document.createElement("h3");
    title.textContent = card.name;
    const meta = document.createElement("p");
    meta.className = "tactic-guide-meta";
    meta.textContent = card.kind;
    const text = document.createElement("p");
    text.textContent = card.text;
    item.append(preview, title, meta, text);
    els.tacticGuideList.append(item);
  });
}

function showWinOverlayForCurrentViewer(winner) {
  const viewer = playerIndexForSeat(networkSeat);
  const didLose = isNetworkMatch() && viewer !== null && viewer !== winner;
  const labelName = didLose ? state.players[viewer].name : state.players[winner].name;
  showWinOverlay(labelName, didLose);
}

function showWinOverlay(name, didLose = false) {
  const bannerLabel = els.winOverlay.querySelector(".win-burst span");
  if (bannerLabel) bannerLabel.textContent = didLose ? name.toUpperCase() : "VICTORY";
  els.winnerName.textContent = didLose ? "DEFEAT" : `${name} WINS`;
  els.winOverlay.hidden = false;
  els.winOverlay.classList.remove("show", "winner-north", "winner-south", "loser");
  if (didLose) {
    els.winOverlay.classList.add("loser");
  } else {
    els.winOverlay.classList.add(name === "North" ? "winner-north" : "winner-south");
  }
  requestAnimationFrame(() => els.winOverlay.classList.add("show"));
}

function hideWinOverlay() {
  els.winOverlay.hidden = true;
  els.winOverlay.classList.remove("show", "winner-north", "winner-south", "loser");
}

function cardElement(card, playerIndex = null, bannerIndex = null, cardIndex = null) {
  const canTarget = playerIndex !== null && isBoardCardTargetable(playerIndex, bannerIndex, cardIndex);
  const element = document.createElement(canTarget ? "button" : "div");
  element.className = [
    "card",
    card.type === "tactic" ? "tactic-card" : "",
    card.type === "tactic" ? tacticVisualClass(card) : "",
    canTarget ? "targetable" : "",
  ].filter(Boolean).join(" ");
  element.style.setProperty("--card-color", card.colorValue);
  attachTacticTooltip(element, card);
  if (canTarget) {
    element.type = "button";
    element.addEventListener("click", () => {
      if (discardRedeploySource(playerIndex, bannerIndex, cardIndex)) return;
      handleBoardCardClick(playerIndex, bannerIndex, cardIndex);
    });
  }
  element.append(cardFace(card));
  return element;
}

function cardFace(card) {
  const fragment = document.createDocumentFragment();
  if (card.type === "tactic") {
    const rank = document.createElement("strong");
    rank.textContent = tacticMark(card);
    const color = document.createElement("span");
    color.textContent = card.name;
    if (card.wild === "leader") fragment.append(leaderCrownRow());
    fragment.append(rank, color);
    return fragment;
  }
  const rank = document.createElement("strong");
  rank.textContent = card.rank;
  const color = document.createElement("span");
  color.textContent = card.colorLabel;
  fragment.append(rank, color);
  return fragment;
}

function leaderCrownRow() {
  const row = document.createElement("div");
  row.className = "leader-crowns";
  const crown = document.createElement("span");
  crown.className = "leader-crown";
  row.append(crown);
  return row;
}

function attachTacticTooltip(element, card) {
  if (card.type !== "tactic") return;
  const tooltipText = tacticTooltipText(card);
  element.setAttribute("aria-label", tooltipText);
  element.addEventListener("mouseenter", (event) => showCardTooltip(card, event.clientX, event.clientY));
  element.addEventListener("mousemove", (event) => moveCardTooltip(event.clientX, event.clientY));
  element.addEventListener("mouseleave", hideCardTooltip);
  element.addEventListener("focus", () => {
    const rect = element.getBoundingClientRect();
    showCardTooltip(card, rect.left + rect.width / 2, rect.top);
  });
  element.addEventListener("blur", hideCardTooltip);
}

function tacticTooltipText(card) {
  return `${card.name}\nUse: ${tacticUseTextForCard(card)}\nEffect: ${card.text}`;
}

function tacticUseTextForCard(card) {
  if (card.kind === "formation") return "Play it to one of your banner lanes as your card for the turn.";
  if (card.kind === "environment") return "Drop or play it on an open banner to change that banner's rule.";
  if (card.effect === "scout") return "Drop it on the board, draw three cards, then return two of those drawn cards to the top of their decks.";
  if (card.effect === "redeploy") return "Drop it on the board, choose one of your unclaimed cards, then move or discard it.";
  if (card.effect === "deserter") return "Drop it on the board, then choose one opposing unclaimed card to remove.";
  if (card.effect === "traitor") return "Drop it on the board, then flip one opposing troop card to your side.";
  return "Drop it on the board to start its command.";
}

function showCardTooltip(card, x, y) {
  els.cardTooltip.textContent = tacticTooltipText(card);
  els.cardTooltip.hidden = false;
  moveCardTooltip(x, y);
}

function moveCardTooltip(x, y) {
  if (els.cardTooltip.hidden) return;
  const gap = 14;
  const edge = 10;
  const rect = els.cardTooltip.getBoundingClientRect();
  let left = x + gap;
  let top = y + gap;
  if (left + rect.width > window.innerWidth - edge) left = x - rect.width - gap;
  if (top + rect.height > window.innerHeight - edge) top = y - rect.height - gap;
  els.cardTooltip.style.left = `${Math.max(edge, left)}px`;
  els.cardTooltip.style.top = `${Math.max(edge, top)}px`;
}

function hideCardTooltip() {
  els.cardTooltip.hidden = true;
}

function tacticMark(card) {
  if (card.wild === "leader") return "ALL";
  if (card.wild === "rank8") return "8";
  if (card.wild === "rank123") return "1-3";
  if (card.effect === "fog") return "MIST";
  if (card.effect === "mud") return "BOG";
  if (card.effect === "scout") return "SCOPE";
  if (card.effect === "redeploy") return "MOVE";
  if (card.effect === "deserter") return "REMOVE";
  if (card.effect === "traitor") return "FLIP";
  return "TACT";
}

function tacticVisualClass(card) {
  if (card.wild === "leader") return `tactic-leader ${card.id.includes("envoy") ? "tactic-leader-envoy" : "tactic-leader-marshal"}`;
  if (card.wild === "rank8") return "tactic-rank8";
  if (card.wild === "rank123") return "tactic-rank123";
  if (card.effect === "fog") return "tactic-fog";
  if (card.effect === "mud") return "tactic-mud";
  if (card.effect === "scout") return "tactic-scout";
  if (card.effect === "redeploy") return "tactic-redeploy";
  if (card.effect === "deserter") return "tactic-deserter";
  if (card.effect === "traitor") return "tactic-traitor";
  return "";
}

function cardLabel(card) {
  if (card.type === "tactic") return `${card.name} (${card.kind})`;
  return `${card.colorLabel} ${card.rank}`;
}

function cardSortKey(card) {
  if (card.type === "tactic") return `z-${card.name}`;
  return `${card.colorLabel}-${String(card.rank).padStart(2, "0")}`;
}

els.claimButton.addEventListener("click", claimSelected);
els.drawButton.addEventListener("click", drawCard);
els.drawTacticButton.addEventListener("click", drawTacticCard);
els.playTacticButton.addEventListener("click", () => {
  if (state.pendingCommand) cancelPendingCommand();
  else playSelectedTactic(state.selectedBanner);
});
els.endTurnButton.addEventListener("click", endTurn);
els.undoButton.addEventListener("click", undoLastAction);
els.newGameButton.addEventListener("click", handleNewGameButton);
els.confirmNewGameButton.addEventListener("click", () => newGame());
els.cancelNewGameButton.addEventListener("click", cancelNewGameConfirm);
els.cpuToggleButton?.addEventListener("click", toggleCpuOpponent);
els.turnPassButton.addEventListener("click", revealTurnHand);
els.turnPassOverlay.addEventListener("click", revealTurnHand);
els.winOverlay.addEventListener("click", hideWinOverlay);
els.boardShell.addEventListener("dragover", (event) => {
  if (canDropCommandOnBoard(event)) {
    event.preventDefault();
    els.boardShell.classList.add("command-drop-target");
  }
});
els.boardShell.addEventListener("dragleave", (event) => {
  if (!els.boardShell.contains(event.relatedTarget)) {
    els.boardShell.classList.remove("command-drop-target");
  }
});
els.boardShell.addEventListener("drop", (event) => {
  if (!canDropCommandOnBoard(event)) return;
  event.preventDefault();
  els.boardShell.classList.remove("command-drop-target");
  const cardId = draggedCardId || event.dataTransfer.getData("text/plain");
  if (cardId) playCommandCardById(cardId);
});

renderTacticGuide();
newGame();
