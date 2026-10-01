import readline from "node:readline";

const DIRECTIONS = { UP: [0, -1], RIGHT: [1, 0], DOWN: [0, 1], LEFT: [-1, 0] };
const OPPOSITE = { UP: "DOWN", DOWN: "UP", RIGHT: "LEFT", LEFT: "RIGHT" };
const key = ([x, y]) => `${x},${y}`;
const wrap = (n, size) => (n + size) % size;

export function nextCell(cell, direction, board) {
  const [dx, dy] = DIRECTIONS[direction];
  return [wrap(cell[0] + dx, board.width), wrap(cell[1] + dy, board.height)];
}

export function distance(a, b, board) {
  const dx = Math.abs(a[0] - b[0]);
  const dy = Math.abs(a[1] - b[1]);
  return Math.min(dx, board.width - dx) + Math.min(dy, board.height - dy);
}

export function moves(observation) {
  const board = observation.board;
  const me = board.snakes.find((snake) => snake.id === observation.you);
  if (!me?.body.length) return [];
  const blocked = new Set();
  for (const snake of board.snakes) {
    for (const part of snake.body.slice(0, -1)) blocked.add(key(part));
  }
  return Object.keys(DIRECTIONS).filter((direction) => {
    if (me.body.length > 1 && direction === OPPOSITE[me.direction]) return false;
    return !blocked.has(key(nextCell(me.body[0], direction, board)));
  });
}

export function headRisk(cell, observation) {
  return observation.board.snakes.some((snake) =>
    snake.id !== observation.you && snake.body.length &&
    distance(cell, snake.body[0], observation.board) === 1);
}

export function nearestApple(cell, observation) {
  return Math.min(...observation.board.apples.map((apple) => distance(cell, apple, observation.board)));
}

export function openArea(start, observation) {
  const board = observation.board;
  const blocked = new Set(board.snakes.flatMap((snake) => snake.body.slice(0, -1).map(key)));
  blocked.delete(key(start));
  const seen = new Set([key(start)]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const direction of Object.keys(DIRECTIONS)) {
      const cell = nextCell(queue[i], direction, board);
      const k = key(cell);
      if (!seen.has(k) && !blocked.has(k)) {
        seen.add(k);
        queue.push(cell);
      }
    }
  }
  return seen.size;
}

export function serve(choose) {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    try {
      const observation = JSON.parse(line);
      const direction = choose(observation);
      process.stdout.write(`${JSON.stringify({ direction })}\n`);
    } catch (error) {
      console.error(error.stack ?? error.message);
      process.stdout.write('{"direction":"UP"}\n');
    }
  });
}
