import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
  },
});

const rooms = new Map();

function logServer(message, details = "") {
  if (details) {
    console.log(`[Socket.IO] ${message}`, details);
    return;
  }

  console.log(`[Socket.IO] ${message}`);
}

function createRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function normalizeRoomId(roomId) {
  return String(roomId ?? "").trim().toUpperCase();
}

function isRoomActive(roomId) {
  return rooms.get(roomId)?.active === true;
}

function roomSize(roomId) {
  return io.sockets.adapter.rooms.get(roomId)?.size ?? 0;
}

function relay(roomId, event, payload, socket) {
  logServer(`Relaying ${event}`, { roomId, from: socket.id });
  socket.to(roomId).emit(event, { ...payload, senderId: socket.id });
}

function markRoomInactive(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    room.active = false;
  }
}

function endRoom(roomId, reason = "ended") {
  if (!roomId || !isRoomActive(roomId)) {
    return false;
  }

  logServer("Ending room", { roomId, reason });
  markRoomInactive(roomId);

  const memberIds = Array.from(io.sockets.adapter.rooms.get(roomId) ?? []);

  memberIds.forEach((socketId) => {
    const member = io.sockets.sockets.get(socketId);

    if (!member) {
      return;
    }

    member.emit("room-ended", { roomId, reason });
    member.leave(roomId);

    if (member.data.roomId === roomId) {
      member.data.roomId = null;
    }
  });

  rooms.delete(roomId);
  return true;
}

app.get("/", (_req, res) => {
  const distPath = path.join(__dirname, "dist");

  if (existsSync(path.join(distPath, "index.html"))) {
    res.sendFile(path.join(distPath, "index.html"));
    return;
  }

  res.type("html").send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>WebRTC Studio</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            font-family: Arial, sans-serif;
            background: #07111d;
            color: #ecf4ff;
            padding: 24px;
            text-align: center;
          }
          .card {
            max-width: 640px;
            padding: 28px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            background: rgba(9, 16, 29, 0.9);
          }
          code {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.08);
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>WebRTC Studio server is running</h1>
          <p>This port is the Socket.IO backend, not the Vite UI.</p>
          <p>Open the frontend at <code>http://localhost:5173</code> while developing.</p>
          <p>For production, run <code>npm run build</code> and restart this server.</p>
        </div>
      </body>
    </html>
  `);
});

io.on("connection", (socket) => {
  socket.data.roomId = null;
  logServer("Client connected", { socketId: socket.id });

  socket.on("create-room", (_payload, ack) => {
    if (socket.data.roomId) {
      endRoom(socket.data.roomId, "replaced");
    }

    let roomId = createRoomCode();
    while (rooms.has(roomId)) {
      roomId = createRoomCode();
    }

    rooms.set(roomId, {
      active: true,
      createdAt: Date.now(),
      hostSocketId: socket.id,
    });

    socket.join(roomId);
    socket.data.roomId = roomId;

    logServer("Room created", { roomId, hostSocketId: socket.id });
    ack?.({ ok: true, roomId });
  });

  socket.on("join-room", (payload, ack) => {
    const roomId = normalizeRoomId(payload?.roomId);

    if (!roomId) {
      ack?.({ ok: false, error: "Enter a valid room code." });
      return;
    }

    if (!isRoomActive(roomId)) {
      ack?.({ ok: false, error: "That room code is no longer active." });
      return;
    }

    if (roomSize(roomId) >= 2) {
      ack?.({ ok: false, error: "That room already has two users." });
      return;
    }

    if (socket.data.roomId && socket.data.roomId !== roomId) {
      endRoom(socket.data.roomId, "replaced");
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    logServer("Room joined", { roomId, socketId: socket.id, size: roomSize(roomId) });
    ack?.({ ok: true, roomId });
    socket.to(roomId).emit("peer-joined", { roomId, socketId: socket.id });
  });

  socket.on("webrtc-offer", (payload) => {
    const roomId = normalizeRoomId(payload?.roomId ?? socket.data.roomId);

    if (!roomId || !payload?.offer) {
      return;
    }

    relay(roomId, "webrtc-offer", { offer: payload.offer }, socket);
  });

  socket.on("webrtc-answer", (payload) => {
    const roomId = normalizeRoomId(payload?.roomId ?? socket.data.roomId);

    if (!roomId || !payload?.answer) {
      return;
    }

    relay(roomId, "webrtc-answer", { answer: payload.answer }, socket);
  });

  socket.on("webrtc-ice-candidate", (payload) => {
    const roomId = normalizeRoomId(payload?.roomId ?? socket.data.roomId);

    if (!roomId || !payload?.candidate) {
      return;
    }

    relay(roomId, "webrtc-ice-candidate", { candidate: payload.candidate }, socket);
  });

  socket.on("chat-message", (payload) => {
    const roomId = normalizeRoomId(payload?.roomId ?? socket.data.roomId);

    if (!roomId || !payload?.message?.trim()) {
      return;
    }

    relay(roomId, "receive-message", {
      message: payload.message,
      senderName: payload.senderName || "Peer",
      senderId: socket.id,
      time: payload.time || new Date().toISOString(),
    }, socket);
  });

  socket.on("typing", (payload) => {
    const roomId = normalizeRoomId(payload?.roomId ?? socket.data.roomId);

    if (!roomId) {
      return;
    }

    relay(roomId, "typing", { senderName: payload.senderName || "Peer" }, socket);
  });

  socket.on("stop-typing", (payload) => {
    const roomId = normalizeRoomId(payload?.roomId ?? socket.data.roomId);

    if (!roomId) {
      return;
    }

    relay(roomId, "stop-typing", { senderName: payload.senderName || "Peer" }, socket);
  });

  socket.on("audio-toggle", (payload) => {
    const roomId = normalizeRoomId(payload?.roomId ?? socket.data.roomId);

    if (!roomId) {
      return;
    }

    relay(roomId, "audio-toggle", { enabled: !!payload?.enabled }, socket);
  });

  socket.on("video-toggle", (payload) => {
    const roomId = normalizeRoomId(payload?.roomId ?? socket.data.roomId);

    if (!roomId) {
      return;
    }

    relay(roomId, "video-toggle", { enabled: !!payload?.enabled }, socket);
  });

  socket.on("file-upload", (payload) => {
    const roomId = normalizeRoomId(payload?.roomId ?? socket.data.roomId);

    if (!roomId || !payload?.fileId || !payload?.kind) {
      return;
    }

    relay(roomId, "file-upload", payload, socket);
  });

  socket.on("screen-share-start", (payload) => {
    const roomId = normalizeRoomId(payload?.roomId ?? socket.data.roomId);

    if (!roomId) {
      return;
    }

    relay(roomId, "screen-share-start", { active: true }, socket);
  });

  socket.on("screen-share-stop", (payload) => {
    const roomId = normalizeRoomId(payload?.roomId ?? socket.data.roomId);

    if (!roomId) {
      return;
    }

    relay(roomId, "screen-share-stop", { active: false }, socket);
  });

  socket.on("leave-room", (payload) => {
    const roomId = normalizeRoomId(payload?.roomId ?? socket.data.roomId);

    if (!roomId) {
      return;
    }

    logServer("Room left", { roomId, socketId: socket.id });
    endRoom(roomId, "left");
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;

    if (roomId) {
      logServer("Socket disconnected", { roomId, socketId: socket.id });
      endRoom(roomId, "disconnected");
    } else {
      logServer("Socket disconnected", { socketId: socket.id });
    }
  });
});

if (process.env.NODE_ENV === "production") {
  const distPath = path.join(__dirname, "dist");

  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

const port = process.env.PORT || 3001;

httpServer.listen(port, () => {
  console.log(`Socket.IO server listening on http://localhost:${port}`);
});
