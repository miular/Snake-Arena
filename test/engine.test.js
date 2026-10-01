import test from "node:test";
import assert from "node:assert/strict";
import { createGame, getObservation, getWinners, stepGame } from "../src/engine.js";

function state(snakes, apples = []) {
  return {
    width: 7, height: 7, appleCount: apples.length || 1, maxTurns: 10,
    initialLength: 3, seed: 42, rngState: 42, turn: 0,
    snakes: snakes.map((snake, i) => ({
      id: `snake-${i + 1}`, name: `Bot ${i + 1}`, color: "#fff", score: 0,
      deaths: 0, applesEaten: 0, respawnAt: null, ...snake,
    })),
    apples, events: [],
  };
}

test("all four edges connect to their opposites", () => {
  const game = state([
    { body: [[0, 3], [1, 3], [2, 3]], direction: "LEFT" },
    { body: [[4, 0], [4, 1], [4, 2]], direction: "UP" },
  ], [[3, 5]]);
  const next = stepGame(game, { "snake-1": "LEFT", "snake-2": "UP" });
  assert.deepEqual(next.snakes[0].body[0], [6, 3]);
  assert.deepEqual(next.snakes[1].body[0], [4, 6]);
});

test("same-cell head collision kills both and leaves the apple", () => {
  const game = state([
    { body: [[1, 2], [0, 2]], direction: "RIGHT", score: 4 },
    { body: [[3, 2], [4, 2]], direction: "LEFT", score: 2 },
  ], [[2, 2]]);
  const next = stepGame(game, { "snake-1": "RIGHT", "snake-2": "LEFT" });
  assert.deepEqual(next.snakes.map((snake) => snake.body), [[], []]);
  assert.deepEqual(next.snakes.map((snake) => snake.score), [0, 0]);
  assert.deepEqual(next.apples, [[2, 2]]);
  assert.equal(next.events.filter((event) => event.reason === "head-to-head").length, 2);
});

test("head swap kills both even when both snakes have length one", () => {
  const game = state([
    { body: [[1, 2]], direction: "RIGHT" },
    { body: [[2, 2]], direction: "LEFT" },
  ], [[5, 5]]);
  const next = stepGame(game, { "snake-1": "RIGHT", "snake-2": "LEFT" });
  assert.equal(next.events.filter((event) => event.reason === "head-swap").length, 2);
});

test("entering a tail that moves away is safe", () => {
  const game = state([
    { body: [[2, 2], [1, 2], [0, 2]], direction: "RIGHT" },
    { body: [[0, 1], [0, 0], [0, 6]], direction: "DOWN" },
  ], [[5, 5]]);
  const next = stepGame(game, { "snake-1": "RIGHT", "snake-2": "DOWN" });
  assert.deepEqual(next.snakes[1].body[0], [0, 2]);
  assert.equal(next.snakes[1].deaths, 0);
});

test("tail remains solid when its snake eats an apple", () => {
  const game = state([
    { body: [[2, 2], [1, 2], [0, 2]], direction: "RIGHT" },
    { body: [[0, 1], [0, 0], [0, 6]], direction: "DOWN" },
  ], [[3, 2]]);
  const next = stepGame(game, { "snake-1": "RIGHT", "snake-2": "DOWN" });
  assert.equal(next.snakes[0].score, 1);
  assert.equal(next.snakes[0].body.length, 4);
  assert.equal(next.snakes[1].deaths, 1);
  assert.equal(next.snakes[1].body.length, 0);
});

test("dead snakes respawn after one skipped movement turn", () => {
  const game = state([
    { body: [[1, 2], [0, 2]], direction: "RIGHT", score: 3 },
    { body: [[3, 2], [4, 2]], direction: "LEFT" },
  ], [[5, 5]]);
  const crashed = stepGame(game, { "snake-1": "RIGHT", "snake-2": "LEFT" });
  assert.equal(crashed.turn, 1);
  assert.equal(crashed.snakes[0].body.length, 0);
  const respawned = stepGame(crashed);
  assert.equal(respawned.turn, 2);
  assert.equal(respawned.snakes[0].body.length, 3);
  assert.equal(respawned.snakes[0].score, 0);
  assert.equal(respawned.events.filter((event) => event.type === "respawn").length, 2);
});

test("game creation is deterministic and observations omit the random state", () => {
  const first = createGame({ seed: 123, names: ["A", "B"] });
  const second = createGame({ seed: 123, names: ["A", "B"] });
  assert.deepEqual(first, second);
  assert.equal(getObservation(first, "snake-1").rngState, undefined);
  assert.equal(first.apples.length, 5);
});

test("equal final scores produce a draw", () => {
  const game = createGame({ names: ["A", "B"] });
  assert.deepEqual(getWinners(game), ["snake-1", "snake-2"]);
});
