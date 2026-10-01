import { randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { ROOT, runMatch } from "./runner.js";
import { snapshotBot, verifySnapshot } from "./snapshot.js";

export const TRAIN_SEED_BASE = 20270000;
const evalRoot = resolve(ROOT, "evaluations");
const replayRoot = resolve(ROOT, "replays");
const manifestPath = join(evalRoot, "champion.json");
const baselineRef = "bots/balanced.js";

const projectPath = (path) => relative(ROOT, path).split(sep).join("/");
const rounded = (number) => +number.toFixed(3);

export async function readChampion() {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    return manifest;
  } catch (error) {
    if (error.code === "ENOENT") return { current: null, history: [] };
    throw error;
  }
}

async function saveChampion(manifest) {
  await mkdir(evalRoot, { recursive: true });
  const temp = join(evalRoot, `.champion-${randomUUID()}.json`);
  await writeFile(temp, JSON.stringify(manifest, null, 2), "utf8");
  await rename(temp, manifestPath);
}

export function promotionDecision(primary, baseline, hasChampion, sameCode = false) {
  const reasons = [];
  const first = primary.summary;
  const required = hasChampion ? 0.6 : 0.7;
  if (sameCode) reasons.push("候选代码与当前对手相同");
  if (first.wins / first.matches < required) reasons.push(`对当前对手的独胜率低于 ${Math.round(required * 100)}%`);
  if (first.averageCandidateScore <= first.averageOpponentScore) reasons.push("对当前对手的平均最终分没有领先");
  if (first.candidateErrors || first.opponentErrors) reasons.push("与当前对手的比赛出现程序错误");
  if (baseline) {
    const second = baseline.summary;
    if (second.wins / second.matches < 0.7) reasons.push("对均衡选手的独胜率低于 70%");
    if (second.averageCandidateScore <= second.averageOpponentScore) reasons.push("对均衡选手的平均最终分没有领先");
    if (second.candidateErrors || second.opponentErrors) reasons.push("与均衡选手的比赛出现程序错误");
  }
  return { passed: reasons.length === 0, reasons };
}

async function compare(candidate, opponent, options) {
  const matches = [];
  let savedLosses = 0;
  for (let index = 0; index < options.seeds; index++) {
    const seed = options.seedBase + index;
    for (let candidateSlot = 0; candidateSlot < 2; candidateSlot++) {
      const lineup = candidateSlot === 0 ? [candidate, opponent] : [opponent, candidate];
      const roster = lineup.map((bot, slot) => ({
        name: slot === candidateSlot ? "Candidate" : "Opponent",
        command: "node",
        args: [bot.entry],
      }));
      const match = await runMatch({ roster, seed, maxTurns: options.maxTurns });
      const final = match.frames.at(-1);
      const candidateSnake = final.snakes[candidateSlot];
      const opponentSnake = final.snakes[1 - candidateSlot];
      const winner = match.winnerIds.length === 2 ? "draw" :
        match.winnerIds.includes(candidateSnake.id) ? "candidate" : "opponent";
      const errors = match.frames.flatMap((frame) => frame.events.filter((event) => event.type === "bot-error"));
      const record = {
        seed,
        candidateSlot: candidateSlot + 1,
        winner,
        candidateScore: candidateSnake.score,
        opponentScore: opponentSnake.score,
        candidateDeaths: candidateSnake.deaths,
        opponentDeaths: opponentSnake.deaths,
        candidateApples: candidateSnake.applesEaten,
        opponentApples: opponentSnake.applesEaten,
        candidateErrors: errors.filter((event) => event.snake === candidateSnake.id).length,
        opponentErrors: errors.filter((event) => event.snake === opponentSnake.id).length,
        durationMs: match.durationMs,
      };
      if (winner === "opponent" && savedLosses < options.saveLosses) {
        const path = join(replayRoot, `match-${options.reportId}-${options.tag}-seed${seed}-slot${candidateSlot + 1}.json`);
        await mkdir(replayRoot, { recursive: true });
        await writeFile(path, JSON.stringify(match), "utf8");
        record.replay = projectPath(path);
        savedLosses++;
      }
      matches.push(record);
      if (options.onMatch) options.onMatch(options.tag, matches.length, options.seeds * 2, record);
    }
  }
  const count = matches.length;
  const sum = (field) => matches.reduce((total, item) => total + item[field], 0);
  const wins = matches.filter((item) => item.winner === "candidate").length;
  const losses = matches.filter((item) => item.winner === "opponent").length;
  return {
    opponent: { hash: opponent.hash, source: opponent.source, entry: opponent.entry },
    summary: {
      matches: count,
      wins,
      losses,
      draws: count - wins - losses,
      exclusiveWinRate: rounded(wins / count),
      averageCandidateScore: rounded(sum("candidateScore") / count),
      averageOpponentScore: rounded(sum("opponentScore") / count),
      averageCandidateDeaths: rounded(sum("candidateDeaths") / count),
      averageOpponentDeaths: rounded(sum("opponentDeaths") / count),
      averageCandidateApples: rounded(sum("candidateApples") / count),
      averageOpponentApples: rounded(sum("opponentApples") / count),
      candidateErrors: sum("candidateErrors"),
      opponentErrors: sum("opponentErrors"),
    },
    matches,
  };
}

export async function evaluate(options) {
  if (!options.candidate) throw new Error("--candidate is required");
  const promote = Boolean(options.promote);
  if (promote && options.against) throw new Error("--promote always compares against the current champion");
  if (promote && options.seedBase !== undefined) throw new Error("--promote uses an unpredictable fresh seed base");
  const seeds = options.seeds ?? (promote ? 40 : 10);
  const maxTurns = options.maxTurns ?? 500;
  if (!Number.isInteger(seeds) || seeds < 1 || seeds > 100) throw new Error("--seeds must be 1–100");
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 2000) throw new Error("--turns must be 1–2000");
  if (promote && (seeds < 40 || maxTurns !== 500)) {
    throw new Error("--promote requires at least 40 seeds and the full 500 turns");
  }
  if (options.suite !== undefined && !new Set(["train", "fresh"]).has(options.suite)) {
    throw new Error("--suite must be train or fresh");
  }
  const suite = promote ? "fresh-promotion" : (options.suite ?? "train");
  const seedBase = options.seedBase ?? (suite === "train" ? TRAIN_SEED_BASE : randomInt(100000000, 4000000000 - seeds));
  if (!Number.isInteger(seedBase) || seedBase < 0 || seedBase + seeds > 4294967295) {
    throw new Error("Invalid seed base");
  }
  const candidate = await snapshotBot(options.candidate);
  const baseline = await snapshotBot(baselineRef);
  const manifest = await readChampion();
  const hasChampion = Boolean(manifest.current);
  let opponent;
  let opponentName;
  if (promote || !options.against || options.against === "champion") {
    opponent = hasChampion ? manifest.current.snapshot : baseline;
    opponentName = hasChampion ? `${manifest.current.version} ${manifest.current.label}` : "均衡选手";
  } else if (options.against === "baseline") {
    opponent = baseline;
    opponentName = "均衡选手";
  } else if (/^v\d{3,}$/.test(options.against)) {
    const historical = manifest.history.find((entry) => entry.version === options.against);
    if (!historical) throw new Error(`Champion version does not exist: ${options.against}`);
    opponent = historical.snapshot;
    opponentName = `${historical.version} ${historical.label}`;
  } else {
    opponent = await snapshotBot(options.against);
    opponentName = options.against;
  }
  await verifySnapshot(candidate);
  await verifySnapshot(opponent);
  const reportId = `eval-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const compareOptions = {
    seeds, seedBase, maxTurns, reportId, saveLosses: options.saveLosses ?? 2, onMatch: options.onMatch,
  };
  const primary = await compare(candidate, opponent, { ...compareOptions, tag: "primary" });
  const baselineComparison = promote && hasChampion ?
    await compare(candidate, baseline, { ...compareOptions, tag: "baseline" }) : null;
  await verifySnapshot(candidate);
  await verifySnapshot(opponent);
  if (baselineComparison) await verifySnapshot(baseline);
  const decision = promote ? promotionDecision(primary, baselineComparison, hasChampion, candidate.hash === opponent.hash) : null;
  const report = {
    id: reportId,
    createdAt: new Date().toISOString(),
    suite,
    seedBase,
    seeds,
    maxTurns,
    candidate: { label: options.label ?? options.candidate, ...candidate },
    opponentName,
    primary,
    baseline: baselineComparison,
    promotion: decision ? { ...decision, promoted: false } : null,
  };
  const reportPath = join(evalRoot, "reports", `${reportId}.json`);
  await mkdir(join(evalRoot, "reports"), { recursive: true });
  if (decision?.passed) {
    const version = `v${String(manifest.history.length + 1).padStart(3, "0")}`;
    const current = {
      version,
      label: options.label ?? options.candidate,
      snapshot: candidate,
      report: projectPath(reportPath),
      promotedAt: new Date().toISOString(),
    };
    report.promotion = { ...decision, promoted: true, version };
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    await saveChampion({ current, history: [...manifest.history, current] });
  } else {
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  }
  return { report, reportPath: projectPath(reportPath) };
}
