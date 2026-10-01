import test from "node:test";
import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { HumanMatch, loadRoster } from "../src/runner.js";
import { createServer } from "../src/server.js";

test("a human joins the AI roster and shares the normal turn rules", async () => {
  const game = new HumanMatch({ roster: loadRoster().slice(0, 2), seed: 81, maxTurns: 3 });
  try {
    const initial = game.snapshot();
    assert.equal(initial.roster.length, 3);
    assert.equal(initial.frames[0].snakes.length, 3);
    assert.equal(initial.roster.at(-1).id, initial.humanId);
    await assert.rejects(game.step("DIAGONAL"), /direction must be/);
    for (let turn = 1; turn <= 3; turn++) {
      const { frame, finished } = await game.step();
      assert.equal(frame.turn, turn);
      assert.equal(finished, turn === 3);
      assert.equal(frame.events.filter((event) => event.type === "bot-error").length, 0);
    }
    assert.equal(game.result().frames.length, 4);
    await assert.rejects(game.step("UP"), /closed/);
  } finally {
    game.close();
  }
});

test("live HTTP turns can stop or finish without changing spectator matches", async () => {
  const server = createServer();
  const createdReplays = [];
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body) => {
    const response = await fetch(`${root}${route}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  };
  try {
    const first = await post("/api/live/start", { seed: 100, maxTurns: 10 });
    assert.equal(first.status, 200);
    assert.equal(first.value.match.frames.length, 1);
    assert.equal(first.value.match.roster.length, loadRoster().length + 1);
    const refused = await post("/api/match", { seed: 100, maxTurns: 10 });
    assert.equal(refused.status, 409);
    const step = await post("/api/live/step", { sessionId: first.value.sessionId, direction: "UP" });
    assert.equal(step.status, 200);
    assert.equal(step.value.frame.turn, 1);
    assert.equal((await post("/api/live/stop", { sessionId: first.value.sessionId })).status, 200);
    assert.equal((await post("/api/live/step", { sessionId: first.value.sessionId })).status, 409);

    const spectator = await post("/api/match", { seed: 100, maxTurns: 10 });
    assert.equal(spectator.status, 200);
    assert.equal(spectator.value.frames.length, 11);
    assert.equal(spectator.value.roster.length, loadRoster().length);
    createdReplays.push(spectator.value.replayName);

    const second = await post("/api/live/start", { seed: 101, maxTurns: 10 });
    let last;
    for (let turn = 1; turn <= 10; turn++) {
      last = await post("/api/live/step", { sessionId: second.value.sessionId });
      assert.equal(last.status, 200);
      assert.equal(last.value.frame.turn, turn);
    }
    assert.equal(last.value.finished, true);
    assert.match(last.value.replayName, /^match-human-[\w-]+\.json$/);
    createdReplays.push(last.value.replayName);
    const replay = await fetch(`${root}/api/replay/${last.value.replayName}`);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).frames.length, 11);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await Promise.all(createdReplays.map((name) => unlink(new URL(`../replays/${name}`, import.meta.url))));
  }
});
