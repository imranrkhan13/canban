'use strict';

/**
 * Kanban Pro Server
 * 
 * Architecture:
 * - Room-based: each board has a unique 8-char room code
 * - Anyone with the code joins instantly (no auth needed for demo)
 * - JSON heartbeat PING/PONG (not ws.ping — browser can't respond to protocol-level pings)
 * - All board state in memory (swap with pg Pool for production)
 * - Conflict resolution: last-write-wins with version vectors
 */

const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const cors      = require('cors');
const path      = require('path');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, clientTracking: true });

// ── Logger ────────────────────────────────────────────────────
const ts  = () => new Date().toISOString().slice(11, 23);
const log = {
  info:  (...a) => console.log (`[${ts()}] INFO `, ...a),
  warn:  (...a) => console.warn(`[${ts()}] WARN `, ...a),
  error: (...a) => console.error(`[${ts()}] ERROR`, ...a),
};

// ── In-memory store ────────────────────────────────────────────
// rooms: Map<roomId, Room>
// Room = { id, name, createdAt, columns: [...], cards: Map, opLog: [...] }
const rooms = new Map();

function createRoom(name = 'My Board') {
  const id = uuidv4().replace(/-/g,'').slice(0,8).toUpperCase();
  const room = {
    id,
    name,
    createdAt: Date.now(),
    columns: [
      { id: 'col-1', title: 'To Do',       color: '#F1F5F9', cardIds: [] },
      { id: 'col-2', title: 'In Progress', color: '#FEF9EC', cardIds: [] },
      { id: 'col-3', title: 'In Review',   color: '#F5F3FF', cardIds: [] },
      { id: 'col-4', title: 'Done',        color: '#F0FDF4', cardIds: [] },
    ],
    cards: {},
    opLog: [],
  };
  rooms.set(id, room);
  log.info(`Room created: ${id} "${name}"`);
  return room;
}

function getRoom(id) { return rooms.get(id?.toUpperCase()); }

function roomPresence(roomId) {
  const out = [];
  wss.clients.forEach(ws => {
    if (ws.isAlive && ws.roomId === roomId && ws.userId) {
      out.push({
        userId:   ws.userId,
        userName: ws.userName,
        color:    ws.userColor,
        avatar:   ws.userAvatar,
        dragging: ws.dragging || null,
        typing:   ws.typing   || null,
        editing:  ws.editing  || null,
        cursor:   ws.cursor   || null,
      });
    }
  });
  return out;
}

function broadcastToRoom(roomId, msg, excludeSocketId = null) {
  const payload = JSON.stringify(msg);
  wss.clients.forEach(ws => {
    if (ws.isAlive && ws.roomId === roomId && ws.socketId !== excludeSocketId && ws.readyState === WebSocket.OPEN) {
      ws.send(payload, err => err && log.warn('bcast err', err.message));
    }
  });
}

function sendTo(ws, msg) {
  if (ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(msg), err => err && log.warn('send err', err.message));
}

// ── Conflict resolver ─────────────────────────────────────────
function resolveMove(room, incoming) {
  const recent = room.opLog.filter(o =>
    o.type === 'CARD_MOVE' && o.cardId === incoming.cardId &&
    Date.now() - o.serverTs < 2000
  );
  if (!recent.length) return { ok: true };
  const last = recent[recent.length - 1];
  if (incoming.serverTs - last.serverTs < 500 && last.userId !== incoming.userId) {
    return {
      ok: true, conflict: true,
      message: `${incoming.userName} and ${last.userName} moved the same card simultaneously. Last write wins.`
    };
  }
  return { ok: true };
}

// ── Message handlers ──────────────────────────────────────────
const handlers = {

  PING(ws) {
    ws.isAlive = true;
    sendTo(ws, { type: 'PONG', ts: Date.now() });
  },

  // Join or create a room
  JOIN_ROOM(ws, msg) {
    const { roomId, userName, color, avatar } = msg;

    let room = roomId ? getRoom(roomId) : null;
    if (roomId && !room) {
      return sendTo(ws, { type: 'ERROR', code: 'ROOM_NOT_FOUND',
        message: `Room "${roomId}" not found. Check your invite code.` });
    }
    if (!room) {
      room = createRoom(msg.boardName || 'My Board');
    }

    ws.roomId    = room.id;
    ws.userId    = msg.userId || uuidv4().slice(0,8);
    ws.userName  = (userName || 'Anonymous').slice(0, 40);
    ws.userColor = color  || '#3B82F6';
    ws.userAvatar= avatar || null;
    ws.dragging  = null;
    ws.typing    = null;
    ws.editing   = null;
    ws.cursor    = null;

    log.info(`${ws.userName} joined room ${room.id}`);

    // Send full board state
    sendTo(ws, {
      type: 'ROOM_JOINED',
      room: { id: room.id, name: room.name, createdAt: room.createdAt },
      columns: room.columns,
      cards:   room.cards,
      me:      { userId: ws.userId, userName: ws.userName, color: ws.userColor },
      users:   roomPresence(room.id),
    });

    // Tell others
    broadcastToRoom(room.id, {
      type: 'USER_JOINED',
      userId:   ws.userId,
      userName: ws.userName,
      color:    ws.userColor,
      users:    roomPresence(room.id),
    }, ws.socketId);
  },

  CARD_CREATE(ws, msg) {
    const room = getRoom(ws.roomId);
    if (!room) return sendTo(ws, { type: 'ERROR', message: 'Not in a room' });

    const { columnId, title, description = '', priority = 'medium', tags = [] } = msg;
    const col = room.columns.find(c => c.id === columnId);
    if (!col) return sendTo(ws, { type: 'ERROR', message: 'Column not found' });

    const id   = `card-${uuidv4().slice(0,8)}`;
    const card = {
      id, title: (title||'').slice(0,300),
      description: (description||'').slice(0,5000),
      priority: ['urgent','high','medium','low'].includes(priority) ? priority : 'medium',
      tags: Array.isArray(tags) ? tags.slice(0,10) : [],
      dueDate: msg.dueDate || null,
      assignees: [],
      comments: [],
      checklist: [],
      version: 1, createdAt: Date.now(), updatedAt: Date.now(),
      createdBy: ws.userName,
    };
    room.cards[id] = card;
    col.cardIds.push(id);

    const out = { type: 'CARD_CREATED', card, columnId,
      userId: ws.userId, userName: ws.userName, ts: Date.now() };
    broadcastToRoom(room.id, out);
    sendTo(ws, { type: 'OP_OK', opId: msg.opId, card });
  },

  CARD_UPDATE(ws, msg) {
    const room = getRoom(ws.roomId);
    if (!room) return;
    const card = room.cards[msg.cardId];
    if (!card) return sendTo(ws, { type: 'ERROR', message: 'Card not found' });

    const SAFE = new Set(['title','description','priority','tags','dueDate','assignees','checklist']);
    const changes = Object.fromEntries(Object.entries(msg.changes||{}).filter(([k])=>SAFE.has(k)));
    Object.assign(card, changes, { version: card.version+1, updatedAt: Date.now() });

    const out = { type: 'CARD_UPDATED', cardId: msg.cardId, changes, newVersion: card.version,
      userId: ws.userId, userName: ws.userName, ts: Date.now() };
    broadcastToRoom(room.id, out, ws.socketId);
    sendTo(ws, { type: 'OP_OK', opId: msg.opId, newVersion: card.version });
  },

  CARD_DELETE(ws, msg) {
    const room = getRoom(ws.roomId);
    if (!room) return;
    const { cardId, columnId } = msg;
    if (!room.cards[cardId]) return;
    delete room.cards[cardId];
    const col = room.columns.find(c => c.id === columnId);
    if (col) col.cardIds = col.cardIds.filter(id => id !== cardId);

    const out = { type: 'CARD_DELETED', cardId, columnId,
      userId: ws.userId, userName: ws.userName, ts: Date.now() };
    broadcastToRoom(room.id, out, ws.socketId);
    sendTo(ws, { type: 'OP_OK', opId: msg.opId });
  },

  CARD_MOVE(ws, msg) {
    const room = getRoom(ws.roomId);
    if (!room) return;
    const { cardId, fromColumnId, toColumnId, toIndex, version } = msg;
    const card    = room.cards[cardId];
    const fromCol = room.columns.find(c => c.id === fromColumnId);
    const toCol   = room.columns.find(c => c.id === toColumnId);
    if (!card || !fromCol || !toCol) return sendTo(ws, { type:'ERROR', message:'Not found' });

    if (version !== undefined && card.version !== version) {
      return sendTo(ws, { type: 'CONFLICT_REJECT', opId: msg.opId, cardId,
        serverVersion: card.version, currentColumns: room.columns });
    }

    const enriched = { ...msg, serverTs: Date.now(), userId: ws.userId, userName: ws.userName };
    const { conflict, message } = resolveMove(room, enriched);
    if (conflict) sendTo(ws, { type: 'CONFLICT_NOTICE', message });

    fromCol.cardIds = fromCol.cardIds.filter(id => id !== cardId);
    const safeIdx = Math.max(0, Math.min(toIndex ?? toCol.cardIds.length, toCol.cardIds.length));
    toCol.cardIds.splice(safeIdx, 0, cardId);
    card.version++; card.updatedAt = Date.now();

    room.opLog.push(enriched);
    if (room.opLog.length > 200) room.opLog.shift();

    const out = { type: 'CARD_MOVED', cardId, fromColumnId, toColumnId, toIndex: safeIdx,
      newVersion: card.version, userId: ws.userId, userName: ws.userName, ts: Date.now() };
    broadcastToRoom(room.id, out, ws.socketId);
    sendTo(ws, { type: 'OP_OK', opId: msg.opId, newVersion: card.version });
  },

  COLUMN_CREATE(ws, msg) {
    const room = getRoom(ws.roomId);
    if (!room) return;
    const col = { id: `col-${uuidv4().slice(0,8)}`, title: msg.title||'New Section',
      color: msg.color||'#F1F5F9', cardIds: [] };
    room.columns.push(col);
    const out = { type: 'COLUMN_CREATED', column: col, userId: ws.userId, userName: ws.userName };
    broadcastToRoom(room.id, out, ws.socketId);
    sendTo(ws, { type: 'OP_OK', opId: msg.opId, column: col });
  },

  COLUMN_UPDATE(ws, msg) {
    const room = getRoom(ws.roomId);
    if (!room) return;
    const col = room.columns.find(c => c.id === msg.columnId);
    if (!col) return;
    if (msg.title) col.title = msg.title.slice(0,100);
    if (msg.color) col.color = msg.color;
    const out = { type: 'COLUMN_UPDATED', columnId: msg.columnId, title: col.title, color: col.color };
    broadcastToRoom(room.id, out, ws.socketId);
    sendTo(ws, { type: 'OP_OK', opId: msg.opId });
  },

  COLUMN_DELETE(ws, msg) {
    const room = getRoom(ws.roomId);
    if (!room) return;
    const idx = room.columns.findIndex(c => c.id === msg.columnId);
    if (idx === -1) return;
    const col = room.columns[idx];
    col.cardIds.forEach(id => delete room.cards[id]);
    room.columns.splice(idx, 1);
    const out = { type: 'COLUMN_DELETED', columnId: msg.columnId };
    broadcastToRoom(room.id, out, ws.socketId);
    sendTo(ws, { type: 'OP_OK', opId: msg.opId });
  },

  COMMENT_ADD(ws, msg) {
    const room = getRoom(ws.roomId);
    if (!room) return;
    const card = room.cards[msg.cardId];
    if (!card) return;
    const comment = { id: uuidv4().slice(0,8), text: msg.text.slice(0,2000),
      userId: ws.userId, userName: ws.userName, color: ws.userColor, ts: Date.now() };
    if (!card.comments) card.comments = [];
    card.comments.push(comment);
    const out = { type: 'COMMENT_ADDED', cardId: msg.cardId, comment };
    broadcastToRoom(room.id, out, ws.socketId);
    sendTo(ws, { type: 'OP_OK', opId: msg.opId, comment });
  },

  CHECKLIST_TOGGLE(ws, msg) {
    const room = getRoom(ws.roomId);
    if (!room) return;
    const card = room.cards[msg.cardId];
    if (!card || !card.checklist) return;
    const item = card.checklist.find(i => i.id === msg.itemId);
    if (item) { item.done = !item.done; item.doneBy = ws.userName; item.doneAt = Date.now(); }
    const out = { type: 'CHECKLIST_TOGGLED', cardId: msg.cardId, itemId: msg.itemId, done: item?.done };
    broadcastToRoom(room.id, out, ws.socketId);
    sendTo(ws, { type: 'OP_OK', opId: msg.opId });
  },

  BOARD_RENAME(ws, msg) {
    const room = getRoom(ws.roomId);
    if (!room) return;
    room.name = (msg.name||'').slice(0,100) || room.name;
    const out = { type: 'BOARD_RENAMED', name: room.name, userId: ws.userId };
    broadcastToRoom(room.id, out, ws.socketId);
    sendTo(ws, { type: 'OP_OK', opId: msg.opId });
  },

  // Presence
  CURSOR(ws, msg) {
    ws.cursor = msg.cursor;
    broadcastToRoom(ws.roomId, { type:'CURSOR', userId:ws.userId, cursor:msg.cursor }, ws.socketId);
  },
  TYPING_START(ws, msg) {
    ws.typing = msg.cardId;
    broadcastToRoom(ws.roomId, { type:'TYPING_START', userId:ws.userId, cardId:msg.cardId }, ws.socketId);
  },
  TYPING_STOP(ws) {
    ws.typing = null;
    broadcastToRoom(ws.roomId, { type:'TYPING_STOP', userId:ws.userId }, ws.socketId);
  },
  DRAG_START(ws, msg) {
    ws.dragging = msg.cardId;
    broadcastToRoom(ws.roomId, { type:'DRAG_START', userId:ws.userId, cardId:msg.cardId, users:roomPresence(ws.roomId) }, ws.socketId);
  },
  DRAG_END(ws) {
    ws.dragging = null;
    broadcastToRoom(ws.roomId, { type:'DRAG_END', userId:ws.userId, users:roomPresence(ws.roomId) }, ws.socketId);
  },
  EDITING_START(ws, msg) {
    ws.editing = msg.cardId;
    broadcastToRoom(ws.roomId, { type:'EDITING_START', userId:ws.userId, userName:ws.userName, cardId:msg.cardId }, ws.socketId);
  },
  EDITING_STOP(ws) {
    ws.editing = null;
    broadcastToRoom(ws.roomId, { type:'EDITING_STOP', userId:ws.userId }, ws.socketId);
  },
};

// ── WS connection ─────────────────────────────────────────────
wss.on('connection', ws => {
  ws.isAlive  = true;   // MUST be set immediately — heartbeat checks this
  ws.socketId = uuidv4();
  ws.roomId   = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return sendTo(ws, { type:'ERROR', message:'Invalid JSON' }); }

    const h = handlers[msg?.type];
    if (!h) return;
    try { h(ws, msg); }
    catch (err) { log.error(`Handler ${msg.type}:`, err); sendTo(ws, { type:'ERROR', message:'Server error' }); }
  });

  ws.on('error', err => log.error('Socket error:', err.message));

  ws.on('close', code => {
    if (!ws.roomId) return;
    log.info(`${ws.userName||'?'} left room ${ws.roomId} (${code})`);
    broadcastToRoom(ws.roomId, {
      type: 'USER_LEFT', userId: ws.userId,
      users: roomPresence(ws.roomId).filter(u => u.userId !== ws.userId),
    }, ws.socketId);
  });
});

// ── Heartbeat (JSON-level, 25s) ───────────────────────────────
// Browser WebSocket cannot respond to protocol-level WS pings from JS,
// so we use application-level JSON PING/PONG instead.
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { log.info(`Stale connection terminated`); return ws.terminate(); }
    ws.isAlive = false; // will be reset when client sends PING
  });
}, 25_000);

wss.on('close', () => clearInterval(heartbeat));

// ── REST API ──────────────────────────────────────────────────
app.post('/api/rooms', (req, res) => {
  const room = createRoom(req.body?.name || 'My Board');
  res.json({ roomId: room.id, name: room.name });
});

app.get('/api/rooms/:id', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ id: room.id, name: room.name, memberCount: roomPresence(room.id).length });
});

app.get('/health', (_, res) => res.json({
  status: 'ok', rooms: rooms.size, connections: wss.clients.size, uptime: Math.floor(process.uptime()),
}));

// ── Serve built frontend ──────────────────────────────────────
const DIST = path.join(__dirname, '../client/dist');
app.use(express.static(DIST));
function getWsUrl(req) {
  const host = req.headers.host;
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
  return `${proto}://${host}`;
}

app.get('*', (req, res) => {
  res.sendFile(path.join(DIST, 'index.html'), (err) => {
    if (err) {
      res.json({
        server: 'ok',
        ws: getWsUrl(req)
      });
    }
  });
});

// ── Graceful shutdown ─────────────────────────────────────────
process.on('SIGTERM', () => {
  clearInterval(heartbeat);
  wss.clients.forEach(ws => ws.close(1001, 'Shutdown'));
  server.close(() => process.exit(0));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  log.info(`Kanban Pro server on :${PORT}`);
  log.info(`Health: http://localhost:${PORT}/health`);
  log.info(`WS: dynamic (based on request host)`);
});
