const socket = io();

const canvas = document.getElementById("field");
const ctx = canvas.getContext("2d");
const eggWrap = document.getElementById("eggWrap");
const crackOverlay = document.getElementById("crackOverlay");
const fieldHint = document.getElementById("fieldHint");
const seedBtn = document.getElementById("seedBtn");
const devPanel = document.getElementById("devPanel");
const factionButtons = document.getElementById("factionButtons");
const selectedFactionLabel = document.getElementById("selectedFactionLabel");
const instabilityValue = document.getElementById("instabilityValue");
const instabilityFill = document.getElementById("instabilityFill");
const totalPointsStat = document.getElementById("totalPointsStat");
const factionStats = document.getElementById("factionStats");
const recentColors = document.getElementById("recentColors");
const countdownValue = document.getElementById("countdownValue");
const resultMessage = document.getElementById("resultMessage");

const DEV_MODE = new URLSearchParams(window.location.search).get("dev") === "1";

// Client-side mirrored state (server remains authoritative for round phase).
let points = [];
let instability = 0;
let phase = "prep";
let phaseEndsAt = Date.now();
let round = 1;
let cooldown = false;
let cooldownEndsAt = 0;
let selectedFaction = "#ff4d4d";
let recentColorLog = [];
let audioCtx = null;
let audioReady = false;
let lastPrepSecond = null;

const FACTIONS = ["#ff4d4d", "#4da6ff", "#4dff88", "#ffd24d"];
const BASE_MIN_POINTS_FOR_INSTABILITY = 15;
const SAFE_DOMINANCE = 0.6;
const BASE_RECENT_WINDOW = 20;
const ROUND_DURATION_MS = 10 * 60 * 1000;
const BASE_ROUND_DURATION_MS = 10 * 60 * 1000;
const TEMPO_SCALE = Math.min(
  Math.max(ROUND_DURATION_MS / BASE_ROUND_DURATION_MS, 0.35),
  1
);
const MIN_POINTS_FOR_INSTABILITY = Math.max(
  6,
  Math.round(BASE_MIN_POINTS_FOR_INSTABILITY * TEMPO_SCALE)
);
const RECENT_WINDOW = Math.max(8, Math.round(BASE_RECENT_WINDOW * TEMPO_SCALE));
const PREVIEW_SAFE_BASE = 0.25;
const PREVIEW_CAP = 12;

function calcDominance(samplePoints) {
  const counts = {};

  for (const p of samplePoints) {
    counts[p.color] = (counts[p.color] || 0) + 1;
  }

  const values = Object.values(counts);
  if (values.length === 0) {
    return { total: 0, dominance: 0 };
  }

  const total = values.reduce((a, b) => a + b, 0);
  const max = Math.max(...values);
  return { total, dominance: max / total };
}

function dominanceToPressure(dominance) {
  if (dominance <= SAFE_DOMINANCE) {
    return 0;
  }

  const excess = (dominance - SAFE_DOMINANCE) / (1 - SAFE_DOMINANCE);
  return Math.min(Math.floor(Math.pow(excess, 1.2) * 100), 100);
}

// Keep client gauge aligned with server hybrid math for consistent UX.
function calculateInstability() {
  if (points.length === 0) {
    return 0;
  }

  const globalStats = calcDominance(points);
  const recentStats = calcDominance(points.slice(-RECENT_WINDOW));

  const sampleFactor = Math.min(globalStats.total / MIN_POINTS_FOR_INSTABILITY, 1);
  if (sampleFactor <= 0) {
    return 0;
  }

  const remainingMs = Math.max(0, phaseEndsAt - Date.now());
  const progress =
    phase === "active"
      ? Math.min(
          Math.max((ROUND_DURATION_MS - remainingMs) / ROUND_DURATION_MS, 0),
          1
        )
      : 0;
  const recentWeight = 0.85 - progress * 0.55; // 0.85 -> 0.30
  const globalWeight = 1 - recentWeight;

  const recentPressure = dominanceToPressure(recentStats.dominance);
  const globalPressure = dominanceToPressure(globalStats.dominance);
  const blended = recentPressure * recentWeight + globalPressure * globalWeight;

  const previewRange = Math.max(SAFE_DOMINANCE - PREVIEW_SAFE_BASE, 0.01);
  const previewNorm = Math.min(
    Math.max((globalStats.dominance - PREVIEW_SAFE_BASE) / previewRange, 0),
    1
  );
  const preview = previewNorm * PREVIEW_CAP * sampleFactor;

  return Math.min(Math.floor(Math.max(preview, blended * sampleFactor)), 100);
}

// --- Canvas rendering ---
function drawField() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawArenaBackground();
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
  }
}

function drawArenaBackground() {
  // Quadrants make spatial pressure zones visible so point placement feels meaningful.
  const zones = [
    { x: 0, y: 0, w: 200, h: 200, color: "rgba(255,77,77,0.06)" },
    { x: 200, y: 0, w: 200, h: 200, color: "rgba(77,166,255,0.06)" },
    { x: 0, y: 200, w: 200, h: 200, color: "rgba(77,255,136,0.06)" },
    { x: 200, y: 200, w: 200, h: 200, color: "rgba(255,210,77,0.06)" },
  ];
  for (const z of zones) {
    ctx.fillStyle = z.color;
    ctx.fillRect(z.x, z.y, z.w, z.h);
  }

  ctx.strokeStyle = "rgba(20,24,32,0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(200, 0);
  ctx.lineTo(200, 400);
  ctx.moveTo(0, 200);
  ctx.lineTo(400, 200);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(200, 200, 72, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(20,24,32,0.18)";
  ctx.stroke();
}

function renderInstability() {
  instabilityValue.textContent = String(instability);
  instabilityFill.style.width = `${instability}%`;

  const crackVisible = instability > 50;
  crackOverlay.classList.toggle("hidden", !crackVisible);
  crackOverlay.classList.toggle("severe", instability > 80);
  if (crackVisible) {
    const intensity = Math.min(Math.max((instability - 50) / 50, 0), 1);
    crackOverlay.style.opacity = String(0.25 + intensity * 0.75);
  } else {
    crackOverlay.style.opacity = "0";
  }

  eggWrap.classList.toggle("shake", instability > 80);

  if (instability < 35) {
    fieldHint.textContent = "Ecosystem stable. Small shifts are recoverable.";
  } else if (instability < 70) {
    fieldHint.textContent = "Pressure rising. Collective balance is needed.";
  } else {
    fieldHint.textContent = "Critical pressure. One-sided dominance may collapse.";
  }
}

function renderPointStats() {
  if (!DEV_MODE) {
    return;
  }

  const counts = {};
  for (const color of FACTIONS) {
    counts[color] = 0;
  }

  for (const p of points) {
    if (counts[p.color] === undefined) {
      counts[p.color] = 0;
    }
    counts[p.color] += 1;
  }

  totalPointsStat.textContent = `Total: ${points.length}`;
  factionStats.innerHTML = "";
  for (const color of FACTIONS) {
    const chip = document.createElement("div");
    chip.className = "dev-chip";
    chip.textContent = `${color}: ${counts[color] || 0}`;
    chip.style.borderLeft = `4px solid ${color}`;
    factionStats.appendChild(chip);
  }
}

function renderRecentColors() {
  recentColors.innerHTML = "";

  if (recentColorLog.length === 0) {
    const empty = document.createElement("div");
    empty.className = "recent-chip";
    empty.textContent = "No data";
    recentColors.appendChild(empty);
    return;
  }

  for (const color of recentColorLog) {
    const chip = document.createElement("div");
    chip.className = "recent-chip";
    chip.textContent = color;
    chip.style.borderLeft = `4px solid ${color}`;
    recentColors.appendChild(chip);
  }
}

// --- UI rendering ---
function renderFactions() {
  selectedFactionLabel.textContent = selectedFaction;
  factionButtons.innerHTML = "";

  for (const color of FACTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "faction-btn";
    btn.style.background = color;
    btn.classList.toggle("active", color === selectedFaction);
    btn.setAttribute("aria-label", `Select faction ${color}`);
    btn.addEventListener("click", () => {
      selectedFaction = color;
      renderFactions();
    });
    factionButtons.appendChild(btn);
  }
}

function formatTime(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// Called when a point update arrives from socket.
function onPoint(point) {
  points.push(point);
  recentColorLog.unshift(point.color);
  recentColorLog = recentColorLog.slice(0, 5);
  instability = calculateInstability();
  drawField();
  renderInstability();
  renderPointStats();
  renderRecentColors();
}

// Apply server phase/round timing to client display.
function applyState(newState) {
  if (!newState || typeof newState !== "object") {
    return;
  }

  phase =
    newState.phase === "active" || newState.phase === "rest"
      ? newState.phase
      : "prep";
  phaseEndsAt =
    typeof newState.phaseEndsAt === "number" ? newState.phaseEndsAt : Date.now();
  round = typeof newState.round === "number" ? newState.round : round;
  renderSeedButton();
  renderCountdown();
  renderPhaseEffects();
}

function renderCountdown() {
  const seconds = Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1000));
  const phaseText =
    phase === "active" ? "ASC" : phase === "rest" ? "REST" : "PREP";
  countdownValue.textContent = `${phaseText} ${formatTime(seconds)} (R${round})`;
}

// Seed button state is driven by phase + local cooldown.
function renderSeedButton() {
  const cooldownLeft = Math.max(
    0,
    Math.ceil((cooldownEndsAt - Date.now()) / 1000)
  );

  if (phase !== "active") {
    seedBtn.disabled = true;
    seedBtn.textContent = phase === "prep" ? "Preparing..." : "Resting...";
    return;
  }

  if (cooldown && cooldownLeft > 0) {
    seedBtn.disabled = true;
    seedBtn.textContent = `Cooldown ${cooldownLeft}s`;
    return;
  }

  cooldown = false;
  seedBtn.disabled = false;
  seedBtn.textContent = "Daily Seed";
}

// Prep phase has special visuals and countdown tick sound.
function renderPhaseEffects() {
  const secondsLeft = Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1000));
  const inPrep = phase === "prep";

  document.body.classList.toggle("prep", inPrep);
  document.body.classList.toggle("prep-last3", inPrep && secondsLeft <= 3);

  if (inPrep && secondsLeft > 0 && secondsLeft !== lastPrepSecond) {
    playPrepTick(secondsLeft);
    lastPrepSecond = secondsLeft;
    return;
  }

  if (!inPrep) {
    lastPrepSecond = null;
  }
}

// Browsers require user interaction before audio can start.
function unlockAudio() {
  if (audioReady) {
    return;
  }

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) {
    return;
  }

  audioCtx = new Ctx();
  audioReady = true;
}

function playPrepTick(secondsLeft) {
  if (!audioReady || !audioCtx) {
    return;
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const normalized = Math.max(0, Math.min(1, (10 - secondsLeft) / 9));

  osc.type = "triangle";
  osc.frequency.value = 260 + normalized * 320;
  gain.gain.value = 0.02 + normalized * 0.08;

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.08);
}

function triggerRoundFlash() {
  eggWrap.classList.remove("flash");
  void eggWrap.offsetWidth;
  eggWrap.classList.add("flash");
}

// Player action: emit a point with selected faction color.
function handleSeed() {
  if (phase !== "active" || cooldown) {
    return;
  }

  cooldown = true;
  cooldownEndsAt = Date.now() + 5000;
  renderSeedButton();

  const newPoint = {
    x: Math.random() * 400,
    y: Math.random() * 400,
    color: selectedFaction,
  };

  eggWrap.classList.add("seed-pulse");
  setTimeout(() => {
    eggWrap.classList.remove("seed-pulse");
  }, 140);

  socket.emit("addPoint", newPoint);
}

seedBtn.addEventListener("click", handleSeed);
document.addEventListener("pointerdown", unlockAudio, { once: true });

if (!DEV_MODE && devPanel) {
  devPanel.style.display = "none";
}

// --- Socket event wiring ---
socket.on("init", (payload) => {
  if (Array.isArray(payload)) {
    points = payload;
  } else {
    points = Array.isArray(payload?.points) ? payload.points : [];
    applyState(payload?.state);
    const latest = Array.isArray(payload?.history) ? payload.history[0] : null;
    if (latest) {
      resultMessage.textContent = `Round ${latest.round}: ${latest.outcome} | Peak ${latest.peakInstability}% | Top ${latest.mostUsedColor} (${latest.mostUsedCount}) | Stable ${latest.bestStableSeconds}s | Points ${latest.totalPoints}`;
      resultMessage.className =
        latest.outcome === "Mutation Success" ? "result success" : "result fail";
    }
  }

  instability = calculateInstability();
  recentColorLog = points.slice(-5).reverse().map((p) => p.color);
  drawField();
  renderInstability();
  renderPointStats();
  renderRecentColors();
  renderFactions();
  renderSeedButton();
  renderCountdown();
  renderPhaseEffects();
});

socket.on("state", (nextState) => {
  applyState(nextState);
});

socket.on("roundResult", (result) => {
  if (!result) {
    return;
  }

  triggerRoundFlash();
  resultMessage.textContent = `Round ${result.round}: ${result.outcome} | Peak ${result.peakInstability}% | Top ${result.mostUsedColor} (${result.mostUsedCount}) | Stable ${result.bestStableSeconds}s | Points ${result.totalPoints}`;
  resultMessage.className =
    result.outcome === "Mutation Success" ? "result success" : "result fail";
});

socket.on("resetPoints", () => {
  points = [];
  instability = 0;
  recentColorLog = [];
  drawField();
  renderInstability();
  renderPointStats();
  renderRecentColors();
});

socket.on("update", (point) => {
  onPoint(point);
});

// UI refresh loop for countdown and cooldown labels.
setInterval(() => {
  if (cooldown && Date.now() >= cooldownEndsAt) {
    cooldown = false;
  }

  renderSeedButton();
  renderCountdown();
  renderPhaseEffects();
}, 250);
