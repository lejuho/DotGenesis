const path = require("path");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();

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
const FORMULA_VERSION = "v1.0-hybrid-preview";
const DB_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DB_DIR, "dotgenesis.db");
const HISTORY_LIMIT = 20;

let points = [];
let state = {
  round: 1,
  phase: "prep",
  phaseEndsAt: Date.now() + PREP_DURATION_MS,
  lastOutcome: null,
};
let history = [];
let roundStats = createRoundStats();
let activeStartedAt = null;
let lastPersistedHash = "";
let db;

const FORMULA_PARAMS = {
  baseMinPointsForInstability: BASE_MIN_POINTS_FOR_INSTABILITY,
  safeDominance: SAFE_DOMINANCE,
  baseRecentWindow: BASE_RECENT_WINDOW,
  previewSafeBase: PREVIEW_SAFE_BASE,
  previewCap: PREVIEW_CAP,
  roundDurationMs: ROUND_DURATION_MS,
  restDurationMs: REST_DURATION_MS,
};

function canonicalStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function createGenerationPayload(summary) {
  return {
    round: summary.round,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    reason: summary.reason,
    outcome: summary.outcome,
    peakInstability: summary.peakInstability,
    totalPoints: summary.totalPoints,
    mostUsedColor: summary.mostUsedColor,
    mostUsedCount: summary.mostUsedCount,
    bestStableSeconds: summary.bestStableSeconds,
    formulaVersion: FORMULA_VERSION,
    formulaParams: FORMULA_PARAMS,
  };
}

function hashGeneration(prevHash, summary) {
  const canonical = canonicalStringify(createGenerationPayload(summary));
  return crypto.createHash("sha256").update(prevHash + canonical).digest("hex");
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });
}

async function initDb() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new sqlite3.Database(DB_PATH);
  await run(`
    CREATE TABLE IF NOT EXISTS generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER NOT NULL,
      phase_end_reason TEXT NOT NULL,
      outcome TEXT NOT NULL,
      peak_instability INTEGER NOT NULL,
      total_points INTEGER NOT NULL,
      most_used_color TEXT NOT NULL,
      most_used_count INTEGER NOT NULL,
      best_stable_seconds INTEGER NOT NULL,
      formula_version TEXT NOT NULL,
      formula_params_json TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    )
  `);
}

function rowToSummary(row) {
  return {
    round: row.round,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    reason: row.phase_end_reason,
    outcome: row.outcome,
    peakInstability: row.peak_instability,
    totalPoints: row.total_points,
    mostUsedColor: row.most_used_color,
    mostUsedCount: row.most_used_count,
    bestStableSeconds: row.best_stable_seconds,
    formulaVersion: row.formula_version,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

async function hydrateHistory() {
  const rows = await all(
    `SELECT *
     FROM generations
     ORDER BY id DESC
     LIMIT ?`,
    [HISTORY_LIMIT]
  );
  history = rows.map(rowToSummary);

  const latest = await get(
    "SELECT hash FROM generations ORDER BY id DESC LIMIT 1"
  );
  lastPersistedHash = latest?.hash || "";
}

async function persistGeneration(summary) {
  const prevHash = lastPersistedHash;
  const hash = hashGeneration(prevHash, summary);

  await run(
    `INSERT INTO generations (
      round, started_at, ended_at, phase_end_reason, outcome, peak_instability,
      total_points, most_used_color, most_used_count, best_stable_seconds,
      formula_version, formula_params_json, prev_hash, hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      summary.round,
      summary.startedAt,
      summary.endedAt,
      summary.reason,
      summary.outcome,
      summary.peakInstability,
      summary.totalPoints,
      summary.mostUsedColor,
      summary.mostUsedCount,
      summary.bestStableSeconds,
      FORMULA_VERSION,
      JSON.stringify(FORMULA_PARAMS),
      prevHash,
      hash,
    ]
  );

  lastPersistedHash = hash;
  return { ...summary, formulaVersion: FORMULA_VERSION, prevHash, hash };
}

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
    startedAt: activeStartedAt,
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
async function endActiveRound(reason) {
  const summary = summarizeRound(reason);
  const persisted = await persistGeneration(summary);
  state = {
    ...state,
    phase: "rest",
    phaseEndsAt: Date.now() + REST_DURATION_MS,
    lastOutcome: persisted,
  };

  history.unshift(persisted);
  history = history.slice(0, HISTORY_LIMIT);

  io.emit("roundResult", persisted);
  emitState();
}

app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/api/generations", async (req, res) => {
  try {
    const parsed = Number(req.query.limit);
    const limit =
      Number.isFinite(parsed) && parsed > 0
        ? Math.min(Math.floor(parsed), 100)
        : 20;
    const rows = await all(
      `SELECT *
       FROM generations
       ORDER BY id DESC
       LIMIT ?`,
      [limit]
    );

    res.json({
      items: rows.map((row) => ({
        ...rowToSummary(row),
        formulaParams: JSON.parse(row.formula_params_json),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "failed_to_fetch_generations" });
  }
});

app.get("/api/generations/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }

    const row = await get("SELECT * FROM generations WHERE id = ?", [id]);
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    res.json({
      item: {
        ...rowToSummary(row),
        formulaParams: JSON.parse(row.formula_params_json),
      },
    });
  } catch (err) {
    res.status(500).json({ error: "failed_to_fetch_generation" });
  }
});

app.get("/api/provenance/latest", async (_req, res) => {
  try {
    const row = await get(
      `SELECT id, round, ended_at, formula_version, prev_hash, hash
       FROM generations
       ORDER BY id DESC
       LIMIT 1`
    );
    res.json({
      item: row
        ? {
            id: row.id,
            round: row.round,
            endedAt: row.ended_at,
            formulaVersion: row.formula_version,
            prevHash: row.prev_hash,
            hash: row.hash,
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: "failed_to_fetch_provenance" });
  }
});

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
      void endActiveRound("Instability 100% overload");
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
    activeStartedAt = now;
    roundStats = createRoundStats();
    emitState();
    return;
  }

  if (state.phase === "active") {
    void endActiveRound("Timer reached 00:00");
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

async function bootstrap() {
  await initDb();
  await hydrateHistory();

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`DotGenesis server running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start DotGenesis server:", err);
  process.exit(1);
});
