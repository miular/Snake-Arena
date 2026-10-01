import readline from "node:readline";

const DIRS = [
  ["UP", 0, -1],
  ["RIGHT", 1, 0],
  ["DOWN", 0, 1],
  ["LEFT", -1, 0],
];
const OPPOSITE = { UP: "DOWN", RIGHT: "LEFT", DOWN: "UP", LEFT: "RIGHT" };
const key = ([x, y]) => `${x},${y}`;
const wrap = (n, size) => ((n % size) + size) % size;

function step(cell, direction, board) {
  const [, dx, dy] = DIRS.find(([name]) => name === direction) ?? ["", 0, 0];
  return [wrap(cell[0] + dx, board.width), wrap(cell[1] + dy, board.height)];
}

function distance(a, b, board) {
  const dx = Math.abs(a[0] - b[0]);
  const dy = Math.abs(a[1] - b[1]);
  return Math.min(dx, board.width - dx) + Math.min(dy, board.height - dy);
}

function legalDirections(snake) {
  return DIRS.map(([name]) => name).filter((name) =>
    snake.body.length <= 1 || name !== OPPOSITE[snake.direction]);
}

function flood(start, blocked, board) {
  const seen = new Set([key(start)]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const [direction] of DIRS) {
      const next = step(queue[i], direction, board);
      const k = key(next);
      if (!seen.has(k) && !blocked.has(k)) {
        seen.add(k);
        queue.push(next);
      }
    }
  }
  return seen.size;
}

function appleDistances(start, blocked, board) {
  const distances = new Map([[key(start), 0]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const here = queue[i];
    const nextDistance = distances.get(key(here)) + 1;
    for (const [direction] of DIRS) {
      const next = step(here, direction, board);
      const k = key(next);
      if (!distances.has(k) && !blocked.has(k)) {
        distances.set(k, nextDistance);
        queue.push(next);
      }
    }
  }
  return distances;
}

function tailRouteLength(start, body, enemies, board) {
  const tail = body.at(-1);
  if (!tail) return Infinity;
  const startKey = key(start);
  const tailKey = key(tail);
  if (startKey === tailKey) return 0;
  const blocked = new Set(body.slice(1, -1).map(key));
  for (const enemy of enemies) for (const part of enemy.body.slice(0, -1)) blocked.add(key(part));
  blocked.delete(startKey);
  blocked.delete(tailKey);
  const queue = [[start, 0]];
  const seen = new Set([startKey]);
  for (let i = 0; i < queue.length; i++) {
    const [here, steps] = queue[i];
    for (const [direction] of DIRS) {
      const next = step(here, direction, board);
      const nextKey = key(next);
      if (nextKey === tailKey) return steps + 1;
      if (!seen.has(nextKey) && !blocked.has(nextKey)) {
        seen.add(nextKey);
        queue.push([next, steps + 1]);
      }
    }
  }
  return Infinity;
}

function territoryBonus(start, nextBody, enemies, apples, board) {
  if (!enemies.length) return 0;

  const occupied = new Set(nextBody.slice(1).map(key));
  for (const enemy of enemies) {
    for (const part of enemy.body) occupied.add(key(part));
  }

  const startKey = key(start);
  const ownBlocked = new Set(occupied);
  ownBlocked.delete(startKey);
  const ownDistances = appleDistances(start, ownBlocked, board);

  const enemyDistances = enemies.map((enemy) => {
    const blocked = new Set(occupied);
    blocked.delete(key(enemy.body[0]));
    return appleDistances(enemy.body[0], blocked, board);
  });

  let my = 0;
  let opp = 0;
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const cellKey = x + "," + y;
      if (occupied.has(cellKey) || apples.has(cellKey)) continue;
      const myDistance = ownDistances.get(cellKey);
      if (myDistance === undefined) continue;
      let opponentDistance = Infinity;
      for (const distances of enemyDistances) {
        const distanceToCell = distances.get(cellKey);
        if (distanceToCell !== undefined && distanceToCell < opponentDistance) {
          opponentDistance = distanceToCell;
        }
      }
      if (myDistance < opponentDistance) my++;
      else if (myDistance > opponentDistance) opp++;
    }
  }

  const denominator = my + opp + 16;
  if (!denominator) return 0;
  const raw = 4 * (my - opp) / denominator;
  return Math.max(-4, Math.min(4, raw));
}
function choose(observation) {
  const board = observation.board;
  const me = board.snakes.find((snake) => snake.id === observation.you);
  if (!me?.body.length) return me?.direction ?? "UP";

  const appleSet = new Set(board.apples.map(key));
  const enemies = board.snakes.filter((snake) => snake.id !== me.id && snake.body.length);
  const options = legalDirections(me).sort((a, b) => Number(b === me.direction) - Number(a === me.direction));
  if (!options.length) return me.direction;

  const scoreMove = (direction) => {
    const head = step(me.body[0], direction, board);
    const eating = appleSet.has(key(head));
    const nextBody = [head, ...me.body];
    if (!eating) nextBody.pop();

    // Occupancy after our move and the portions of enemy bodies that cannot
    // disappear on this turn. Enemy tails are handled as uncertain cells.
    const blocked = new Set(nextBody.slice(1).map(key));
    const enemyHeadTargets = new Set();
    let tailRisk = 0;
    let closeHeadRisk = 0;
    let bodyCollision = false;
    for (const enemy of enemies) {
      for (const part of enemy.body.slice(0, -1)) blocked.add(key(part));
      if (enemy.body.length > 1 && key(enemy.body.at(-1)) === key(head)) tailRisk += 1;

      for (const enemyDirection of legalDirections(enemy)) {
        const target = step(enemy.body[0], enemyDirection, board);
        const targetKey = key(target);
        if (!enemy.body.slice(0, -1).some((part) => key(part) === targetKey)) {
          enemyHeadTargets.add(targetKey);
        }
      }
      if (enemyHeadTargets.has(key(head))) bodyCollision = true;
      const d = distance(head, enemy.body[0], board);
      if (d === 1) closeHeadRisk += 1;
    }

    const fatalCollision = blocked.has(key(head));
    const blockedForSearch = new Set(blocked);
    blockedForSearch.delete(key(head));
    // Account for the occupied cell after another snake's possible head move.
    for (const target of enemyHeadTargets) blockedForSearch.add(target);
    blockedForSearch.delete(key(head));

    if (fatalCollision) return -10000;

    const area = flood(head, blockedForSearch, board);
    const distances = appleDistances(head, blockedForSearch, board);
    let foodValue = -18;
    let bestDistance = Infinity;
    for (const apple of board.apples) {
      const d = distances.get(key(apple));
      if (d === undefined) continue;
      let nearestEnemy = Infinity;
      for (const enemy of enemies) nearestEnemy = Math.min(nearestEnemy, distance(enemy.body[0], apple, board));
      const raceCost = Number.isFinite(nearestEnemy) && nearestEnemy < d ? Math.min(8, (d - nearestEnemy) * 1.6) : 0;
      const value = -3.7 * d - raceCost;
      if (value > foodValue || bestDistance === Infinity) {
        foodValue = value;
        bestDistance = d;
      }
    }

    const capacity = board.width * board.height;
    let value = Math.min(area, 48) * 0.34 + foodValue;
    if (nextBody.length >= 18) {
      const tailDistance = tailRouteLength(head, nextBody, enemies, board);
      if (!Number.isFinite(tailDistance)) value -= 70;
      else value += Math.min(10, tailDistance * 0.25);
    }
    if (area <= me.body.length) value -= 180 + (me.body.length - area) * 20;
    else if (area < me.body.length + 5) value -= 35;
    value -= tailRisk * 9;
    value -= closeHeadRisk * 16;
    if (bodyCollision) value -= 130;
    if (appleSet.has(key(head))) value += 7;
    // Slightly prefer opening space over repeatedly circling a short loop.
    value += Math.min(area / Math.max(1, capacity), 0.2) * 8;
    const territoryScale = nextBody.length <= 32
      ? 1
      : Math.max(0.35, 1 - 0.65 * (nextBody.length - 32) / 32);
    value += territoryBonus(head, nextBody, enemies, appleSet, board) * territoryScale;
    return value;
  };

  let best = options[0];
  let bestValue = -Infinity;
  for (const direction of options) {
    const value = scoreMove(direction);
    if (value > bestValue) {
      bestValue = value;
      best = direction;
    }
  }
  return best;
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  try {
    const observation = JSON.parse(line);
    process.stdout.write(`${JSON.stringify({ direction: choose(observation) })}\n`);
  } catch {
    process.stdout.write('{"direction":"UP"}\n');
  }
});




