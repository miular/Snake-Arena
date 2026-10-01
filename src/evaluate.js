import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { evaluate } from "./evaluation.js";

const HELP = `Snake Arena candidate evaluation

Usage:
  node src/evaluate.js --candidate bots/my_bot.js [options]

Options:
  --against baseline|champion|v001|bots/other.js  Opponent; default: champion, then baseline
  --seeds N          Number of paired map seeds; default: 10 (40 for promotion)
  --suite train|fresh   Fixed training seeds or new random seeds; default: train
  --seed-base N      Explicit first seed for a reproducible non-promotion run
  --turns N          Turns per match; default: 500
  --label NAME       Model or version label stored in the report
  --save-losses N    Full loss replays to save; default: 2
  --promote          Challenge current champion and baseline; promote only if gates pass
  --help             Show this text

Each seed runs twice with contestant positions exchanged. Promotion always
uses fresh seeds, at least 40 seed pairs, and 500 turns per match.
`;

export function parseArgs(argv) {
  const options = {};
  const numbers = new Map([
    ["--seeds", "seeds"], ["--seed-base", "seedBase"], ["--turns", "maxTurns"],
    ["--save-losses", "saveLosses"],
  ]);
  const strings = new Map([
    ["--candidate", "candidate"], ["--against", "against"],
    ["--suite", "suite"], ["--label", "label"],
  ]);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--help") { options.help = true; continue; }
    if (flag === "--promote") { options.promote = true; continue; }
    const field = numbers.get(flag) ?? strings.get(flag);
    if (!field || i + 1 >= argv.length) throw new Error(`Unknown or incomplete option: ${flag}`);
    const value = argv[++i];
    options[field] = numbers.has(flag) ? Number(value) : value;
  }
  if (options.saveLosses !== undefined && (!Number.isInteger(options.saveLosses) || options.saveLosses < 0 || options.saveLosses > 10)) {
    throw new Error("--save-losses must be 0–10");
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return console.log(HELP);
  const { report, reportPath } = await evaluate({ ...options, onMatch: (tag, done, total) => {
    process.stderr.write(`\r${tag}: ${done}/${total} games`);
    if (done === total) process.stderr.write("\n");
  } });
  console.log(JSON.stringify({
    candidate: report.candidate.label,
    opponent: report.opponentName,
    suite: report.suite,
    seedBase: report.seedBase,
    primary: report.primary.summary,
    baseline: report.baseline?.summary ?? null,
    promotion: report.promotion,
    report: reportPath,
  }, null, 2));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
