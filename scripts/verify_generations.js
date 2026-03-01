const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const sqlite3 = require("sqlite3").verbose();

const DB_PATH = path.join(__dirname, "..", "data", "dotgenesis.db");

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

function getAll(db, sql, params = []) {
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

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    // eslint-disable-next-line no-console
    console.log("PASS: no database file yet (0 generation rows)");
    return;
  }

  const db = new sqlite3.Database(DB_PATH);
  const rows = await getAll(
    db,
    `SELECT *
     FROM generations
     ORDER BY id ASC`
  );

  let prevHash = "";
  for (const row of rows) {
    const payload = {
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
      formulaParams: JSON.parse(row.formula_params_json),
    };
    const canonical = canonicalStringify(payload);
    const expected = crypto
      .createHash("sha256")
      .update(prevHash + canonical)
      .digest("hex");

    if (row.prev_hash !== prevHash || row.hash !== expected) {
      // eslint-disable-next-line no-console
      console.error(`FAIL at generation id=${row.id}`);
      // eslint-disable-next-line no-console
      console.error(`expected prev_hash=${prevHash}, actual prev_hash=${row.prev_hash}`);
      // eslint-disable-next-line no-console
      console.error(`expected hash=${expected}, actual hash=${row.hash}`);
      process.exit(1);
    }

    prevHash = row.hash;
  }

  // eslint-disable-next-line no-console
  console.log(`PASS: verified ${rows.length} generation rows`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Verification failed:", err);
  process.exit(1);
});
