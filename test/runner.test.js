import test from "node:test";
import assert from "node:assert/strict";
import { loadRoster, runMatch, runTournament } from "../src/runner.js";

test("contestant processes complete a match with reproducible frames", async () => {
  const roster = loadRoster().slice(0, 2);
  const first = await runMatch({ roster, seed: 73, maxTurns: 16 });
  const second = await runMatch({ roster, seed: 73, maxTurns: 16 });
  assert.equal(first.frames.length, 17);
  assert.deepEqual(first.frames, second.frames);
  assert.equal(first.frames.flatMap((frame) => frame.events).filter((event) => event.type === "bot-error").length, 0);
});

test("tournament rotates contestants and reports all matches", async () => {
  const roster = loadRoster().slice(0, 2);
  const result = await runTournament({ roster, games: 2, seed: 91, maxTurns: 12 });
  assert.equal(result.results.length, 2);
  assert.equal(result.standings.length, 2);
  assert.deepEqual(result.results.map((row) => row.seed), [91, 92]);
});
