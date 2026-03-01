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
