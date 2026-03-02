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
const CELL_STABLE_RADIUS = 5;
const CELL_BIRTH_MS = 320;
const CELL_DIFFUSION_MIN_MS = 500;
const CELL_DIFFUSION_MAX_MS = 1000;
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
const DISH = {
  cx: canvas.width / 2,
  cy: canvas.height / 2,
  radius: Math.min(canvas.width, canvas.height) * 0.46,
};

let noiseTexture = null;

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

function createNoiseTexture() {
  const texture = document.createElement("canvas");
  texture.width = 256;
  texture.height = 256;
  const tctx = texture.getContext("2d");

  tctx.fillStyle = "rgba(8, 16, 24, 0.06)";
  for (let i = 0; i < 2400; i += 1) {
    const x = Math.random() * texture.width;
    const y = Math.random() * texture.height;
    const r = Math.random() * 1.6;
    tctx.beginPath();
    tctx.arc(x, y, r, 0, Math.PI * 2);
    tctx.fill();
  }

  tctx.strokeStyle = "rgba(18, 28, 38, 0.08)";
  for (let i = 0; i < 220; i += 1) {
    const x = Math.random() * texture.width;
    const y = Math.random() * texture.height;
    const len = 2 + Math.random() * 8;
    tctx.beginPath();
    tctx.moveTo(x, y);
    tctx.lineTo(x + len, y + (Math.random() - 0.5) * len);
    tctx.stroke();
  }

  return texture;
}

function applyDishMask() {
  ctx.beginPath();
  ctx.arc(DISH.cx, DISH.cy, DISH.radius, 0, Math.PI * 2);
  ctx.clip();
}

function drawDishBackground(now) {
  const pulse = (Math.sin(now * 0.0013) + 1) * 0.5;

  const dishGradient = ctx.createRadialGradient(
    DISH.cx - 38,
    DISH.cy - 42,
    24,
    DISH.cx,
    DISH.cy,
    DISH.radius
  );
  dishGradient.addColorStop(0, "#f2f8ef");
  dishGradient.addColorStop(0.55, "#dce9dc");
  dishGradient.addColorStop(1, "#bacdbd");
  ctx.fillStyle = dishGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!noiseTexture) {
    noiseTexture = createNoiseTexture();
  }
  ctx.globalAlpha = 0.3 + pulse * 0.14;
  ctx.drawImage(noiseTexture, 0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;

  const innerVignette = ctx.createRadialGradient(
    DISH.cx,
    DISH.cy,
    DISH.radius * 0.36,
    DISH.cx,
    DISH.cy,
    DISH.radius * 1.05
  );
  innerVignette.addColorStop(0, "rgba(255, 255, 255, 0)");
  innerVignette.addColorStop(1, "rgba(15, 30, 24, 0.2)");
  ctx.fillStyle = innerVignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawCell(point, now) {
  const bornAt = typeof point.bornAt === "number" ? point.bornAt : 0;
  const age = now - bornAt;

  if (age >= 0 && age <= CELL_DIFFUSION_MAX_MS) {
    const diffusionMs =
      typeof point.diffusionMs === "number"
        ? point.diffusionMs
        : CELL_DIFFUSION_MAX_MS;
    const diffProgress = Math.min(age / diffusionMs, 1);
    const diffRadius = 8 + diffProgress * 26;
    const halo = ctx.createRadialGradient(
      point.x,
      point.y,
      CELL_STABLE_RADIUS,
      point.x,
      point.y,
      diffRadius
    );
    halo.addColorStop(0, `${point.color}66`);
    halo.addColorStop(0.5, `${point.color}22`);
    halo.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(point.x - diffRadius, point.y - diffRadius, diffRadius * 2, diffRadius * 2);
  }

  let radius = CELL_STABLE_RADIUS;
  let alpha = 0.92;
  if (age >= 0 && age <= CELL_BIRTH_MS) {
    const t = Math.min(age / CELL_BIRTH_MS, 1);
    const swell = 1.6 * (1 - t);
    radius = CELL_STABLE_RADIUS + swell;
    alpha = 0.38 + t * 0.54;
  }

  const wobblePhase = (typeof point.seed === "number" ? point.seed : 0.5) * Math.PI * 2;
  const wobble = Math.sin(now * 0.03 + wobblePhase) * 0.55;

  ctx.fillStyle = `${point.color}${Math.floor(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
  ctx.beginPath();
  for (let i = 0; i < 14; i += 1) {
    const theta = (i / 14) * Math.PI * 2;
    const local = radius + Math.sin(theta * 3 + wobblePhase) * 0.42 + wobble;
    const x = point.x + Math.cos(theta) * local;
    const y = point.y + Math.sin(theta) * local;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fill();
}

// --- Canvas rendering ---
function drawField() {
  const now = performance.now();

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  applyDishMask();
  drawDishBackground(now);
  for (const p of points) {
    drawCell(p, now);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(DISH.cx, DISH.cy, DISH.radius + 2, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(247, 255, 252, 0.68)";
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(DISH.cx, DISH.cy, DISH.radius - 2, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(20, 26, 24, 0.22)";
  ctx.lineWidth = 1.5;
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
    fieldHint.textContent = "Culture stable. Small shifts can still recover.";
  } else if (instability < 70) {
    fieldHint.textContent = "Pressure rising. Collective balancing is needed.";
  } else {
    fieldHint.textContent = "Critical pressure. Dominance can collapse the dish.";
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

function decoratePoint(point, bornAt = performance.now()) {
  return {
    ...point,
    bornAt,
    seed: Math.random(),
    diffusionMs:
      CELL_DIFFUSION_MIN_MS +
      Math.random() * (CELL_DIFFUSION_MAX_MS - CELL_DIFFUSION_MIN_MS),
  };
}

// Called when a point update arrives from socket.
function onPoint(point) {
  points.push(decoratePoint(point));
  recentColorLog.unshift(point.color);
  recentColorLog = recentColorLog.slice(0, 5);
  instability = calculateInstability();
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

function randomPointInDish() {
  const theta = Math.random() * Math.PI * 2;
  const radial = Math.sqrt(Math.random()) * (DISH.radius - 8);
  return {
    x: DISH.cx + Math.cos(theta) * radial,
    y: DISH.cy + Math.sin(theta) * radial,
  };
}

// Player action: emit a point with selected faction color.
function handleSeed() {
  if (phase !== "active" || cooldown) {
    return;
  }

  cooldown = true;
  cooldownEndsAt = Date.now() + 5000;
  renderSeedButton();

  const seedPosition = randomPointInDish();
  const newPoint = {
    x: seedPosition.x,
    y: seedPosition.y,
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
    points = payload.map((p) => decoratePoint(p, -100000));
  } else {
    points = Array.isArray(payload?.points)
      ? payload.points.map((p) => decoratePoint(p, -100000))
      : [];
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
  renderInstability();
  renderPointStats();
  renderRecentColors();
});

socket.on("update", (point) => {
  onPoint(point);
});

function renderLoop() {
  drawField();
  requestAnimationFrame(renderLoop);
}

requestAnimationFrame(renderLoop);

// UI refresh loop for countdown and cooldown labels.
setInterval(() => {
  if (cooldown && Date.now() >= cooldownEndsAt) {
    cooldown = false;
  }

  renderSeedButton();
  renderCountdown();
  renderPhaseEffects();
}, 250);
