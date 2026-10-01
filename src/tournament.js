import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runTournament } from "./runner.js";

export async function main(argv = process.argv.slice(2)) {
  const games = Number(argv[0] ?? 8);
  const seed = Number(argv[1] ?? 20260928);
  const result = await runTournament({ games, seed, onGame: (done, total) => {
    process.stderr.write(`\r已完成 ${done}/${total} 场`);
  } });
  process.stderr.write("\n");
  console.table(result.standings);
  const name = `tournament-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const path = new URL(`../replays/${name}`, import.meta.url);
  await writeFile(path, JSON.stringify(result, null, 2), "utf8");
  console.log(`结果已保存：${fileURLToPath(path)}`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
