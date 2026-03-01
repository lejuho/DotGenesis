# DotGenesis Product Strategy Plan

## 1) Product Positioning
- DotGenesis is not only a game loop. It is a collective decision protocol.
- Long-term goal: round outcomes influence real product decisions and Web3 artifacts.

## 2) Core Strategic Principles
- Keep one primary mode to preserve user density and a single narrative.
- Do not split permanent fast/slow modes in early stage.
- Use eventized tempo shifts (e.g., Surge event) inside the same world and rule system.

## 3) Gameplay Direction
- Base loop: global round cadence.
- Instability should be bidirectional and recoverable by player behavior.
- Preferred curve: hybrid signal.
  - Blend `recent clicks` signal and `global ratio` signal.
  - Early phase reacts fast.
  - Mid phase emphasizes balancing.
  - Late phase adds sustained pressure.

## 4) Web3/Product Readiness Architecture
- Game Engine: real-time round execution.
- Event Log Store: persistent round records.
- Decision Engine: map outcomes to product parameters.
- Provenance Service: hash/sign snapshot generation.
- Chain Anchor: write periodic root hash on-chain.
- Product Sync: push validated outcomes to real product workflow.

## 5) Why This Structure
- Keeps onboarding simple (single mode).
- Keeps data coherent (no split populations).
- Makes outcomes auditable (hash chain + logs).
- Supports gradual migration from POC to trust-sensitive product rails.

## 6) Near-Term Build Order
1. Persist round snapshots in DB.
2. Add deterministic round hash chain.
3. Version decision rules and audit changes.
4. Add internal operator dashboard.
5. Add on-chain anchor of summary hashes.

## 7) Operational Guardrails
- Rate-limit and anti-spam gates.
- Rule version pinning per round.
- Manual override logs.
- Public verification script for snapshot hash checks.

## 8) Evolution Topology Options (1 vs 2 vs 3)
- Option 1: One global egg evolves
  - Strength: strong collective narrative, event-friendly
  - Weakness: weak personal ownership, low catalog scale
- Option 2: Multiple eggs compete and evolve
  - Strength: better competition loops, community segmentation
  - Weakness: medium complexity and balancing overhead
- Option 3: Per-user eggs, global system acts as environment
  - Strength: strongest ownership, retention, and collectible depth
  - Weakness: highest system complexity and data design requirements

## 9) Fun + Monetization Tradeoff
- Option 1
  - Fun: medium (spectacle, less personal agency)
  - Monetization: low to medium (limited NFT surface)
  - Scalability: low
- Option 2
  - Fun: high (competition + identity)
  - Monetization: high (series/season operations)
  - Scalability: medium to high
- Option 3
  - Fun: very high (ownership + growth fantasy)
  - Monetization: very high (broad NFT graph, secondary market depth)
  - Scalability: very high
- Recommendation: make Option 3 the long-term core, borrow Option 2 season/event structure for social rivalry.

## 10) Why Evolution/Genetics Fit Web3 Natively
- Immutable lineage: each generation snapshot can be hash-linked and auditable.
- Trait state transitions: NFT metadata can represent gene vectors over time.
- Consensus pressure: collective gameplay outcomes act as environmental selection.
- Verifiable provenance: on-chain anchors plus off-chain proofs provide trust without full on-chain cost.
- Scarcity design: mutation events create non-linear rarity and collectible differentiation.

## 11) Product Direction Decision
- Keep a single primary gameplay lane to avoid fragmented liquidity/attention.
- Use slow cadence as the default (`generation-oriented`) experience.
- Express fast tempo as in-universe mutation events, not a separate permanent mode.
- Persist generation state so rounds are not isolated episodes but evolutionary continuity.

## 12) Delivery Stages
- MVP-Web2 (now -> short horizon)
  - Goal: prove fun loop + prove server-side trustworthy generation records fast.
- MMP (post-MVP)
  - Goal: launch-ready product shell with creator/operator workflow.
- Mainnet-ready
  - Goal: auditable on-chain anchoring + NFT trait evolution pipeline.

## 13) MVP Scope (Detailed)
- Product objective
  - Validate that players understand and feel:
    - global pressure,
    - recoverability (instability can go down),
    - generation continuity.
- Technical objective
  - Persist generation data and expose deterministic replay/proof artifacts (Web2 first).

### MVP-A. Gameplay and UX (must-have)
1. Stabilize hybrid instability UX
   - Keep current hybrid formula (`recent + global`) and preview layer.
   - Add tuning knobs in one config block (no magic numbers spread out).
   - Add a small UI hint: `instability is recoverable`.
2. Generation framing in UI text
   - Rename round-facing text to generation-facing wording where appropriate.
   - Keep existing runtime logic, only terminology update for now.
3. Result card enrichment
   - Show reason (`timer` vs `overload`) and trend (`up/down` near end window).
4. Keep dev panel gated by `?dev=1`
   - Default user surface remains minimal.

### MVP-B. Data persistence (must-have)
1. Add SQLite persistence (fastest path)
   - Store per-generation summary rows.
   - Store config version used for that generation.
2. Required schema (minimum)
   - `generations`
     - `id`, `started_at`, `ended_at`, `phase_end_reason`
     - `peak_instability`, `total_points`, `best_stable_seconds`
     - `most_used_color`, `most_used_count`
     - `formula_version`, `formula_params_json`
     - `prev_hash`, `hash`
3. Write path
   - On generation end, write summary to DB in same server process.
4. Read path
   - On server start, load latest N generation summaries into memory history.

### MVP-C. Trust and provenance (must-have)
1. Deterministic hash chain
   - Canonicalize summary payload (stable key ordering).
   - `hash_n = sha256(prev_hash + canonical_json(generation_n))`.
2. Verification script
   - Local script that replays DB rows and validates chain integrity.
3. Rule/version pinning
   - Add `formula_version` constant and include it in summary payload.

### MVP-D. API and operator visibility (must-have)
1. Add read-only endpoints
   - `GET /api/generations?limit=20`
   - `GET /api/generations/:id`
   - `GET /api/provenance/latest`
2. Add lightweight operator panel block (or simple JSON view)
   - Show latest generation hash, previous hash, formula version.

### MVP-E. Explicitly out-of-scope (for speed)
1. On-chain input commits
2. On-chain settlement anchors
3. Wallet signature gating and NFT mint integration
4. Advanced anti-sybil weighting

## 14) MVP Immediate Task List (Do Next)
1. Introduce config block in `server/index.js`
   - Centralize: durations, instability parameters, preview parameters, formula version.
2. Implement SQLite bootstrap
   - Create DB file and `generations` table at server startup.
3. Implement generation write on end
   - Build canonical payload.
   - Compute `prev_hash`, `hash`.
   - Persist row and push to in-memory history.
4. Implement startup history hydrate
   - Load last 20 rows from DB into `history`.
5. Add `GET /api/generations` and `GET /api/provenance/latest`
   - Use these for immediate validation and debugging.
6. Add verifier script
   - Recompute chain from DB rows and print pass/fail.
7. Update UI labels from Round -> Generation (text-only first)
   - Avoid logic churn while shipping MVP.
8. Run manual validation scenario
   - Start server.
   - Play 3 generations.
   - Confirm DB rows, API output, hash chain validity.

## 14-A) Web2-Only Sprint Order (Implement First)
1. SQLite persistence + startup hydrate
2. Generation hash chain + verifier script
3. Read APIs (`/api/generations`, `/api/provenance/latest`)
4. UI text cleanup (Generation wording + recoverable hint)
5. Basic operator status JSON endpoint

## 15) MMP Scope (After MVP)
1. Mutation event framework (fast tempo as event, not separate mode)
2. Rule engine externalization (JSON/YAML policy files with versioning)
3. Operator dashboard with filters and anomaly flags
4. Player identity linkage (wallet optional at this stage)
5. Better anti-spam and abuse detection

## 16) Mainnet-Ready Scope
1. On-chain anchor job (periodic root hash commit)
2. Off-chain proof bundle publication (IPFS/S3)
3. NFT trait evolution mapping from generation outcomes
4. Contract + indexer integration and failure recovery flow
5. Public transparency page for proof verification

## 17) MVP Exit Criteria
- Fun signal
  - Players demonstrate balancing behavior (not only spam dominance).
  - Generation-end summaries are discussed/shared.
- System signal
  - Every generation has persisted summary + valid hash link.
  - Restarting server does not lose generation history.
- Product signal
  - Operator can explain any generation outcome with stored record + hash proof.

## 18) Input/Settlement Architecture (Realtime -> Batch -> Daily)
- Why
  - Keep real-time feel for players.
  - Keep predictable and auditable settlement for economy trust.
  - Avoid per-click on-chain transaction fatigue.
- Pipeline
  1. Realtime input (off-chain ingest)
     - Player point actions are accepted instantly and reflected in UI.
     - Server stores signed event logs (`wallet`, `ts`, `region`, `action`, `nonce`).
  2. Batch commit (Web2 now, on-chain later) (every 5-15 min; default 10 min)
     - Build Merkle root (or canonical hash) for the interval event set.
     - MVP-Web2: write commit row in DB.
     - Mainnet-ready: write one on-chain commit transaction with root + interval metadata.
  3. Daily (or regional-periodic) settlement
     - Compute generation/environment outcomes from committed intervals only.
     - MVP-Web2: write settlement hash + summary in DB.
     - Mainnet-ready: anchor settlement hash on-chain.
- Guardrails
  - Last-window distortion damping
    - Apply contribution decay near settlement boundary (example: final 30 min weighted down).
  - Replay protection
    - Enforce event nonce per wallet/session.
  - Verifiability
    - Anyone can verify daily settlement is derived from committed interval roots.

## 19) Player Activity Expansion (Point-Based, No Menu Sprawl)
- Principle
  - Keep "point action" as the only primitive.
  - Derive higher-level systems from where/when/how points accumulate.
- Activity concepts
  1. Climate distortion points
     - Points in specific map zones tilt local environment probabilities.
  2. Lineage imprint points
     - Points near active lineage traces increase that lineage's future reappearance chance.
  3. Resonance points (revival trigger)
     - When hidden pattern thresholds are met by collective point traces, revival events can occur.
  4. Extinction memory points
     - Points around extinction zones preserve or fade legacy influence over time.
  5. Ecosystem influence points
     - Internal "entanglement" weight increases with diverse, sustained ecosystem participation.
- Design intent
  - Player does not directly buff raw power.
  - Player shapes environment and probability fields.

## 20) Anti-Whale and Fair Influence Design
- Do not use pure token-weight voting for environment control.
- Recommended mixed influence
  - 50% algorithmic baseline
  - 30% stochastic/environmental variation
  - 20% player influence
- Player influence weighting inputs (not publicly rankified as a single score)
  - diversity of interactions,
  - lineage stewardship history,
  - participation consistency,
  - anti-sybil adjusted identity confidence.
- Diminishing returns
  - Repeated same-wallet same-region actions lose marginal effect in short windows.

## 21) Value Representation: Profile over Rank
- Avoid single "lineage score" ranking.
- Use multidimensional lineage profile
  - survival history,
  - adaptation diversity,
  - extinction/revival context,
  - rare trait intersections,
  - generation depth.
- Outcome
  - comparison is possible,
  - hard global ordering is discouraged,
  - fixed meta pressure is reduced.

## 22) Ownership and Belonging UX
- Mint/ownership ground truth
  - NFT ownership is wallet-bound and chain-verifiable.
- Belonging reinforcement
  - Permanent original creator field in lineage record.
  - Transfer history shown as lineage timeline, not just marketplace events.
  - "World impact log" linking wallet actions to ecosystem milestones.
