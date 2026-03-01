const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Core runtime knobs for round-based gameplay.
const PORT = process.env.PORT || 3000;
const FACTIONS = ["#ff4d4d", "#4da6ff", "#4dff88", "#ffd24d"];
const BASE_MIN_POINTS_FOR_INSTABILITY = 15;
const SAFE_DOMINANCE = 0.6;
const BASE_RECENT_WINDOW = 20;
const PREP_DURATION_MS = 10 * 1000;
const ROUND_DURATION_MS = 10 * 60 * 1000;
const REST_DURATION_MS = process.env.FAST_REST === "1" ? 10 * 1000 : 60 * 1000;
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

let points = [];
let state = {
  round: 1,
  phase: "prep",
  phaseEndsAt: Date.now() + PREP_DURATION_MS,
  lastOutcome: null,
};
let history = [];
let roundStats = createRoundStats();

// Per-round metrics used for summary and balancing.
function createRoundStats() {
  return {
    totalPoints: 0,
    colorCounts: {},
    peakInstability: 0,
    stableMsCurrent: 0,
    stableMsBest: 0,
    lastTickAt: Date.now(),
  };
}

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

// Instability hybrid rule:
// - mix recent 20 clicks and full-round ratio
// - early round weights recent signal higher (faster response)
// - late round weights global signal higher (sustained pressure)
// - preview layer shows low movement before full instability emerges
function calculateInstability(currentPoints, now = Date.now()) {
  if (currentPoints.length === 0) {
    return 0;
  }

  const globalStats = calcDominance(currentPoints);
  const recentStats = calcDominance(currentPoints.slice(-RECENT_WINDOW));

  const sampleFactor = Math.min(globalStats.total / MIN_POINTS_FOR_INSTABILITY, 1);
  if (sampleFactor <= 0) {
    return 0;
  }

  const remainingMs = Math.max(0, state.phaseEndsAt - now);
  const progress = Math.min(
    Math.max((ROUND_DURATION_MS - remainingMs) / ROUND_DURATION_MS, 0),
    1
  );
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

// Count faction usage to build round summary.
function registerPoint(color) {
  roundStats.totalPoints += 1;
  roundStats.colorCounts[color] = (roundStats.colorCounts[color] || 0) + 1;
}

// Track peak instability and longest consecutive stable window.
function registerInstability(now, instability) {
  roundStats.peakInstability = Math.max(roundStats.peakInstability, instability);

  const delta = Math.max(0, now - roundStats.lastTickAt);
  if (instability <= 50) {
    roundStats.stableMsCurrent += delta;
    roundStats.stableMsBest = Math.max(
      roundStats.stableMsBest,
      roundStats.stableMsCurrent
    );
  } else {
    roundStats.stableMsCurrent = 0;
  }

  roundStats.lastTickAt = now;
}

// Build a compact end-of-round snapshot for UI/history.
function summarizeRound(reason) {
  const colorEntries = Object.entries(roundStats.colorCounts);
  const mostUsed = colorEntries.length
    ? colorEntries.reduce((a, b) => (b[1] > a[1] ? b : a))
    : ["none", 0];

  return {
    round: state.round,
    reason,
    outcome:
      roundStats.peakInstability > 70
        ? "Mutation Success"
        : "Unstable Collapse",
    peakInstability: roundStats.peakInstability,
    totalPoints: roundStats.totalPoints,
    mostUsedColor: mostUsed[0],
    mostUsedCount: mostUsed[1],
    bestStableSeconds: Math.floor(roundStats.stableMsBest / 1000),
    endedAt: Date.now(),
  };
}

function emitState() {
  io.emit("state", state);
}

// Move active round to rest state and broadcast result.
function endActiveRound(reason) {
  const summary = summarizeRound(reason);
  state = {
    ...state,
    phase: "rest",
    phaseEndsAt: Date.now() + REST_DURATION_MS,
    lastOutcome: summary,
  };

  history.unshift(summary);
  history = history.slice(0, 20);

  io.emit("roundResult", summary);
  emitState();
}

app.use(express.static(path.join(__dirname, "..", "public")));

io.on("connection", (socket) => {
  // New clients receive current board, timer phase, and recent summary.
  socket.emit("init", { points, state, history });

  socket.on("addPoint", (point) => {
    // Inputs are accepted only during active phase.
    if (state.phase !== "active") {
      return;
    }

    if (
      !point ||
      typeof point.x !== "number" ||
      typeof point.y !== "number" ||
      typeof point.color !== "string"
    ) {
      return;
    }

    const safePoint = {
      x: Math.max(0, Math.min(400, point.x)),
      y: Math.max(0, Math.min(400, point.y)),
      color: point.color.slice(0, 30),
    };
    if (!FACTIONS.includes(safePoint.color)) {
      return;
    }

    points.push(safePoint);
    registerPoint(safePoint.color);
    const instability = calculateInstability(points, Date.now());
    registerInstability(Date.now(), instability);

    io.emit("update", safePoint);

    // Hard fail condition: 100 instability ends the round immediately.
    if (instability >= 100) {
      endActiveRound("Instability 100% overload");
    }
  });
});

// Authoritative round clock:
// prep -> active -> rest -> next prep
setInterval(() => {
  const now = Date.now();

  if (state.phase === "active") {
    registerInstability(now, calculateInstability(points, now));
  }

  if (now < state.phaseEndsAt) {
    return;
  }

  if (state.phase === "prep") {
    state = {
      ...state,
      phase: "active",
      phaseEndsAt: now + ROUND_DURATION_MS,
      lastOutcome: null,
    };
    roundStats = createRoundStats();
    emitState();
    return;
  }

  if (state.phase === "active") {
    endActiveRound("Timer reached 00:00");
    return;
  }

  points = [];
  io.emit("resetPoints");
  state = {
    ...state,
    round: state.round + 1,
    phase: "prep",
    phaseEndsAt: now + PREP_DURATION_MS,
  };
  emitState();
}, 250);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`DotGenesis server running on http://localhost:${PORT}`);
});
