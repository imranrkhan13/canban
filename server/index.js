const express = require('express')
const { createServer } = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const { customAlphabet } = require('nanoid')

const app = express()
const http = createServer(app)
const io = new Server(http, { cors: { origin: '*', methods: ['GET', 'POST'] } })
app.use(cors()); app.use(express.json())

const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8)
const rooms = new Map()
let globalSeq = 0

const COLORS = ['#b45309', '#0369a1', '#7c3aed', '#0f766e', '#be185d', '#c2410c', '#4338ca', '#15803d', '#b91c1c', '#6d28d9']
let ci = 0; const nextColor = () => COLORS[ci++ % COLORS.length]

// ─── logging ─────────────────────────────────────────────────────
const C = { r: '\x1b[0m', dim: '\x1b[2m', b: '\x1b[1m', cy: '\x1b[36m', g: '\x1b[32m', y: '\x1b[33m', re: '\x1b[31m', m: '\x1b[35m' }
const ts = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}` }
const slog = (lvl, cat, msg, data) => {
  const lc = { INFO: C.cy, WARN: C.y, ERROR: C.re, DEBUG: C.dim }[lvl] || C.cy
  const lm = { INFO: '◆', WARN: '▲', ERROR: '✖', DEBUG: '·' }[lvl] || '◆'
  console.log(`${C.dim}${ts()}${C.r} ${lc}${lm} ${lvl.padEnd(5)}${C.r} ${C.m}[${cat}]${C.r} ${msg}${data ? ' ' + C.dim + JSON.stringify(data) + C.r : ''}`)
}

function mkLog(room, opts) {
  const e = { id: nanoid(), seq: ++globalSeq, timestamp: new Date().toISOString(), roomId: room.id, ...opts }
  room.logs.unshift(e)
  if (room.logs.length > 1000) room.logs.pop()
  return e
}

function createRoom(name) {
  const id = nanoid()
  const room = {
    id, name, createdAt: new Date().toISOString(),
    columns: [
      { id: nanoid(), name: 'Backlog', position: 1000, color: '#9ca3af' },
      { id: nanoid(), name: 'To Do', position: 2000, color: '#78716c' },
      { id: nanoid(), name: 'In Progress', position: 3000, color: '#2563eb' },
      { id: nanoid(), name: 'Review', position: 4000, color: '#7c3aed' },
      { id: nanoid(), name: 'Done', position: 5000, color: '#16a34a' },
    ],
    tasks: [], members: {}, logs: [],
    stats: { tasksCreated: 0, tasksMoved: 0, tasksDeleted: 0, commentsAdded: 0, membersJoined: 0 }
  }
  rooms.set(id, room)
  slog('INFO', 'ROOM', `Created "${name}"`, { id })
  return room
}

const between = (p, n) => { if (p == null && n == null) return 1000; if (p == null) return n / 2; if (n == null) return p + 1000; return (p + n) / 2 }

// ─── REST ─────────────────────────────────────────────────────────
app.post('/api/rooms', (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name required' })
  const room = createRoom(name.trim())
  res.status(201).json({ id: room.id, name: room.name })
})

app.get('/api/rooms/:id', (req, res) => {
  const room = rooms.get(req.params.id)
  if (!room) return res.status(404).json({ error: 'Not found' })
  const { members, logs, ...rest } = room
  res.json({ ...rest, memberCount: Object.keys(members).length })
})

app.get('/api/rooms/:id/logs', (req, res) => {
  const room = rooms.get(req.params.id)
  if (!room) return res.status(404).json({ error: 'Not found' })
  let entries = [...room.logs]
  if (req.query.category) entries = entries.filter(e => e.category === req.query.category)
  if (req.query.q) entries = entries.filter(e => JSON.stringify(e).toLowerCase().includes(req.query.q.toLowerCase()))
  const limit = parseInt(req.query.limit) || 100, offset = parseInt(req.query.offset) || 0
  res.json({ total: entries.length, entries: entries.slice(offset, offset + limit) })
})

app.get('/api/rooms/:id/stats', (req, res) => {
  const room = rooms.get(req.params.id)
  if (!room) return res.status(404).json({ error: 'Not found' })
  const t = room.tasks, doneCol = room.columns.find(c => c.name === 'Done')
  const today = new Date().toDateString()
  res.json({
    ...room.stats, totalTasks: t.length,
    activeTasks: t.filter(x => !x.archived).length,
    overdue: t.filter(x => x.dueDate && new Date(x.dueDate) < new Date() && !x.archived).length,
    completedToday: t.filter(x => x.columnId === doneCol?.id && new Date(x.updatedAt).toDateString() === today).length,
    byPriority: Object.fromEntries(['urgent', 'high', 'medium', 'low', 'none'].map(p => [p, t.filter(x => x.priority === p && !x.archived).length])),
    memberCount: Object.keys(room.members).length, logCount: room.logs.length,
  })
})

app.get('/health', (_, res) => res.json({ ok: true, rooms: rooms.size, uptime: process.uptime() }))

// ─── WEBSOCKET ────────────────────────────────────────────────────
io.on('connection', socket => {
  slog('DEBUG', 'WS', `Connected ${socket.id}`)

  socket.on('join:room', ({ roomId, userName }) => {
    const room = rooms.get(roomId)
    if (!room) { socket.emit('error', { message: 'Room not found' }); return }
    socket.join(roomId); socket.data = { roomId, userName, userId: nanoid(), joinedAt: new Date().toISOString() }
    const isFirst = Object.keys(room.members).length === 0
    const member = { id: socket.data.userId, name: userName, color: nextColor(), socketId: socket.id, joinedAt: socket.data.joinedAt, role: isFirst ? 'owner' : 'member', activeTaskId: null }
    room.members[socket.id] = member; room.stats.membersJoined++
    slog('INFO', 'MEMBER', `"${userName}" joined "${room.name}" as ${member.role}`)
    const log = mkLog(room, { category: 'MEMBER', actorName: userName, actorId: socket.data.userId, action: 'MEMBER_JOINED', entity: userName, entityType: 'member', meta: { role: member.role } })
    socket.emit('room:state', { room: { ...room, members: Object.values(room.members) } })
    socket.to(roomId).emit('member:joined', { member, log })
    io.to(roomId).emit('presence:update', { members: Object.values(room.members) })
    io.to(roomId).emit('log:new', log)
  })

  socket.on('task:create', ({ columnId, title, priority = 'none', description = '', assignees = [], dueDate = null }) => {
    const room = rooms.get(socket.data.roomId); if (!room) return
    const col = room.columns.find(c => c.id === columnId)
    const colTasks = room.tasks.filter(t => t.columnId === columnId)
    const lastPos = colTasks.length ? Math.max(...colTasks.map(t => t.position)) : 0
    const now = new Date().toISOString()
    const task = { id: nanoid(), columnId, title: title.trim(), description, priority, position: lastPos + 1000, dueDate, labels: [], assignees, checklist: [], comments: [], version: 1, createdBy: socket.data.userName, createdById: socket.data.userId, createdAt: now, updatedAt: now, pinned: false, archived: false, timeEstimate: null }
    room.tasks.push(task); room.stats.tasksCreated++
    slog('INFO', 'TASK', `"${socket.data.userName}" created "${title}" → ${col?.name}`)
    const log = mkLog(room, { category: 'TASK', actorName: socket.data.userName, actorId: socket.data.userId, action: 'TASK_CREATED', entity: title, entityId: task.id, entityType: 'task', after: { title, columnId, columnName: col?.name, priority }, meta: { position: task.position } })
    io.to(socket.data.roomId).emit('task:created', { task, log })
    io.to(socket.data.roomId).emit('log:new', log)
  })

  socket.on('task:move', ({ taskId, columnId, position, version }) => {
    const room = rooms.get(socket.data.roomId); if (!room) return
    const task = room.tasks.find(t => t.id === taskId); if (!task) return
    if (task.version !== version) { slog('WARN', 'CONFLICT', `Version mismatch "${task.title}" cli:${version} srv:${task.version}`); socket.emit('conflict:rejected', { taskId, serverTask: task }); return }
    const fromCol = room.columns.find(c => c.id === task.columnId)
    const toCol = room.columns.find(c => c.id === columnId)
    const before = { columnId: task.columnId, columnName: fromCol?.name, position: task.position }
    task.columnId = columnId; task.position = position; task.version++; task.updatedAt = new Date().toISOString()
    room.stats.tasksMoved++
    slog('INFO', 'TASK', `"${socket.data.userName}" moved "${task.title}": ${fromCol?.name} → ${toCol?.name}`)
    const log = mkLog(room, { category: 'TASK', actorName: socket.data.userName, actorId: socket.data.userId, action: 'TASK_MOVED', entity: task.title, entityId: taskId, entityType: 'task', before, after: { columnId, columnName: toCol?.name, position }, meta: { fromColumn: fromCol?.name, toColumn: toCol?.name } })
    io.to(socket.data.roomId).emit('task:moved', { task, log })
    io.to(socket.data.roomId).emit('log:new', log)
  })

  socket.on('task:update', ({ taskId, fields, version }) => {
    const room = rooms.get(socket.data.roomId); if (!room) return
    const task = room.tasks.find(t => t.id === taskId); if (!task) return
    if (task.version !== version) { socket.emit('conflict:rejected', { taskId, serverTask: task }); return }
    const allowed = ['title', 'description', 'priority', 'dueDate', 'labels', 'assignees', 'checklist', 'pinned', 'archived', 'timeEstimate']
    const before = {}, after = {}
    for (const [k, v] of Object.entries(fields)) { if (!allowed.includes(k)) continue; before[k] = task[k]; task[k] = v; after[k] = v }
    task.version++; task.updatedAt = new Date().toISOString()
    let action = 'TASK_UPDATED'
    if (fields.pinned !== undefined) action = fields.pinned ? 'TASK_PINNED' : 'TASK_UNPINNED'
    if (fields.archived !== undefined) action = fields.archived ? 'TASK_ARCHIVED' : 'TASK_UNARCHIVED'
    if (fields.priority !== undefined) action = 'TASK_PRIORITY_CHANGED'
    if (fields.title !== undefined) action = 'TASK_RENAMED'
    if (fields.dueDate !== undefined) action = 'TASK_DUE_DATE_SET'
    if (fields.assignees !== undefined) action = 'TASK_ASSIGNEES_CHANGED'
    if (fields.checklist !== undefined) action = 'TASK_CHECKLIST_UPDATED'
    slog('INFO', 'TASK', `"${socket.data.userName}" ${action} "${task.title}"`)
    const log = mkLog(room, { category: 'TASK', actorName: socket.data.userName, actorId: socket.data.userId, action, entity: task.title, entityId: taskId, entityType: 'task', before, after })
    io.to(socket.data.roomId).emit('task:updated', { task, log })
    io.to(socket.data.roomId).emit('log:new', log)
  })

  socket.on('task:delete', ({ taskId }) => {
    const room = rooms.get(socket.data.roomId); if (!room) return
    const idx = room.tasks.findIndex(t => t.id === taskId); if (idx === -1) return
    const [task] = room.tasks.splice(idx, 1); room.stats.tasksDeleted++
    const col = room.columns.find(c => c.id === task.columnId)
    slog('INFO', 'TASK', `"${socket.data.userName}" deleted "${task.title}"`)
    const log = mkLog(room, { category: 'TASK', actorName: socket.data.userName, actorId: socket.data.userId, action: 'TASK_DELETED', entity: task.title, entityId: taskId, entityType: 'task', before: { title: task.title, columnName: col?.name } })
    io.to(socket.data.roomId).emit('task:deleted', { taskId, log })
    io.to(socket.data.roomId).emit('log:new', log)
  })

  socket.on('task:duplicate', ({ taskId }) => {
    const room = rooms.get(socket.data.roomId); if (!room) return
    const orig = room.tasks.find(t => t.id === taskId); if (!orig) return
    const colTasks = room.tasks.filter(t => t.columnId === orig.columnId)
    const lastPos = colTasks.length ? Math.max(...colTasks.map(t => t.position)) : 0
    const now = new Date().toISOString()
    const task = { ...orig, id: nanoid(), title: `${orig.title} (copy)`, position: lastPos + 1000, version: 1, createdBy: socket.data.userName, createdById: socket.data.userId, createdAt: now, updatedAt: now, comments: [] }
    room.tasks.push(task); room.stats.tasksCreated++
    slog('INFO', 'TASK', `"${socket.data.userName}" duplicated "${orig.title}"`)
    const log = mkLog(room, { category: 'TASK', actorName: socket.data.userName, actorId: socket.data.userId, action: 'TASK_DUPLICATED', entity: task.title, entityId: task.id, entityType: 'task', meta: { sourceTitle: orig.title } })
    io.to(socket.data.roomId).emit('task:created', { task, log })
    io.to(socket.data.roomId).emit('log:new', log)
  })

  socket.on('comment:add', ({ taskId, body }) => {
    const room = rooms.get(socket.data.roomId); if (!room) return
    const task = room.tasks.find(t => t.id === taskId); if (!task) return
    const comment = { id: nanoid(), authorName: socket.data.userName, authorId: socket.data.userId, authorColor: room.members[socket.id]?.color, body: body.trim(), createdAt: new Date().toISOString() }
    task.comments.push(comment); room.stats.commentsAdded++
    slog('INFO', 'COMMENT', `"${socket.data.userName}" on "${task.title}"`)
    const log = mkLog(room, { category: 'COMMENT', actorName: socket.data.userName, actorId: socket.data.userId, action: 'COMMENT_ADDED', entity: task.title, entityId: comment.id, entityType: 'comment', meta: { taskId, taskTitle: task.title } })
    io.to(socket.data.roomId).emit('comment:added', { taskId, comment, log })
    io.to(socket.data.roomId).emit('log:new', log)
  })

  socket.on('comment:delete', ({ taskId, commentId }) => {
    const room = rooms.get(socket.data.roomId); if (!room) return
    const task = room.tasks.find(t => t.id === taskId); if (!task) return
    const idx = task.comments.findIndex(c => c.id === commentId); if (idx === -1) return
    const [c] = task.comments.splice(idx, 1)
    const log = mkLog(room, { category: 'COMMENT', actorName: socket.data.userName, actorId: socket.data.userId, action: 'COMMENT_DELETED', entity: task.title, entityId: commentId, entityType: 'comment', before: { body: c.body } })
    io.to(socket.data.roomId).emit('comment:deleted', { taskId, commentId, log })
    io.to(socket.data.roomId).emit('log:new', log)
  })

  socket.on('column:create', ({ name, color = '#6b7280' }) => {
    const room = rooms.get(socket.data.roomId); if (!room) return
    const lastPos = room.columns.length ? Math.max(...room.columns.map(c => c.position)) : 0
    const column = { id: nanoid(), name: name.trim(), position: lastPos + 1000, color, wipLimit: null }
    room.columns.push(column)
    slog('INFO', 'COLUMN', `"${socket.data.userName}" created "${name}"`)
    const log = mkLog(room, { category: 'COLUMN', actorName: socket.data.userName, actorId: socket.data.userId, action: 'COLUMN_CREATED', entity: name, entityId: column.id, entityType: 'column', after: { name, color } })
    io.to(socket.data.roomId).emit('column:created', { column, log })
    io.to(socket.data.roomId).emit('log:new', log)
  })

  socket.on('column:rename', ({ columnId, name }) => {
    const room = rooms.get(socket.data.roomId); if (!room) return
    const col = room.columns.find(c => c.id === columnId); if (!col) return
    const old = col.name; col.name = name.trim()
    const log = mkLog(room, { category: 'COLUMN', actorName: socket.data.userName, actorId: socket.data.userId, action: 'COLUMN_RENAMED', entity: name, entityId: columnId, entityType: 'column', before: { name: old }, after: { name: name.trim() } })
    io.to(socket.data.roomId).emit('column:renamed', { columnId, name: name.trim(), log })
    io.to(socket.data.roomId).emit('log:new', log)
  })

  socket.on('column:delete', ({ columnId }) => {
    const room = rooms.get(socket.data.roomId); if (!room) return
    const idx = room.columns.findIndex(c => c.id === columnId); if (idx === -1) return
    const [col] = room.columns.splice(idx, 1)
    const fallback = room.columns[0]
    const moved = room.tasks.filter(t => t.columnId === columnId)
    if (fallback) moved.forEach(t => { t.columnId = fallback.id; t.version++ })
    else room.tasks = room.tasks.filter(t => t.columnId !== columnId)
    const log = mkLog(room, { category: 'COLUMN', actorName: socket.data.userName, actorId: socket.data.userId, action: 'COLUMN_DELETED', entity: col.name, entityId: columnId, entityType: 'column', before: { name: col.name }, meta: { tasksMoved: moved.length, fallbackColumn: fallback?.name } })
    io.to(socket.data.roomId).emit('column:deleted', { columnId, log })
    io.to(socket.data.roomId).emit('log:new', log)
  })

  socket.on('column:set_wip', ({ columnId, limit }) => {
    const room = rooms.get(socket.data.roomId); if (!room) return
    const col = room.columns.find(c => c.id === columnId); if (!col) return
    const old = col.wipLimit; col.wipLimit = limit || null
    const log = mkLog(room, { category: 'COLUMN', actorName: socket.data.userName, actorId: socket.data.userId, action: 'COLUMN_WIP_CHANGED', entity: col.name, entityId: columnId, entityType: 'column', before: { wipLimit: old }, after: { wipLimit: col.wipLimit } })
    io.to(socket.data.roomId).emit('column:updated', { column: col, log })
    io.to(socket.data.roomId).emit('log:new', log)
  })

  socket.on('board:rename', ({ name }) => {
    const room = rooms.get(socket.data.roomId); if (!room) return
    const old = room.name; room.name = name.trim()
    const log = mkLog(room, { category: 'BOARD', actorName: socket.data.userName, actorId: socket.data.userId, action: 'BOARD_RENAMED', entity: name, entityId: room.id, entityType: 'board', before: { name: old }, after: { name: name.trim() } })
    io.to(socket.data.roomId).emit('board:renamed', { name: name.trim(), log })
    io.to(socket.data.roomId).emit('log:new', log)
  })

  socket.on('typing:start', ({ taskId }) => socket.to(socket.data.roomId).emit('typing:indicator', { userId: socket.data.userId, userName: socket.data.userName, taskId, isTyping: true }))
  socket.on('typing:stop', ({ taskId }) => socket.to(socket.data.roomId).emit('typing:indicator', { userId: socket.data.userId, userName: socket.data.userName, taskId, isTyping: false }))

  socket.on('presence:viewing', ({ taskId }) => {
    const room = rooms.get(socket.data.roomId)
    if (!room?.members[socket.id]) return
    room.members[socket.id].activeTaskId = taskId
    socket.to(socket.data.roomId).emit('presence:update', { members: Object.values(room.members) })
  })

  socket.on('disconnect', reason => {
    const room = rooms.get(socket.data.roomId); if (!room) return
    const member = room.members[socket.id]; delete room.members[socket.id]
    if (!member) return
    const duration = Date.now() - new Date(member.joinedAt).getTime()
    slog('INFO', 'MEMBER', `"${member.name}" left (${reason}) ${Math.round(duration / 1000)}s`)
    const log = mkLog(room, { category: 'MEMBER', actorName: member.name, actorId: member.id, action: 'MEMBER_LEFT', entity: member.name, entityId: member.id, entityType: 'member', meta: { reason, sessionDuration: duration } })
    socket.to(socket.data.roomId).emit('member:left', { userId: member.id, members: Object.values(room.members), log })
    io.to(socket.data.roomId).emit('log:new', log)
  })
})

const PORT = process.env.PORT || 3001
http.listen(PORT, () => slog('INFO', 'SERVER', `KanbanPro → http://localhost:${PORT}`))