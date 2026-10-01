import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HumanMatch, loadRoster, ROOT, runMatch, runTournament } from "./runner.js";
import { evaluate, TRAIN_SEED_BASE } from "./evaluation.js";

const files = new Map([
  ["/", ["web/index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["web/app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["web/styles.css", "text/css; charset=utf-8"]],
]);
const replayDirectory = new URL("../replays/", import.meta.url);

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32000) throw new Error("Request is too large");
  }
  return body ? JSON.parse(body) : {};
}

function gameOptions(body) {
  const options = {};
  const limits = { seed: [0, 4294967295], width: [10, 40], height: [10, 40], appleCount: [1, 20], maxTurns: [10, 2000] };
  for (const [field, [low, high]] of Object.entries(limits)) {
    if (body[field] === undefined) continue;
    const value = Number(body[field]);
    if (!Number.isInteger(value) || value < low || value > high) {
      throw new Error(`${field} must be an integer from ${low} to ${high}`);
    }
    options[field] = value;
  }
  return options;
}

export function createServer() {
  let busy = false;
  let live = null;
  const duelJobs = new Map();
  function clearLive() {
    if (!live) return;
    clearTimeout(live.idleTimer);
    live.match.close();
    live = null;
  }
  function refreshLive(current) {
    clearTimeout(current.idleTimer);
    current.idleTimer = setTimeout(() => {
      if (live === current) clearLive();
    }, 30 * 60 * 1000);
    current.idleTimer.unref();
  }
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    try {
      if (request.method === "GET" && files.has(pathname)) {
        const [filename, type] = files.get(pathname);
        const content = await readFile(new URL(`../${filename}`, import.meta.url));
        response.writeHead(200, { "content-type": type });
        return response.end(content);
      }
      if (request.method === "GET" && pathname === "/api/roster") {
        return sendJson(response, 200, loadRoster().map(({ name }) => name));
      }
      if (request.method === "GET" && pathname === "/api/bots") {
        const directory = resolve(ROOT, "bots");
        const entries = await readdir(directory, { withFileTypes: true });
        const bots = entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".js") && !["common.js", "template.js"].includes(entry.name))
          .map((entry) => ({ path: `bots/${entry.name}`, label: entry.name.replace(/\.js$/i, "") }))
          .sort((a, b) => a.label.localeCompare(b.label));
        return sendJson(response, 200, bots);
      }
      if (request.method === "POST" && pathname === "/api/duel/start") {
        if (busy || live) return sendJson(response, 409, { error: "Another competition is already running" });
        const body = await readJson(request);
        const candidate = String(body.candidate ?? "");
        const opponent = String(body.opponent ?? "");
        if (!candidate || !opponent || candidate === opponent) {
          throw new Error("Choose two different bot files");
        }
        const seeds = Number(body.seeds ?? 100);
        const seedBase = Number(body.seedBase ?? TRAIN_SEED_BASE);
        const maxTurns = Number(body.maxTurns ?? 500);
        if (!Number.isInteger(seeds) || seeds < 1 || seeds > 100) throw new Error("seeds must be an integer from 1 to 100");
        if (!Number.isInteger(maxTurns) || maxTurns < 10 || maxTurns > 2000) throw new Error("maxTurns must be an integer from 10 to 2000");
        if (!Number.isInteger(seedBase) || seedBase < 0 || seedBase + seeds > 4294967295) throw new Error("Invalid seed base");
        for (const [id, previous] of duelJobs) {
          if (previous.status !== "running") duelJobs.delete(id);
        }
        const job = {
          id: randomUUID(), status: "running", candidate, opponent,
          seeds, seedBase, maxTurns, completedMatches: 0, totalMatches: seeds * 2,
          matches: [], summary: null, reportPath: null, error: null,
          createdAt: new Date().toISOString(),
        };
        duelJobs.set(job.id, job);
        busy = true;
        void evaluate({
          candidate,
          against: opponent,
          seeds,
          seedBase,
          maxTurns,
          suite: "train",
          label: body.label ?? candidate,
          saveLosses: 2,
          onMatch: (_tag, done, total, record) => {
            job.completedMatches = done;
            job.totalMatches = total;
            job.matches.push(record);
          },
        }).then(({ report, reportPath }) => {
          job.status = "complete";
          job.candidateLabel = report.candidate.label;
          job.opponentLabel = report.opponentName;
          job.summary = report.primary.summary;
          job.reportPath = reportPath;
        }).catch((error) => {
          job.status = "error";
          job.error = error.message;
        }).finally(() => {
          busy = false;
        });
        return sendJson(response, 202, { jobId: job.id, status: job.status });
      }
      if (request.method === "GET" && pathname.startsWith("/api/duel/")) {
        const id = pathname.slice("/api/duel/".length);
        if (!/^[0-9a-f-]{36}$/i.test(id)) return sendJson(response, 404, { error: "Unknown duel" });
        const job = duelJobs.get(id);
        if (!job) return sendJson(response, 404, { error: "Duel result expired" });
        return sendJson(response, 200, {
          jobId: job.id, status: job.status, candidate: job.candidate, opponent: job.opponent,
          candidateLabel: job.candidateLabel ?? job.candidate, opponentLabel: job.opponentLabel ?? job.opponent,
          seeds: job.seeds, seedBase: job.seedBase, maxTurns: job.maxTurns,
          completedMatches: job.completedMatches, totalMatches: job.totalMatches,
          matches: job.matches, summary: job.summary, reportPath: job.reportPath, error: job.error,
        });
      }
      if (request.method === "GET" && pathname === "/api/replays") {
        const names = (await readdir(replayDirectory)).filter((name) => /^match-[\w-]+\.json$/.test(name)).sort().reverse();
        return sendJson(response, 200, names.slice(0, 30));
      }
      if (request.method === "GET" && pathname.startsWith("/api/replay/")) {
        const name = pathname.slice("/api/replay/".length);
        if (!/^match-[\w-]+\.json$/.test(name)) throw new Error("Invalid replay name");
        const content = await readFile(new URL(`../replays/${name}`, import.meta.url), "utf8");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        return response.end(content);
      }
      if (request.method === "POST" && pathname === "/api/live/start") {
        if (busy) return sendJson(response, 409, { error: "A competition is already running" });
        const options = gameOptions(await readJson(request));
        clearLive();
        const current = { id: randomUUID(), match: new HumanMatch(options) };
        live = current;
        refreshLive(current);
        return sendJson(response, 200, { sessionId: current.id, match: current.match.snapshot() });
      }
      if (request.method === "POST" && pathname === "/api/live/step") {
        const body = await readJson(request);
        const current = live;
        if (!current || body.sessionId !== current.id) {
          return sendJson(response, 409, { error: "Human match is no longer active" });
        }
        const result = await current.match.step(body.direction);
        if (current !== live) return sendJson(response, 409, { error: "Human match was replaced" });
        refreshLive(current);
        if (result.finished) {
          const name = `match-human-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 7)}.json`;
          const match = current.match.result();
          clearLive();
          await writeFile(new URL(`../replays/${name}`, import.meta.url), JSON.stringify(match), "utf8");
          return sendJson(response, 200, { ...result, replayName: name });
        }
        return sendJson(response, 200, result);
      }
      if (request.method === "POST" && pathname === "/api/live/stop") {
        const body = await readJson(request);
        if (live && body.sessionId === live.id) {
          clearLive();
        }
        return sendJson(response, 200, { stopped: true });
      }
      if (request.method === "POST" && (pathname === "/api/match" || pathname === "/api/tournament")) {
        if (busy || live) return sendJson(response, 409, { error: "A competition is already running" });
        busy = true;
        try {
          const body = await readJson(request);
          const options = gameOptions(body);
          if (pathname === "/api/match") {
            const match = await runMatch(options);
            const name = `match-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 7)}.json`;
            await writeFile(new URL(`../replays/${name}`, import.meta.url), JSON.stringify(match), "utf8");
            return sendJson(response, 200, { ...match, replayName: name });
          }
          const games = Number(body.games ?? 8);
          if (!Number.isInteger(games) || games < 1 || games > 40) throw new Error("games must be 1–40");
          const tournament = await runTournament({ ...options, games });
          const name = `tournament-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
          await writeFile(new URL(`../replays/${name}`, import.meta.url), JSON.stringify(tournament, null, 2), "utf8");
          return sendJson(response, 200, { ...tournament, fileName: name });
        } finally {
          busy = false;
        }
      }
      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      console.error(error);
      return sendJson(response, 400, { error: error.message });
    }
  });
  server.on("close", clearLive);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`Snake Arena: http://127.0.0.1:${port}`);
    console.log(`Project: ${ROOT}`);
  });
}
