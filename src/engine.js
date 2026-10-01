export const DEFAULT_CONFIG = Object.freeze({
  width: 20,
  height: 20,
  appleCount: 5,
  maxTurns: 500,
  initialLength: 3,
  seed: 20260928,
});

export const DIRECTIONS = Object.freeze({
  UP: [0, -1],
  RIGHT: [1, 0],
  DOWN: [0, 1],
  LEFT: [-1, 0],
});

const OPPOSITE = Object.freeze({ UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" });
const COLORS = ["#32d9af", "#ffbf63", "#aa94ff", "#ff748c", "#66b7ff", "#f2e46d"];

const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const key = (p) => `${p[0]},${p[1]}`;
const wrap = (value, size) => (value + size) % size;

function randomIndex(state, count) {
  let x = state.rngState >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.rngState = x >>> 0;
  return state.rngState % count;
}

function validate(config, names) {
  for (const field of ["width", "height", "appleCount", "maxTurns", "initialLength"]) {
    if (!Number.isInteger(config[field])) throw new Error(`${field} must be an integer`);
  }
  if (config.width < 5 || config.height < 5) throw new Error("Board must be at least 5 × 5");
  if (config.initialLength < 1 || config.initialLength >= Math.min(config.width, config.height)) {
    throw new Error("Invalid initialLength");
  }
  if (config.appleCount < 1 || config.maxTurns < 1) throw new Error("Apples and turns must be positive");
  if (names.length < 2 || names.length > 6) throw new Error("Use 2 to 6 snakes");
  if (config.width * config.height < names.length * (config.initialLength + 2) + config.appleCount) {
    throw new Error("Board is too small for the snakes and apples");
  }
}

function occupied(state) {
  const cells = new Set(state.apples.map(key));
  for (const snake of state.snakes) for (const part of snake.body) cells.add(key(part));
  return cells;
}

function spawnSnake(state, snake) {
  const taken = occupied(state);
  const candidates = [];
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      for (const [direction, [dx, dy]] of Object.entries(DIRECTIONS)) {
        const body = Array.from({ length: state.initialLength }, (_, i) => [
          wrap(x - dx * i, state.width),
          wrap(y - dy * i, state.height),
        ]);
        const ahead = [wrap(x + dx, state.width), wrap(y + dy, state.height)];
        const cells = new Set(body.map(key));
        if (cells.size !== body.length || body.some((p) => taken.has(key(p)))) continue;
        if (taken.has(key(ahead)) || cells.has(key(ahead))) continue;
        candidates.push({ body, direction });
      }
    }
  }
  if (!candidates.length) return false;
  const choice = candidates[randomIndex(state, candidates.length)];
  snake.body = choice.body;
  snake.direction = choice.direction;
  snake.respawnAt = null;
  return true;
}

function refillApples(state) {
  const taken = occupied(state);
  const free = [];
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      if (!taken.has(`${x},${y}`)) free.push([x, y]);
    }
  }
  while (state.apples.length < state.appleCount && free.length) {
    const index = randomIndex(state, free.length);
    state.apples.push(free.splice(index, 1)[0]);
  }
}

export function createGame(options = {}) {
  const names = options.names ?? ["青蛇", "橙蛇", "紫蛇", "红蛇"];
  const config = { ...DEFAULT_CONFIG, ...options };
  validate(config, names);
  const state = {
    width: config.width,
    height: config.height,
    appleCount: config.appleCount,
    maxTurns: config.maxTurns,
    initialLength: config.initialLength,
    seed: config.seed >>> 0,
    rngState: (config.seed >>> 0) || 1,
    turn: 0,
    apples: [],
    snakes: names.map((name, i) => ({
      id: `snake-${i + 1}`,
      name: String(name),
      color: COLORS[i],
      body: [],
      direction: "RIGHT",
      score: 0,
      deaths: 0,
      applesEaten: 0,
      respawnAt: null,
    })),
    events: [],
  };
  for (const snake of state.snakes) {
    if (!spawnSnake(state, snake)) throw new Error("Unable to place all snakes");
  }
  refillApples(state);
  return state;
}

export function stepGame(previous, actions = {}) {
  if (previous.turn >= previous.maxTurns) throw new Error("Game is already over");
  const state = structuredClone(previous);
  state.events = [];
  const plans = new Map();
  const oldHeads = new Map();
  const nextTurn = state.turn + 1;
  const appleSet = new Set(state.apples.map(key));

  for (const snake of state.snakes) {
    if (!snake.body.length) continue;
    oldHeads.set(snake.id, snake.body[0]);
    const requested = String(actions[snake.id] ?? snake.direction).toUpperCase();
    const valid = DIRECTIONS[requested] &&
      !(snake.body.length > 1 && requested === OPPOSITE[snake.direction]);
    const direction = valid ? requested : snake.direction;
    if (!valid) state.events.push({ type: "invalid", snake: snake.id, detail: requested });
    const [dx, dy] = DIRECTIONS[direction];
    const head = [wrap(snake.body[0][0] + dx, state.width), wrap(snake.body[0][1] + dy, state.height)];
    const eating = appleSet.has(key(head));
    const body = [head, ...snake.body];
    if (!eating) body.pop();
    plans.set(snake.id, { head, body, direction, eating });
  }

  const dead = new Map();
  const plansList = [...plans.entries()];
  for (let i = 0; i < plansList.length; i++) {
    const [id, plan] = plansList[i];
    for (let j = i + 1; j < plansList.length; j++) {
      const [otherId, other] = plansList[j];
      if (same(plan.head, other.head)) {
        dead.set(id, "head-to-head");
        dead.set(otherId, "head-to-head");
      } else if (same(plan.head, oldHeads.get(otherId)) && same(other.head, oldHeads.get(id))) {
        dead.set(id, "head-swap");
        dead.set(otherId, "head-swap");
      }
    }
  }
  for (const [id, plan] of plansList) {
    for (const [otherId, other] of plansList) {
      if (other.body.slice(1).some((part) => same(plan.head, part))) {
        if (!dead.has(id)) dead.set(id, id === otherId ? "self" : "body");
      }
    }
  }

  const eaten = new Set();
  for (const snake of state.snakes) {
    const plan = plans.get(snake.id);
    if (!plan) continue;
    if (dead.has(snake.id)) {
      const reason = dead.get(snake.id);
      snake.body = [];
      snake.score = 0;
      snake.deaths++;
      snake.respawnAt = nextTurn + 1;
      state.events.push({ type: "death", snake: snake.id, reason });
      continue;
    }
    snake.body = plan.body;
    snake.direction = plan.direction;
    if (plan.eating) {
      snake.score++;
      snake.applesEaten++;
      eaten.add(key(plan.head));
      state.events.push({ type: "apple", snake: snake.id, position: plan.head });
    }
  }
  state.apples = state.apples.filter((apple) => !eaten.has(key(apple)));
  state.turn = nextTurn;
  for (const snake of state.snakes) {
    if (snake.body.length || snake.respawnAt === null || snake.respawnAt > nextTurn) continue;
    if (spawnSnake(state, snake)) state.events.push({ type: "respawn", snake: snake.id });
    else snake.respawnAt = nextTurn + 1;
  }
  refillApples(state);
  return state;
}

export function getObservation(state, snakeId) {
  const you = state.snakes.find((snake) => snake.id === snakeId);
  if (!you) throw new Error(`Unknown snake: ${snakeId}`);
  const snakes = state.snakes.map(({ id, name, body, direction, score, deaths, applesEaten }) => ({
    id, name, body: structuredClone(body), direction, score, deaths, applesEaten,
  }));
  return {
    turn: state.turn,
    maxTurns: state.maxTurns,
    board: { width: state.width, height: state.height, apples: structuredClone(state.apples), snakes },
    you: snakeId,
  };
}

export function publicFrame(state) {
  const { rngState, ...frame } = state;
  return structuredClone(frame);
}

export function getWinners(state) {
  const best = Math.max(...state.snakes.map((snake) => snake.score));
  return state.snakes.filter((snake) => snake.score === best).map((snake) => snake.id);
}
