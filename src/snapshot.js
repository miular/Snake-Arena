import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ROOT } from "./runner.js";

const botsRoot = resolve(ROOT, "bots");
const snapshotsRoot = resolve(ROOT, "evaluations", "snapshots");

function inside(base, target) {
  const path = relative(base, target);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function projectPath(path) {
  return relative(ROOT, path).split(sep).join("/");
}

export function resolveBot(ref) {
  const full = resolve(ROOT, ref);
  if (!inside(botsRoot, full) || extname(full) !== ".js") {
    throw new Error(`Bot must be a .js file inside ${botsRoot}: ${ref}`);
  }
  return full;
}

async function collectFiles(entry) {
  const files = new Map();
  async function visit(path) {
    if (!inside(botsRoot, path)) throw new Error(`Import escapes bots/: ${path}`);
    if (files.has(path)) return;
    const info = await stat(path);
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error(`Bot file must be under 1 MB: ${path}`);
    const bytes = await readFile(path);
    files.set(path, bytes);
    const source = bytes.toString("utf8");
    // Capture literal relative JS imports; contestants are asked to avoid computed imports.
    for (const match of source.matchAll(/["'](\.{1,2}\/[^"'`]+\.js)["']/g)) {
      await visit(resolve(dirname(path), match[1]));
    }
  }
  await visit(entry);
  return files;
}

function digest(files) {
  const hash = createHash("sha256");
  for (const [path, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(relative(botsRoot, path).split(sep).join("/"));
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function snapshotBot(ref) {
  const source = resolveBot(ref);
  const files = await collectFiles(source);
  const hash = digest(files);
  const directory = join(snapshotsRoot, hash);
  const savedFiles = [];
  for (const [path, bytes] of files) {
    const target = join(directory, "bots", relative(botsRoot, path));
    await mkdir(dirname(target), { recursive: true });
    try {
      await writeFile(target, bytes, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await readFile(target);
      if (!existing.equals(bytes)) throw new Error(`Snapshot was modified: ${target}`);
    }
    savedFiles.push({ path: projectPath(target), sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return {
    source: projectPath(source),
    hash,
    entry: projectPath(join(directory, "bots", relative(botsRoot, source))),
    files: savedFiles.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export async function verifySnapshot(snapshot) {
  for (const file of snapshot.files) {
    const target = resolve(ROOT, file.path);
    if (!inside(snapshotsRoot, target)) throw new Error(`Invalid snapshot path: ${file.path}`);
    const bytes = await readFile(target);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== file.sha256) throw new Error(`Snapshot changed during evaluation: ${file.path}`);
  }
}
