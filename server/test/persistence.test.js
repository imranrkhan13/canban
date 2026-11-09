const { test } = require('node:test')
const assert = require('node:assert')

// In-memory fake of the pg Pool with failure injection and write counting.
const store = new Map()
let writes = 0
let failNext = 0
class FakePool {
  constructor(cfg) { this.cfg = cfg }
  async query(sql, params = []) {
    if (failNext > 0) { failNext--; throw new Error('fake pg outage') }
    if (/CREATE TABLE/i.test(sql)) return { rows: [] }
    if (/^INSERT INTO rooms/i.test(sql)) {
      writes++
      const [id, name, created_at, data] = params
      store.set(id, { id, name, created_at, data: JSON.parse(data) })
      return { rows: [] }
    }
    if (/^SELECT id, data FROM rooms/i.test(sql)) {
      return { rows: [...store.values()].map(r => ({ id: r.id, data: r.data })) }
    }
    throw new Error('unexpected SQL: ' + sql)
  }
}
require.cache[require.resolve('pg')] = { id: 'pg', filename: 'pg', loaded: true, exports: { Pool: FakePool } }

const db = require('../db')

const sampleRoom = (id = 'TESTROOM1') => ({
  id, name: 'Test Board', createdAt: new Date().toISOString(),
  columns: [{ id: 'c1', name: 'To Do', position: 1000, color: '#fff' }],
  tasks: [{ id: 't1', columnId: 'c1', title: 'Task one', position: 1000, version: 3, comments: [{ id: 'cm1', body: 'hi' }] }],
  logs: [{ id: 'l1', seq: 1, action: 'TASK_CREATED' }],
  stats: { tasksCreated: 1, tasksMoved: 2, tasksDeleted: 0, commentsAdded: 1, membersJoined: 4 },
  members: { sock1: { id: 'u1', name: 'LiveUser' } }, // presence must NOT persist
})

test('disabled mode without DATABASE_URL: all ops safe no-ops', async () => {
  delete process.env.DATABASE_URL
  assert.strictEqual(db.init(), false)
  await db.migrate()
  const rooms = new Map()
  assert.strictEqual(await db.loadAll(rooms), 0)
  db.schedulePersist(sampleRoom())
  await new Promise(r => setTimeout(r, 50))
  assert.strictEqual(writes, 0)
  assert.strictEqual(db.state().mode, 'disabled')
})

test('snapshot excludes live members and keeps board state', () => {
  const s = db.snapshot(sampleRoom())
  assert.strictEqual(s.members, undefined)
  assert.strictEqual(s.tasks.length, 1)
  assert.deepStrictEqual(s.stats.tasksMoved, 2)
})

test('persist + loadAll roundtrip restores rooms identically (minus members)', async () => {
  store.clear()
  process.env.DATABASE_URL = 'postgres://fake'
  assert.strictEqual(db.init(), true)
  await db.migrate()
  db.setMode('up')
  const room = sampleRoom()
  await db.writeOnce(room)
  const rooms = new Map()
  assert.strictEqual(await db.loadAll(rooms), 1)
  const back = rooms.get('TESTROOM1')
  assert.strictEqual(back.name, 'Test Board')
  assert.deepStrictEqual(back.tasks, room.tasks)
  assert.deepStrictEqual(back.logs, room.logs)
  assert.deepStrictEqual(back.members, {})
})

test('upsert updates the same row, no duplicate', async () => {
  const room = sampleRoom()
  room.tasks.push({ id: 't2', columnId: 'c1', title: 'Second', position: 2000, version: 1, comments: [] })
  await db.writeOnce(room)
  assert.strictEqual(store.size, 1)
  const rooms = new Map()
  await db.loadAll(rooms)
  assert.strictEqual(rooms.get('TESTROOM1').tasks.length, 2)
})

test('write queue: mutation during in-flight write triggers exactly one follow-up, order preserved', async () => {
  store.clear(); writes = 0
  const room = sampleRoom('ROOMQ')
  // block the first write artificially by making the pool slow
  const orig = FakePool.prototype.query
  let releaseFirst
  FakePool.prototype.query = async function (sql, params) {
    if (/^INSERT/.test(sql) && writes === 0) await new Promise(r => { releaseFirst = r })
    return orig.call(this, sql, params)
  }
  db.schedulePersist(room)                    // write 1 starts (blocked)
  room.name = 'Edited while writing'
  db.schedulePersist(room)                    // marks dirty, no concurrent write
  db.schedulePersist(room)                    // still just dirty
  releaseFirst()
  await new Promise(r => setTimeout(r, 150))
  FakePool.prototype.query = orig
  assert.strictEqual(store.get('ROOMQ').data.name, 'Edited while writing') // final state landed
  assert.ok(writes === 2, `expected 2 writes (initial + one coalesced follow-up), got ${writes}`)
})

test('outage: persist retries with backoff, then stays dirty and reports down honestly', async () => {
  writes = 0; failNext = 4 // exhausts the 4 attempts (initial + 3 backoffs)
  const room = sampleRoom('ROOMFAIL')
  db.schedulePersist(room)
  await new Promise(r => setTimeout(r, 12000)) // outlast 0.5+2+8s backoff ladder
  assert.strictEqual(store.has('ROOMFAIL'), false)  // nothing was written
  const st = db.state()
  assert.strictEqual(st.mode, 'down')
  assert.ok(st.dirtyRooms.includes('ROOMFAIL'))
  assert.ok(st.failedPersists >= 4)
  // recovery: next mutation after the outage lands the CURRENT state
  failNext = 0
  room.name = 'Recovered'
  db.schedulePersist(room)
  await new Promise(r => setTimeout(r, 100))
  assert.strictEqual(store.get('ROOMFAIL').data.name, 'Recovered')
  assert.strictEqual(db.state().mode, 'up')
})

test('save-status: durableRev follows only confirmed writes, onSaved fires per write', async () => {
  store.clear(); writes = 0; failNext = 0
  const saved = []
  db.onSaved((roomId, rev) => saved.push([roomId, rev]))
  const room = sampleRoom('ROOMREV')
  room.rev = 5
  db.schedulePersist(room)
  await new Promise(r => setTimeout(r, 100))
  assert.strictEqual(db.durableRev('ROOMREV'), 5)
  assert.deepStrictEqual(saved[saved.length - 1], ['ROOMREV', 5])
})

test('save-status: mutation during in-flight write does not falsely advance durableRev', async () => {
  store.clear(); writes = 0; failNext = 0
  const saved = []
  db.onSaved((roomId, rev) => saved.push([roomId, rev]))
  const orig = FakePool.prototype.query
  let releaseFirst
  FakePool.prototype.query = async function (sql, params) {
    if (/^INSERT/.test(sql) && writes === 0) await new Promise(r => { releaseFirst = r })
    return orig.call(this, sql, params)
  }
  const room = sampleRoom('ROOMMID')
  room.rev = 1
  db.schedulePersist(room)          // write of rev 1 starts, blocked
  room.rev = 2; room.name = 'v2'
  db.schedulePersist(room)          // dirty; rev 2 NOT in the in-flight snapshot
  releaseFirst()
  await new Promise(r => setTimeout(r, 150))
  FakePool.prototype.query = orig
  // first ack must be rev 1 (not 2), final durable state must reach rev 2
  assert.strictEqual(saved[0][1], 1)
  assert.strictEqual(db.durableRev('ROOMMID'), 2)
  assert.strictEqual(store.get('ROOMMID').data.name, 'v2')
})

test('save-status: outage reports unsaved honestly, then confirms after recovery', async () => {
  store.clear(); writes = 0; failNext = 4
  const saved = []
  db.onSaved((roomId, rev) => saved.push([roomId, rev]))
  const room = sampleRoom('ROOMOUT')
  room.rev = 7
  db.schedulePersist(room)
  await new Promise(r => setTimeout(r, 12000)) // outlast backoff ladder
  assert.strictEqual(db.state().mode, 'down')
  assert.strictEqual(db.durableRev('ROOMOUT'), 0)          // nothing confirmed
  assert.strictEqual(saved.filter(([id]) => id === 'ROOMOUT').length, 0) // no false ack
  failNext = 0
  db.schedulePersist(room)                                 // sweeper/mutation retry
  await new Promise(r => setTimeout(r, 100))
  assert.strictEqual(db.durableRev('ROOMOUT'), 7)          // now confirmed
  assert.deepStrictEqual(saved[saved.length - 1], ['ROOMOUT', 7])
  assert.strictEqual(db.state().mode, 'up')
})
