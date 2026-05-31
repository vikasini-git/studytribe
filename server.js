'use strict';
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const path       = require('path');
const { v4: uuid } = require('uuid');
const db         = require('./db');

const app    = express();
const server = http.createServer(app);
const SECRET = process.env.JWT_SECRET || 'studytribe_secret';
const PORT   = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit:'5mb' }));
app.use(express.urlencoded({ extended:false }));
app.options('*', cors());
app.use(express.static(path.join(__dirname,'public')));

app.use('/api/auth',    require('./routes/auth'));
app.use('/api/groups',  require('./routes/groups'));
app.use('/api/profile', require('./routes/profile'));

app.get('/api/health', (_,res) => res.json({ status:'ok', uptime:Math.floor(process.uptime()) }));

app.use('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error:'Not found.' });
  const map = { '/':'index.html', '/login':'login.html', '/signup':'signup.html', '/dashboard':'dashboard.html' };
  res.sendFile(path.join(__dirname,'public', map[req.path]||'index.html'));
});

// ── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(server, { cors:{ origin:'*', methods:['GET','POST'] } });
const roomPresence = new Map();

io.use((socket, next) => {
  try { socket.user = jwt.verify(socket.handshake.auth?.token, SECRET); next(); }
  catch { next(new Error('Auth failed.')); }
});

io.on('connection', socket => {
  console.log(`[+] ${socket.user.name}`);

  socket.on('join_room', ({ groupId }) => {
    if (!groupId) return;
    const group = db.getGroupById(groupId);
    if (!group) { socket.emit('error',{ message:'Group not found.' }); return; }

    if (socket.currentRoom && socket.currentRoom !== groupId) leave(socket, socket.currentRoom, false);

    socket.join(groupId);
    socket.currentRoom = groupId;
    if (!roomPresence.has(groupId)) roomPresence.set(groupId, new Map());
    roomPresence.get(groupId).set(socket.id, { userId:socket.user.id, userName:socket.user.name });

    socket.emit('chat_history', db.getMessages(groupId, 100));
    broadcastPresence(groupId);
    socket.to(groupId).emit('system_message',{ text:`${socket.user.name} joined the room.`, time:new Date().toISOString() });
  });

  socket.on('send_message', ({ groupId, text }) => {
    if (!groupId || !text?.trim()) return;
    if (!socket.rooms.has(groupId)) { socket.emit('error',{ message:'Join the room first.' }); return; }
    const msg = db.saveMessage({ id:uuid(), group_id:groupId, student_id:socket.user.id,
      user_name:socket.user.name, text:text.trim().slice(0,2000) });
    io.to(groupId).emit('new_message', msg);
  });

  socket.on('typing', ({ groupId, isTyping }) => {
    if (groupId) socket.to(groupId).emit('user_typing',{ userId:socket.user.id, userName:socket.user.name, isTyping:!!isTyping });
  });

  socket.on('leave_room', ({ groupId }) => { if (groupId) leave(socket, groupId, true); });
  socket.on('disconnect', () => { if (socket.currentRoom) leave(socket, socket.currentRoom, true); console.log(`[-] ${socket.user.name}`); });
});

function leave(socket, groupId, notify) {
  socket.leave(groupId);
  socket.currentRoom = null;
  const room = roomPresence.get(groupId);
  if (room) { room.delete(socket.id); if (!room.size) roomPresence.delete(groupId); }
  broadcastPresence(groupId);
  if (notify) socket.to(groupId).emit('system_message',{ text:`${socket.user.name} left.`, time:new Date().toISOString() });
}

function broadcastPresence(groupId) {
  const users = [...(roomPresence.get(groupId)?.values()??[])];
  io.to(groupId).emit('presence_update',{ groupId, onlineCount:users.length, onlineUsers:users });
}

db.init().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🎓  StudyTribe  →  http://localhost:${PORT}\n`);
  });
}).catch(e => { console.error('[FATAL]', e); process.exit(1); });

app.get('/api/admin/users', (req, res) => {
  try {
    const users = db.getAllStudents();
    res.json(users);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});