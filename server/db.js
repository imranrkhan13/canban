// Neon Postgres persistence for rooms.
// Modes: 'disabled' (DATABASE_URL unset - intentional in-memory dev mode),
//        'up' (writes landing), 'down' (configured but failing - writes are
//        queued dirty, retried loudly, never silently accepted into memory).
const { Pool } = require('pg')

let pool = null
let mode = 'disabled'
const queues = new Map()        // roomId -> { room, writing, dirty }
const durableRevs = new Map()   // roomId -> rev confirmed written to Postgres
let failedPersists = 0
let retryTimer = null
const listeners = []
const savedListeners = []

function onStateChange(fn) { listeners.push(fn) }
function onSaved(fn) { savedListeners.push(fn) }
function durableRev(roomId) { return durableRevs.get(roomId) || 0 }
function setMode(m) { if (mode !== m) { mode = m; listeners.forEach(f => f(m)) } }
function state() {
  return { mode, dirtyRooms: [...queues.entries()].filter(([, q]) => q.dirty || q.writing).map(([id]) => id), failedPersists, durableRevs: Object.fromEntries(durableRevs) }
}

function init() {
  if (!process.env.DATABASE_URL) { console.log('[db] DATABASE_URL not set - in-memory dev mode, nothing is persisted'); return false }
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 })
  setMode('down') // until migrate+load succeed
  return true
}

async function migrate() {
  if (!pool) return
  await pool.query(`CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    data JSONB NOT NULL
  )`)
}

function snapshot(room) {
  return {
    name: room.name, createdAt: room.createdAt,
    columns: room.columns, tasks: room.tasks, logs: room.logs, stats: room.stats,
  }
}

function hydrate(row) {
  const d = row.data
  return {
    id: row.id, name: d.name, createdAt: d.createdAt,
    columns: d.columns || [], tasks: d.tasks || [], logs: d.logs || [],
    stats: d.stats || { tasksCreated: 0, tasksMoved: 0, tasksDeleted: 0, commentsAdded: 0, membersJoined: 0 },
    members: {}, rev: 0,
  }
}

async function loadAll(rooms) {
  if (!pool) return 0
  const { rows } = await pool.query('SELECT id, data FROM rooms')
  for (const row of rows) { rooms.set(row.id, hydrate(row)); durableRevs.set(row.id, 0) }
  return rows.length
}

// Returns the rev captured in the written snapshot, so callers can mark exactly
// which mutation is durable - the live room may already be newer.
async function writeOnce(room) {
  const rev = room.rev || 0
  const data = snapshot(room)
  await pool.query(
    `INSERT INTO rooms (id, name, created_at, updated_at, data)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now(), data = EXCLUDED.data`,
    [room.id, room.name, room.createdAt, JSON.stringify(data)]
  )
  return rev
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Serialized per-room write queue: a write starts immediately; mutations that
// land during an in-flight write set dirty and trigger exactly one follow-up
// write, so order is preserved and there is no timer-based loss window.
async function drain(roomId) {
  const q = queues.get(roomId)
  if (!q || q.writing) return
  q.writing = true
  q.dirty = false
  const backoffs = [500, 2000, 8000]
  for (let attempt = 0; ; attempt++) {
    try {
      const rev = await writeOnce(q.room)
      durableRevs.set(roomId, rev)
      savedListeners.forEach(f => f(roomId, rev))
      if (mode !== 'up') setMode('up')
      break
    } catch (err) {
      failedPersists++
      if (attempt < backoffs.length) {
        console.error(`[db] persist failed for room ${roomId} (attempt ${attempt + 1}), retrying: ${err.message}`)
        await sleep(backoffs[attempt])
      } else {
        console.error(`[db] PERSIST FAILING for room ${roomId}; write kept dirty and will retry every 30s: ${err.message}`)
        setMode('down')
        q.dirty = true // stay dirty; retried by the periodic sweeper or the next mutation
        break
      }
    }
  }
  q.writing = false
  if (q.dirty && mode === 'up') drain(roomId) // a mutation landed during the successful write
}

function schedulePersist(room) {
  if (!pool) return // dev mode: intentionally nothing to persist
  let q = queues.get(room.id)
  if (!q) { q = { room, writing: false, dirty: false }; queues.set(room.id, q) }
  q.room = room
  if (q.writing) { q.dirty = true; return }
  drain(room.id).catch(err => console.error('[db] drain error', room.id, err.message))
}

// Sweeper: while any room is dirty (DB was down), retry every 30s.
function startSweeper() {
  if (retryTimer || !pool) return
  retryTimer = setInterval(() => {
    for (const [id, q] of queues) if (q.dirty && !q.writing) drain(id).catch(() => {})
  }, 30000)
  retryTimer.unref()
}

async function flushAll(rooms) {
  if (!pool) return
  for (const room of rooms.values()) {
    try { const rev = await writeOnce(room); durableRevs.set(room.id, rev) } catch (e) { console.error('[db] flush failed for room', room.id, e.message) }
  }
}

module.exports = { init, migrate, loadAll, schedulePersist, writeOnce, flushAll, snapshot, hydrate, state, onStateChange, onSaved, durableRev, startSweeper, setMode }
