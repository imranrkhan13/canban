# Kanban Pro — Real-time Collaborative Board

## Quick Start (2 terminals)

### Terminal 1 — Server
```bash
cd server
npm install
npm start
# → ws://localhost:3001
```

### Terminal 2 — Client
```bash
cd client
npm install
npm run dev
# → http://localhost:3000
```

## Invite Collaborators

1. Open `http://localhost:3000` — enter your name & create a board
2. Click **Invite** in the header (or click the room code)
3. Share the **8-character room code** or the **direct link**
4. Collaborator opens the link, enters their name, joins instantly

## Features
- Room-based collaboration with invite codes
- Real-time drag & drop with presence indicators
- Card modal: priority, description, labels, due date, checklist, comments
- Add / rename / delete columns
- Search & filter by priority
- Activity feed
- Conflict resolution (last-write-wins)
- Reconnects automatically if server restarts

## Folder Structure
```
kanban-pro/
  server/
    index.js        ← WebSocket + Express server
    package.json
  client/
    src/
      App.jsx       ← Complete React frontend (single file)
      main.jsx
    index.html
    package.json
    vite.config.js
```
