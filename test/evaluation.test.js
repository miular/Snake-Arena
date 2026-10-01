import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluate, promotionDecision } from "../src/evaluation.js";
import { parseArgs } from "../src/evaluate.js";
import { snapshotBot, verifySnapshot } from "../src/snapshot.js";

test("a snapshot includes a bot's local imports and remains verifiable", async () => {
  const snapshot = await snapshotBot("bots/balanced.js");
  assert.equal(snapshot.files.length, 2);
  assert.ok(snapshot.files.some((file) => file.path.endsWith("/bots/common.js")));
  await verifySnapshot(snapshot);
});

test("paired evaluation repeats each seed with the contestant in both slots", async () => {
  const { report, reportPath } = await evaluate({
    candidate: "bots/greedy.js", against: "baseline", seeds: 2,
    seedBase: 1234, maxTurns: 4, saveLosses: 0,
  });
  assert.equal(report.primary.summary.matches, 4);
  assert.deepEqual(report.primary.matches.map((match) => [match.seed, match.candidateSlot]), [
    [1234, 1], [1234, 2], [1235, 1], [1235, 2],
  ]);
  assert.equal(report.primary.matches.reduce((total, match) => total + match.candidateErrors + match.opponentErrors, 0), 0);
  const saved = JSON.parse(await readFile(new URL(`../${reportPath}`, import.meta.url), "utf8"));
  assert.equal(saved.id, report.id);
});

test("promotion requires win rate, score lead, error-free matches and a changed bot", () => {
  const good = { summary: {
    matches: 10, wins: 7, averageCandidateScore: 4,
    averageOpponentScore: 2, candidateErrors: 0, opponentErrors: 0,
  } };
  assert.equal(promotionDecision(good, null, false).passed, true);
  assert.equal(promotionDecision(good, good, true).passed, true);
  assert.equal(promotionDecision(good, null, false, true).passed, false);
  const challenger = { summary: { ...good.summary, wins: 6 } };
  assert.equal(promotionDecision(challenger, good, true).passed, true);
  assert.equal(promotionDecision(challenger, challenger, true).passed, false);
  const bad = { summary: { ...good.summary, wins: 5, candidateErrors: 1 } };
  assert.equal(promotionDecision(bad, null, false).passed, false);
});

test("CLI parses iteration options and rejects invalid replay counts", () => {
  assert.deepEqual(parseArgs(["--candidate", "bots/x.js", "--against", "v001", "--seeds", "40", "--promote"]), {
    candidate: "bots/x.js", against: "v001", seeds: 40, promote: true,
  });
  assert.throws(() => parseArgs(["--save-losses", "11"]), /0–10/);
});
