const $ = (selector) => document.querySelector(selector);
const canvas = $("#board");
const context = canvas.getContext("2d");
let match = null;
let cursor = 0;
let playing = false;
let timer = null;
let busy = false;
let liveSessionId = null;
let liveTimer = null;
let livePaused = false;
let liveInFlightSession = null;
let liveGeneration = 0;
let requestedDirection = null;
let duelJobId = null;
let duelPollTimer = null;

function safe(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function setStatus(text) {
  $("#status").textContent = text;
}

function setBusy(value) {
  busy = value;
  document.body.classList.toggle("busy", value);
  $("#newMatch").disabled = value;
  $("#participation").disabled = value;
  updateLiveControls();
}

function updateLiveControls() {
  const active = Boolean(liveSessionId);
  document.body.classList.toggle("live-mode", active);
  $("#livePanel").classList.toggle("hidden", !active);
  $("#runTournament").disabled = busy || active;
  $("#runDuel").disabled = busy || active;
  $("#livePause").textContent = livePaused ? "继续" : "暂停";
  for (const button of document.querySelectorAll("[data-direction]")) {
    button.classList.toggle("active", button.dataset.direction === requestedDirection && active);
  }
}

function stopPlayback() {
  playing = false;
  clearTimeout(timer);
  $("#play").textContent = "▶ 播放";
}

function schedulePlayback() {
  clearTimeout(timer);
  if (!playing || !match) return;
  timer = setTimeout(() => {
    if (cursor >= match.frames.length - 1) return stopPlayback();
    cursor++;
    render();
    schedulePlayback();
  }, 1000 / Number($("#speed").value));
}

function togglePlayback() {
  if (!match || liveSessionId) return;
  if (playing) return stopPlayback();
  if (cursor >= match.frames.length - 1) cursor = 0;
  playing = true;
  $("#play").textContent = "Ⅱ 暂停";
  render();
  schedulePlayback();
}

function moveCursor(delta) {
  if (!match || liveSessionId) return;
  stopPlayback();
  cursor = Math.max(0, Math.min(match.frames.length - 1, cursor + delta));
  render();
}

function drawBoard(frame) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixels = Math.round(rect.width * ratio);
  if (canvas.width !== pixels || canvas.height !== pixels) {
    canvas.width = pixels;
    canvas.height = pixels;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const size = rect.width;
  context.clearRect(0, 0, size, size);
  const cellW = size / frame.width;
  const cellH = size / frame.height;
  context.fillStyle = "#10231c";
  context.fillRect(0, 0, size, size);
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      if ((x + y) % 2) context.fillStyle = "#13281f";
      else context.fillStyle = "#142b21";
      context.fillRect(x * cellW, y * cellH, cellW, cellH);
    }
  }
  context.strokeStyle = "#29443355";
  context.lineWidth = 1;
  for (let x = 1; x < frame.width; x++) {
    context.beginPath(); context.moveTo(x * cellW, 0); context.lineTo(x * cellW, size); context.stroke();
  }
  for (let y = 1; y < frame.height; y++) {
    context.beginPath(); context.moveTo(0, y * cellH); context.lineTo(size, y * cellH); context.stroke();
  }
  for (const [x, y] of frame.apples) {
    const cx = (x + 0.5) * cellW;
    const cy = (y + 0.5) * cellH;
    context.save();
    context.shadowColor = "#ff9e70";
    context.shadowBlur = cellW * 0.65;
    context.fillStyle = "#ff9272";
    context.beginPath();
    context.arc(cx, cy, cellW * 0.29, 0, Math.PI * 2);
    context.fill();
    context.restore();
    context.fillStyle = "#ffd3a5";
    context.beginPath();
    context.arc(cx - cellW * 0.08, cy - cellH * 0.09, cellW * 0.06, 0, Math.PI * 2);
    context.fill();
  }
  for (const snake of frame.snakes) {
    for (let i = snake.body.length - 1; i >= 0; i--) {
      const [x, y] = snake.body[i];
      const pad = i === 0 ? cellW * 0.07 : cellW * 0.12;
      context.globalAlpha = i === 0 ? 1 : Math.max(0.48, 0.9 - i * 0.016);
      context.fillStyle = snake.color;
      context.beginPath();
      context.roundRect(x * cellW + pad, y * cellH + pad, cellW - 2 * pad, cellH - 2 * pad, cellW * 0.24);
      context.fill();
      if (i === 0 && snake.id === match.humanId) {
        context.strokeStyle = "#f5fff2";
        context.lineWidth = Math.max(2, cellW * 0.08);
        context.stroke();
      }
    }
    context.globalAlpha = 1;
    if (!snake.body.length) continue;
    const [hx, hy] = snake.body[0];
    const eyes = {
      UP: [[0.31, 0.34], [0.69, 0.34]],
      DOWN: [[0.31, 0.66], [0.69, 0.66]],
      LEFT: [[0.34, 0.31], [0.34, 0.69]],
      RIGHT: [[0.66, 0.31], [0.66, 0.69]],
    }[snake.direction];
    context.fillStyle = "#14211c";
    for (const [ex, ey] of eyes) {
      context.beginPath();
      context.arc((hx + ex) * cellW, (hy + ey) * cellH, cellW * 0.045, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function describeEvent(event, frame) {
  const snake = frame.snakes.find((item) => item.id === event.snake);
  const name = snake?.name ?? event.snake;
  if (event.type === "apple") return `${name} 吃到苹果，积分 +1`;
  if (event.type === "respawn") return `${name} 已重生，重新加入比赛`;
  if (event.type === "death") {
    const reason = { "head-to-head": "蛇头相撞", "head-swap": "交换位置相撞", self: "撞到自己", body: "撞到蛇身" }[event.reason] ?? event.reason;
    return `${name} ${reason}，积分清零`;
  }
  if (event.type === "bot-error") return `${name} 程序错误：${event.detail}`;
  if (event.type === "invalid") return `${name} 提交了无效方向，保持原方向`;
  return `${name} ${event.type}`;
}

function render() {
  if (!match) return;
  const frame = match.frames[cursor];
  $("#boardEmpty").classList.add("hidden");
  drawBoard(frame);
  $("#boardMeta").textContent = `${frame.width} × ${frame.height}`;
  $("#summaryTurn").textContent = `${frame.turn} / ${frame.maxTurns}`;
  $("#summaryApples").textContent = String(frame.apples.length);
  const best = Math.max(...frame.snakes.map((snake) => snake.score));
  const leaders = frame.snakes.filter((snake) => snake.score === best);
  $("#summaryLeader").textContent = leaders.length === 1 ? leaders[0].name : "并列领先";
  $("#status").textContent = frame.turn === frame.maxTurns ? "比赛结束" :
    liveSessionId ? (livePaused ? "手动比赛已暂停" : "你正在参赛") : playing ? "回放中" : "已暂停";
  $("#turnLabel").textContent = `回合 ${frame.turn} / ${frame.maxTurns}`;
  $("#winnerLabel").textContent = frame.turn === frame.maxTurns ?
    `胜者：${leaders.map((snake) => snake.name).join("、")}` : `地图种子 ${match.config.seed}`;
  $("#timeline").max = String(match.frames.length - 1);
  $("#timeline").value = String(cursor);

  const rows = [...frame.snakes].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  $("#scoreboard").innerHTML = rows.map((snake) => `<div class="score-row ${snake.score === best ? "is-leading" : ""} ${snake.body.length ? "" : "is-dead"} ${snake.id === match.humanId ? "is-human" : ""}">
    <span class="score-dot" style="background:${snake.color}"></span>
    <div><div class="score-name">${safe(snake.name)}</div><div class="score-details">体长 ${snake.body.length} · 死亡 ${snake.deaths}${snake.body.length ? "" : " · 重生中"}</div></div>
    <span class="score-number">${snake.score}</span></div>`).join("");

  const events = [];
  for (let i = cursor; i >= Math.max(1, cursor - 10) && events.length < 6; i--) {
    for (const event of match.frames[i].events.toReversed()) {
      if (events.length >= 6) break;
      events.push({ turn: i, text: describeEvent(event, match.frames[i]) });
    }
  }
  $("#events").innerHTML = events.length ? events.map((entry) =>
    `<div class="event-row"><span class="event-turn">${entry.turn}</span><span class="event-text">${safe(entry.text)}</span></div>`).join("") :
    '<p class="muted">当前回合附近没有特殊事件。</p>';
}

async function requestJson(path, body) {
  const response = await fetch(path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
}

function renderDuelResults(data) {
  const matches = data.matches ?? [];
  const counts = { candidate: 0, opponent: 0, draw: 0 };
  for (const item of matches) counts[item.winner]++;
  const average = (field) => matches.length ?
    (matches.reduce((sum, item) => sum + item[field], 0) / matches.length).toFixed(2) : "—";
  const summary = data.summary ?? {
    matches: matches.length,
    wins: counts.candidate,
    losses: counts.opponent,
    draws: counts.draw,
    exclusiveWinRate: matches.length ? counts.candidate / matches.length : 0,
    averageCandidateScore: Number(average("candidateScore")) || 0,
    averageOpponentScore: Number(average("opponentScore")) || 0,
    averageCandidateDeaths: Number(average("candidateDeaths")) || 0,
    averageOpponentDeaths: Number(average("opponentDeaths")) || 0,
    averageCandidateApples: Number(average("candidateApples")) || 0,
    averageOpponentApples: Number(average("opponentApples")) || 0,
    candidateErrors: matches.reduce((sum, item) => sum + item.candidateErrors, 0),
    opponentErrors: matches.reduce((sum, item) => sum + item.opponentErrors, 0),
  };
  const candidateLabel = safe(data.candidateLabel ?? data.candidate ?? "选手 A");
  const opponentLabel = safe(data.opponentLabel ?? data.opponent ?? "选手 B");
  const summaryCards = [
    ["完成局数", `${matches.length} / ${data.totalMatches}`],
    ["A 胜 / B 胜 / 平", `${counts.candidate} / ${counts.opponent} / ${counts.draw}`],
    ["A 独胜率", `${(summary.exclusiveWinRate * 100).toFixed(1)}%`],
    ["平均最终分", `${summary.averageCandidateScore} : ${summary.averageOpponentScore}`],
    ["平均死亡", `${summary.averageCandidateDeaths} : ${summary.averageOpponentDeaths}`],
    ["平均吃苹果", `${summary.averageCandidateApples} : ${summary.averageOpponentApples}`],
    ["程序错误", `${summary.candidateErrors} : ${summary.opponentErrors}`],
  ];
  $("#duelSummary").classList.toggle("hidden", matches.length === 0);
  $("#duelSummary").innerHTML = summaryCards.map(([label, value]) =>
    `<div class="duel-stat"><span>${safe(label)}</span><strong>${safe(value)}</strong></div>`).join("");
  if (!matches.length) {
    $("#duelMatches").innerHTML = '<p class="muted">比赛开始后，逐局成绩会显示在这里。</p>';
    return;
  }
  const holder = $("#duelMatches");
  const previousScroller = holder.querySelector(".duel-table-scroll");
  const previousTop = previousScroller?.scrollTop ?? 0;
  const followedBottom = previousScroller && previousScroller.scrollHeight - previousScroller.clientHeight - previousTop < 24;
  holder.innerHTML = `<div class="duel-table-scroll"><table><thead><tr>
    <th>#</th><th>种子</th><th>出发位</th><th>胜者</th><th>${candidateLabel} 分</th><th>${opponentLabel} 分</th>
    <th>死亡 A:B</th><th>苹果 A:B</th><th>错误 A:B</th><th>耗时</th><th>回放</th>
    </tr></thead><tbody>${matches.map((item, index) => {
      const winner = item.winner === "draw" ? "平局" : item.winner === "candidate" ? candidateLabel : opponentLabel;
      return `<tr><td>${index + 1}</td><td>${item.seed}</td><td>${item.candidateSlot === 1 ? "A 先位" : "B 先位"}</td>
        <td>${winner}</td><td>${item.candidateScore}</td><td>${item.opponentScore}</td>
        <td>${item.candidateDeaths}:${item.opponentDeaths}</td><td>${item.candidateApples}:${item.opponentApples}</td>
        <td>${item.candidateErrors}:${item.opponentErrors}</td><td>${item.durationMs} ms</td>
        <td>${item.replay ? `<button class="replay-link" data-replay="${safe(item.replay.split("/").at(-1))}">查看</button>` : "—"}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  const currentScroller = holder.querySelector(".duel-table-scroll");
  currentScroller.scrollTop = followedBottom ? currentScroller.scrollHeight : previousTop;
  for (const button of document.querySelectorAll("[data-replay]")) {
    button.addEventListener("click", async () => {
      const replay = await fetch(`/api/replay/${encodeURIComponent(button.dataset.replay)}`);
      if (!replay.ok) return setStatus("无法读取这局回放");
      stopPlayback();
      match = await replay.json();
      cursor = 0;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
}

async function loadDuelBots() {
  const response = await fetch("/api/bots");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bots = await response.json();
  for (const selector of [$("#duelCandidate"), $("#duelOpponent")]) {
    selector.replaceChildren(...bots.map((bot) => new Option(bot.label, bot.path)));
  }
  $("#duelCandidate").value = bots.find((bot) => bot.path === "bots/model-a-v20.js")?.path ?? bots[0]?.path ?? "";
  $("#duelOpponent").value = bots.find((bot) => bot.path === "bots/model-b-v78.js")?.path ?? bots[1]?.path ?? "";
  if (bots.length < 2) {
    $("#runDuel").disabled = true;
    $("#duelStatus").textContent = "请先将至少两条策略程序放入 bots/。";
  }
}

async function pollDuel() {
  if (!duelJobId) return;
  const jobId = duelJobId;
  try {
    const response = await fetch(`/api/duel/${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    if (jobId !== duelJobId) return;
    renderDuelResults(data);
    if (data.status === "complete") {
      duelJobId = null;
      setBusy(false);
      $("#duelStatus").textContent = `测评完成。逐局报告：${data.reportPath}`;
      await loadHistory().catch(console.error);
      return;
    }
    if (data.status === "error") {
      duelJobId = null;
      setBusy(false);
      $("#duelStatus").textContent = `测评失败：${data.error}`;
      return;
    }
    $("#duelStatus").textContent = `正在测评 ${safe(data.candidateLabel)} 对 ${safe(data.opponentLabel)}：${data.completedMatches} / ${data.totalMatches} 局已完成`;
  } catch (error) {
    if (jobId !== duelJobId) return;
    $("#duelStatus").textContent = `读取进度遇到问题，将继续重试：${error.message}`;
  }
  duelPollTimer = setTimeout(pollDuel, 700);
}

async function startDuel() {
  if (busy || liveSessionId) return;
  const candidate = $("#duelCandidate").value;
  const opponent = $("#duelOpponent").value;
  if (!candidate || !opponent || candidate === opponent) {
    $("#duelStatus").textContent = "请选择两条不同的蛇。";
    return;
  }
  const seeds = Number($("#duelSeeds").value);
  const seedBase = Number($("#duelSeedBase").value);
  if (!Number.isInteger(seeds) || seeds < 1 || seeds > 100 || !Number.isInteger(seedBase) || seedBase < 0) {
    $("#duelStatus").textContent = "种子数需为 1–100，起始种子需为非负整数。";
    return;
  }
  stopPlayback();
  setBusy(true);
  clearTimeout(duelPollTimer);
  $("#duelSummary").classList.add("hidden");
  $("#duelMatches").innerHTML = '<p class="muted">正在准备双方选手…</p>';
  $("#duelStatus").textContent = "正在启动配对测评…";
  try {
    const started = await requestJson("/api/duel/start", {
      candidate, opponent, seeds, seedBase, maxTurns: 500,
      label: $("#duelCandidate").selectedOptions[0]?.textContent,
    });
    duelJobId = started.jobId;
    void pollDuel();
  } catch (error) {
    setBusy(false);
    $("#duelStatus").textContent = `无法开始测评：${error.message}`;
  }
}

async function stopLiveSession() {
  const sessionId = liveSessionId;
  if (!sessionId) return;
  liveGeneration++;
  clearTimeout(liveTimer);
  liveSessionId = null;
  livePaused = false;
  requestedDirection = null;
  updateLiveControls();
  await requestJson("/api/live/stop", { sessionId });
}

function setHumanDirection(direction) {
  if (!liveSessionId || livePaused || !match) return;
  const human = match.frames.at(-1).snakes.find((snake) => snake.id === match.humanId);
  if (!human?.body.length) return;
  const opposite = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" };
  if (human.body.length > 1 && direction === opposite[human.direction]) return;
  requestedDirection = direction;
  updateLiveControls();
}

function scheduleLiveTick(delay = 0) {
  clearTimeout(liveTimer);
  if (!liveSessionId || livePaused) return;
  liveTimer = setTimeout(() => liveTick(liveGeneration), delay);
}

async function liveTick(generation) {
  if (!liveSessionId || livePaused || liveInFlightSession === liveSessionId) return;
  const sessionId = liveSessionId;
  const started = performance.now();
  liveInFlightSession = sessionId;
  try {
    const result = await requestJson("/api/live/step", { sessionId, direction: requestedDirection });
    if (generation !== liveGeneration || sessionId !== liveSessionId) return;
    match.frames.push(result.frame);
    cursor = match.frames.length - 1;
    const human = result.frame.snakes.find((snake) => snake.id === match.humanId);
    if (!human?.body.length) requestedDirection = null;
    if (result.finished) {
      match.winnerIds = result.winnerIds;
      match.replayName = result.replayName;
      liveSessionId = null;
      liveGeneration++;
      livePaused = false;
      requestedDirection = null;
      updateLiveControls();
      render();
      await loadHistory().catch(console.error);
      return;
    }
    updateLiveControls();
    render();
    const interval = 1000 / Number($("#liveSpeed").value);
    scheduleLiveTick(Math.max(0, interval - (performance.now() - started)));
  } catch (error) {
    if (generation !== liveGeneration) return;
    await stopLiveSession().catch(console.error);
    render();
    setStatus(`手动比赛中断：${error.message}`);
  } finally {
    if (liveInFlightSession === sessionId) liveInFlightSession = null;
  }
}

function toggleLivePause() {
  if (!liveSessionId) return;
  livePaused = !livePaused;
  if (livePaused) clearTimeout(liveTimer);
  else scheduleLiveTick();
  updateLiveControls();
  render();
}

async function startMatch() {
  if (busy) return;
  stopPlayback();
  setBusy(true);
  setStatus("正在准备比赛…");
  try {
    await stopLiveSession();
    if ($("#participation").value === "human") {
      const started = await requestJson("/api/live/start", { seed: Number($("#seed").value) });
      match = started.match;
      liveSessionId = started.sessionId;
      liveGeneration++;
      livePaused = false;
      requestedDirection = null;
      cursor = 0;
      updateLiveControls();
      render();
      scheduleLiveTick(500);
    } else {
      match = await requestJson("/api/match", { seed: Number($("#seed").value) });
      cursor = 0;
      render();
      togglePlayback();
      await loadHistory().catch(console.error);
    }
  } catch (error) {
    setStatus(`比赛失败：${error.message}`);
    if (!match) $("#boardEmpty").textContent = "比赛未能开始，请查看错误信息";
  } finally {
    setBusy(false);
  }
}

async function startTournament() {
  if (busy || liveSessionId) return;
  stopPlayback();
  setBusy(true);
  setStatus("正在运行多场比赛…");
  $("#tournamentResult").innerHTML = '<p class="muted">正在计算，请稍候…</p>';
  try {
    const result = await requestJson("/api/tournament", {
      seed: Number($("#seed").value), games: Number($("#games").value),
    });
    $("#tournamentResult").innerHTML = `<table><thead><tr><th>选手</th><th>独胜</th><th>并列第一</th><th>平均分</th><th>平均死亡</th></tr></thead><tbody>${result.standings.map((row) =>
      `<tr><td>${safe(row.name)}</td><td>${row.wins}</td><td>${row.tiedFirst}</td><td>${row.averageScore}</td><td>${row.averageDeaths}</td></tr>`).join("")}</tbody></table>`;
    setStatus(`已完成 ${result.games} 场对比`);
  } catch (error) {
    $("#tournamentResult").textContent = `锦标赛失败：${error.message}`;
    setStatus("锦标赛失败");
  } finally {
    setBusy(false);
  }
}

async function loadHistory() {
  const response = await fetch("/api/replays");
  if (!response.ok) return;
  const names = await response.json();
  const holder = $("#history");
  holder.replaceChildren();
  if (!names.length) {
    holder.innerHTML = '<p class="muted">暂无回放</p>';
    return;
  }
  for (const name of names.slice(0, 8)) {
    const button = document.createElement("button");
    button.className = "history-item";
    button.type = "button";
    const label = document.createElement("span");
    label.textContent = `比赛 · ${name.slice(6, 25).replace("T", " ")}`;
    const arrow = document.createElement("span");
    arrow.textContent = "查看 ↗";
    button.append(label, arrow);
    button.addEventListener("click", async () => {
      if (busy) return;
      stopPlayback();
      setStatus("正在读取回放…");
      try {
        await stopLiveSession();
        const replay = await fetch(`/api/replay/${encodeURIComponent(name)}`);
        if (!replay.ok) throw new Error(`HTTP ${replay.status}`);
        match = await replay.json();
        cursor = 0;
        $("#seed").value = String(match.config.seed);
        render();
      } catch (error) { setStatus(`读取失败：${error.message}`); }
    });
    holder.append(button);
  }
}

$("#newMatch").addEventListener("click", startMatch);
$("#runTournament").addEventListener("click", startTournament);
$("#runDuel").addEventListener("click", startDuel);
$("#livePause").addEventListener("click", toggleLivePause);
$("#liveStop").addEventListener("click", async () => {
  try {
    await stopLiveSession();
    render();
    setStatus("本局已结束，可查看已进行的回合或开始新比赛");
  } catch (error) { setStatus(`结束比赛失败：${error.message}`); }
});
$("#liveSpeed").addEventListener("input", (event) => {
  $("#liveSpeedValue").textContent = `${event.target.value} 回合/秒`;
});
for (const button of document.querySelectorAll("[data-direction]")) {
  button.addEventListener("click", () => { setHumanDirection(button.dataset.direction); button.blur(); });
}
$("#play").addEventListener("click", togglePlayback);
$("#prev").addEventListener("click", () => moveCursor(-1));
$("#next").addEventListener("click", () => moveCursor(1));
$("#timeline").addEventListener("input", (event) => {
  if (liveSessionId) return;
  stopPlayback(); cursor = Number(event.target.value); render();
});
$("#speed").addEventListener("input", (event) => {
  $("#speedValue").textContent = `${event.target.value} 回合/秒`;
  if (playing) schedulePlayback();
});
window.addEventListener("resize", render);
document.addEventListener("keydown", (event) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (liveSessionId) {
    const direction = {
      ArrowUp: "UP", ArrowRight: "RIGHT", ArrowDown: "DOWN", ArrowLeft: "LEFT",
      KeyW: "UP", KeyD: "RIGHT", KeyS: "DOWN", KeyA: "LEFT",
    }[event.code];
    if (direction) { event.preventDefault(); setHumanDirection(direction); return; }
    if (event.code === "Space" && document.activeElement?.tagName !== "BUTTON") {
      event.preventDefault(); toggleLivePause();
    }
    return;
  }
  if (document.activeElement?.tagName === "BUTTON") return;
  if (event.code === "Space") { event.preventDefault(); togglePlayback(); }
  if (event.code === "ArrowLeft") moveCursor(-1);
  if (event.code === "ArrowRight") moveCursor(1);
});
window.addEventListener("pagehide", () => {
  if (liveSessionId) navigator.sendBeacon("/api/live/stop", new Blob(
    [JSON.stringify({ sessionId: liveSessionId })], { type: "application/json" },
  ));
});

loadHistory().catch(console.error);
loadDuelBots().catch((error) => { $("#duelStatus").textContent = `读取策略列表失败：${error.message}`; });
startMatch();
