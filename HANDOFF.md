# Ops Handoff - Neon persistence (added 2026-11-09)

## What runs where
- API: Render free web service `canban` (canban-b3rx.onrender.com), Node, auto-deploys from `main`.
- Client: Vercel (canban-one.vercel.app), auto-deploys from `main`. Bundle served = built from `client/`.
- DB: Neon Postgres, database `canban`, role `canban_app` (least privilege: full access to `canban` db only; zero grants on other databases - verified by probe 2026-11-09).
- `DATABASE_URL` lives ONLY in: Render env var, and the vault item "Canban Neon DATABASE_URL". No local copies should exist.

## How persistence works
- Table `rooms` (id, name, created_at, updated_at, data jsonb). Snapshot excludes live members.
- Every mutation flows through `mkLog` -> bumps `room.rev`, log entries carry `rev`.
- Per-room serialized write queue; mutations during an in-flight write coalesce into one follow-up write. Outage ladder 0.5/2/8s, then dirty + 30s sweeper.
- `durableRev` = rev confirmed written. Server emits `room:saved {rev}` only after Postgres confirms, `db:state {mode}` on flips; `room:state` carries `{mode, rev, durable}`.
- Client header pill: SAVED / SAVING / NOT SAVED-RECONNECTING (honest degraded state; nothing in disabled/dev mode).
- Modes: `disabled` (no DATABASE_URL), `up`, `down` (configured but failing). Boot retries ~60s then starts DEGRADED; while down, POST /api/rooms returns 503 with an explicit "nothing saved" message and creates nothing.
- `/health` reports `{ rooms, db: { mode, dirtyRooms, failedPersists, durableRevs } }` - no secrets.
- Tests: `cd server && node --test test/persistence.test.js` (9 tests, stubbed pg, incl. no-false-ack and outage-recovery).

## KNOWN CAVEAT - room deletion
There is no room-deletion API. On graceful shutdown (SIGINT/SIGTERM) `flushAll` upserts EVERY in-memory room. A room deleted straight from the DB while still held in server memory CAN REAPPEAR at the next graceful shutdown/restart. Do not assume a DB-deleted room stays deleted unless no running instance holds it. If real deletion is ever needed, add a small DELETE endpoint that removes the room from memory first, then the row.

## Rotating the DB credential
Generate new password for `canban_app` in Neon -> update the vault item -> update Render env var (Save, rebuild, and deploy). Old URL stops working immediately.
