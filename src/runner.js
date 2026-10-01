import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGame, getObservation, getWinners, publicFrame, stepGame } from "./engine.js";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));

export function loadRoster() {
  const roster = JSON.parse(readFileSync(new URL("../roster.json", import.meta.url), "utf8"));
  if (!Array.isArray(roster) || roster.length < 2 || roster.length > 6) {
    throw new Error("roster.json must contain 2 to 6 contestants");
  }
  for (const entry of roster) {
    if (!entry.name || typeof entry.command !== "string" || !Array.isArray(entry.args)) {
      throw new Error("Each contestant needs name, command and args");
    }
  }
  if (new Set(roster.map((entry) => entry.name)).size !== roster.length) {
    throw new Error("Contestant names must be unique");
  }
  return roster;
}

class BotSession {
  constructor(entry) {
    this.name = entry.name;
    this.buffer = "";
    this.pending = null;
    this.failed = null;
    this.reported = false;
    this.stderr = "";
    const command = entry.command === "node" ? process.execPath : entry.command;
    this.child = spawn(command, entry.args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.receive(chunk));
    this.child.stderr.on("data", (chunk) => { this.stderr = (this.stderr + chunk).slice(-2000); });
    this.child.on("error", (error) => this.disable(`process error: ${error.message}`));
    this.child.on("exit", (code, signal) => {
      if (!this.failed) this.disable(`process exited (${signal ?? code})${this.stderr ? `: ${this.stderr.trim()}` : ""}`);
    });
  }

  receive(chunk) {
    if (this.failed) return;
    this.buffer += chunk;
    if (this.buffer.length > 65536) return this.disable("output exceeded 64 KB");
    const end = this.buffer.indexOf("\n");
    if (end === -1) return;
    const line = this.buffer.slice(0, end).trim();
    this.buffer = this.buffer.slice(end + 1);
    if (!this.pending) return this.disable("unexpected output on stdout");
    let direction;
    try {
      const value = JSON.parse(line);
      if (typeof value.direction !== "string") throw new Error("missing direction");
      direction = value.direction;
    } catch (error) {
      return this.disable(`invalid JSON response: ${error.message}`);
    }
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve({ direction, issue: null });
    if (this.buffer.includes("\n")) this.disable("multiple responses to one request");
  }

  disable(reason) {
    if (this.failed) return;
    this.failed = reason;
    this.child.kill();
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      this.reported = true;
      pending.resolve({ direction: null, issue: reason });
    }
  }

  ask(observation, timeoutMs) {
    if (this.failed) {
      const issue = this.reported ? null : this.failed;
      this.reported = true;
      return Promise.resolve({ direction: null, issue });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.disable(`response timeout after ${timeoutMs} ms`), timeoutMs);
      this.pending = { resolve, timer };
      this.child.stdin.write(`${JSON.stringify(observation)}\n`, (error) => {
        if (error) this.disable(`stdin error: ${error.message}`);
      });
    });
  }

  close() {
    if (!this.child.killed) this.child.kill();
  }
}

export async function runMatch(options = {}) {
  const roster = options.roster ?? loadRoster();
  const stateOptions = {
    names: roster.map((entry) => entry.name),
    seed: options.seed ?? 20260928,
    width: options.width ?? 20,
    height: options.height ?? 20,
    appleCount: options.appleCount ?? 5,
    maxTurns: options.maxTurns ?? 500,
  };
  let state = createGame(stateOptions);
  const frames = [publicFrame(state)];
  const sessions = roster.map((entry) => new BotSession(entry));
  const started = Date.now();
  try {
    while (state.turn < state.maxTurns) {
      const active = state.snakes.filter((snake) => snake.body.length);
      const replies = await Promise.all(active.map(async (snake) => {
        const session = sessions[state.snakes.indexOf(snake)];
        const timeout = state.turn === 0 ? 2500 : (options.moveTimeoutMs ?? 500);
        return [snake.id, await session.ask(getObservation(state, snake.id), timeout)];
      }));
      const actions = Object.fromEntries(replies.map(([id, reply]) => [
        id, reply.direction ?? state.snakes.find((snake) => snake.id === id).direction,
      ]));
      state = stepGame(state, actions);
      for (const [id, reply] of replies) {
        if (reply.issue) state.events.push({ type: "bot-error", snake: id, detail: reply.issue });
      }
      frames.push(publicFrame(state));
      if (options.onTurn) options.onTurn(state.turn, state.maxTurns);
    }
  } finally {
    for (const session of sessions) session.close();
  }
  return {
    config: stateOptions,
    roster: roster.map((entry, i) => ({ id: `snake-${i + 1}`, name: entry.name })),
    frames,
    winnerIds: getWinners(state),
    durationMs: Date.now() - started,
  };
}

export class HumanMatch {
  constructor(options = {}) {
    const bots = options.roster ?? loadRoster();
    if (bots.length > 5) throw new Error("Human matches support at most five AI contestants");
    const names = [...bots.map((entry) => entry.name), "本地玩家"];
    const stateOptions = {
      names,
      seed: options.seed ?? 20260928,
      width: options.width ?? 20,
      height: options.height ?? 20,
      appleCount: options.appleCount ?? 5,
      maxTurns: options.maxTurns ?? 500,
    };
    this.state = createGame(stateOptions);
    this.config = stateOptions;
    this.roster = names.map((name, i) => ({ id: `snake-${i + 1}`, name }));
    this.humanId = this.roster.at(-1).id;
    this.frames = [publicFrame(this.state)];
    this.started = Date.now();
    this.sessions = bots.map((entry) => new BotSession(entry));
    this.closed = false;
    this.stepping = false;
  }

  snapshot() {
    return {
      config: this.config,
      roster: this.roster,
      humanId: this.humanId,
      frames: this.frames,
    };
  }

  async step(direction) {
    if (this.closed) throw new Error("Human match is closed");
    if (this.stepping) throw new Error("A turn is already running");
    if (this.state.turn >= this.state.maxTurns) throw new Error("Human match is already over");
    if (direction !== undefined && direction !== null &&
        !["UP", "DOWN", "LEFT", "RIGHT"].includes(direction)) {
      throw new Error("direction must be UP, DOWN, LEFT or RIGHT");
    }
    this.stepping = true;
    try {
      const activeBots = this.state.snakes.slice(0, this.sessions.length).filter((snake) => snake.body.length);
      const replies = await Promise.all(activeBots.map(async (snake) => {
        const session = this.sessions[this.state.snakes.indexOf(snake)];
        const timeout = this.state.turn === 0 ? 2500 : 500;
        return [snake.id, await session.ask(getObservation(this.state, snake.id), timeout)];
      }));
      if (this.closed) throw new Error("Human match is closed");
      const actions = Object.fromEntries(replies.map(([id, reply]) => [
        id, reply.direction ?? this.state.snakes.find((snake) => snake.id === id).direction,
      ]));
      if (direction) actions[this.humanId] = direction;
      this.state = stepGame(this.state, actions);
      for (const [id, reply] of replies) {
        if (reply.issue) this.state.events.push({ type: "bot-error", snake: id, detail: reply.issue });
      }
      const frame = publicFrame(this.state);
      this.frames.push(frame);
      const finished = this.state.turn === this.state.maxTurns;
      if (finished) this.close();
      return { frame, finished, winnerIds: finished ? getWinners(this.state) : null };
    } finally {
      this.stepping = false;
    }
  }

  result() {
    if (this.state.turn !== this.state.maxTurns) throw new Error("Human match is not finished");
    return {
      config: this.config,
      roster: this.roster,
      humanId: this.humanId,
      frames: this.frames,
      winnerIds: getWinners(this.state),
      durationMs: Date.now() - this.started,
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const session of this.sessions) session.close();
  }
}

export async function runTournament(options = {}) {
  const roster = options.roster ?? loadRoster();
  const games = options.games ?? 8;
  if (!Number.isInteger(games) || games < 1 || games > 100) throw new Error("games must be 1–100");
  const seed = options.seed ?? 20260928;
  const stats = new Map(roster.map((entry) => [entry.name, {
    name: entry.name, wins: 0, tiedFirst: 0, totalScore: 0, totalDeaths: 0, totalApples: 0,
  }]));
  const results = [];
  for (let i = 0; i < games; i++) {
    const rotated = [...roster.slice(i % roster.length), ...roster.slice(0, i % roster.length)];
    const match = await runMatch({
      ...options,
      roster: rotated,
      seed: seed + i,
    });
    const final = match.frames.at(-1);
    const winners = match.winnerIds.map((id) => final.snakes.find((snake) => snake.id === id).name);
    for (const snake of final.snakes) {
      const row = stats.get(snake.name);
      row.totalScore += snake.score;
      row.totalDeaths += snake.deaths;
      row.totalApples += snake.applesEaten;
      if (winners.includes(snake.name)) {
        if (winners.length === 1) row.wins++;
        else row.tiedFirst++;
      }
    }
    results.push({
      game: i + 1,
      seed: seed + i,
      winners,
      scores: Object.fromEntries(final.snakes.map((snake) => [snake.name, snake.score])),
    });
    if (options.onGame) options.onGame(i + 1, games);
  }
  return {
    games,
    baseSeed: seed,
    standings: [...stats.values()].map((row) => ({
      name: row.name,
      wins: row.wins,
      tiedFirst: row.tiedFirst,
      averageScore: +(row.totalScore / games).toFixed(2),
      averageDeaths: +(row.totalDeaths / games).toFixed(2),
      averageApples: +(row.totalApples / games).toFixed(2),
    })).sort((a, b) => b.wins - a.wins || b.tiedFirst - a.tiedFirst || b.averageScore - a.averageScore),
    results,
  };
}
