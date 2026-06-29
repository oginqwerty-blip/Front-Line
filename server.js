const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const CLIENT_TTL_MS = 60000;
const ROOM_TTL_MS = 1000 * 60 * 60 * 6;

const rooms = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

function normalizeIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  if (raw === "::1") return "127.0.0.1";
  if (raw.startsWith("::ffff:")) return raw.slice(7);
  return raw;
}

function roomIdFromUrl(url) {
  const raw = url.searchParams.get("room") || "LOCAL";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24).toUpperCase() || "LOCAL";
}

function clientIdFromUrl(url) {
  const raw = url.searchParams.get("clientId") || "";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function getRoom(roomId) {
  const existing = rooms.get(roomId);
  if (existing) return existing;
  const room = {
    clients: new Map(),
    matchState: null,
    matchVersion: 0,
    matchUpdatedAt: 0,
    touchedAt: Date.now(),
  };
  rooms.set(roomId, room);
  return room;
}

function pruneRoom(room) {
  const now = Date.now();
  for (const [clientId, client] of room.clients.entries()) {
    if (now - client.lastSeen > CLIENT_TTL_MS) room.clients.delete(clientId);
  }
}

function pruneRooms() {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    pruneRoom(room);
    if (room.clients.size === 0 && now - room.touchedAt > ROOM_TTL_MS) rooms.delete(roomId);
  }
}

function clientList(room) {
  pruneRoom(room);
  return [...room.clients.values()]
    .sort((a, b) => a.firstSeen - b.firstSeen)
    .map((client, index) => ({
      clientId: client.clientId,
      ip: client.ip,
      seat: index === 0 ? "North" : index === 1 ? "South" : "Spectator",
      firstSeen: client.firstSeen,
      lastSeen: client.lastSeen,
    }));
}

function localUrls() {
  const urls = [`http://localhost:${PORT}/`];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${PORT}/`);
      }
    }
  }
  return [...new Set(urls)];
}

function sendJson(res, payload) {
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, res, callback) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 2_000_000) {
      res.writeHead(413);
      res.end("Payload too large");
      req.destroy();
    }
  });
  req.on("end", () => {
    try {
      callback(body ? JSON.parse(body) : {});
    } catch (error) {
      res.writeHead(400);
      res.end("Invalid JSON");
    }
  });
}

function registerClient(req, res, url) {
  const roomId = roomIdFromUrl(url);
  const clientId = clientIdFromUrl(url);
  if (!clientId) {
    res.writeHead(400);
    res.end("Missing clientId");
    return;
  }

  pruneRooms();
  const room = getRoom(roomId);
  const ip = normalizeIp(req);
  const now = Date.now();
  const previous = room.clients.get(clientId);
  room.clients.set(clientId, {
    clientId,
    ip,
    firstSeen: previous?.firstSeen || now,
    lastSeen: now,
  });
  room.touchedAt = now;

  const list = clientList(room);
  const self = list.find((client) => client.clientId === clientId);
  sendJson(res, {
    room: roomId,
    self,
    clients: list,
    ready: list.filter((client) => client.seat !== "Spectator").length >= 2,
    urls: localUrls(),
  });
}

function sendMatchState(res, url) {
  const room = getRoom(roomIdFromUrl(url));
  room.touchedAt = Date.now();
  sendJson(res, {
    room: roomIdFromUrl(url),
    state: room.matchState,
    version: room.matchVersion,
    updatedAt: room.matchUpdatedAt,
  });
}

function updateMatchState(req, res, url) {
  const roomId = roomIdFromUrl(url);
  const room = getRoom(roomId);
  readJsonBody(req, res, (payload) => {
    if (!payload || typeof payload.state !== "object" || payload.state === null) {
      res.writeHead(400);
      res.end("Missing state");
      return;
    }
    room.matchState = payload.state;
    room.matchVersion += 1;
    room.matchUpdatedAt = Date.now();
    room.touchedAt = room.matchUpdatedAt;
    sendJson(res, {
      room: roomId,
      state: room.matchState,
      version: room.matchVersion,
      updatedAt: room.matchUpdatedAt,
    });
  });
}

function serveStatic(req, res, url) {
  const requestPath = url.pathname;
  const relativePath = requestPath === "/"
    ? "index.html"
    : decodeURIComponent(requestPath).replace(/^[/\\]+/, "");
  const filePath = path.resolve(ROOT, relativePath);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/register" || url.pathname === "/api/clients") {
    registerClient(req, res, url);
    return;
  }
  if (url.pathname === "/api/state") {
    if (req.method === "POST") {
      updateMatchState(req, res, url);
    } else {
      sendMatchState(res, url);
    }
    return;
  }
  serveStatic(req, res, url);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Front-Line local server is running.");
  console.log("Open a URL with ?room=ROOMID to create or join a match room.");
  for (const url of localUrls()) console.log(`  ${url}`);
});
