const http = require("http");
const { randomUUID } = require("crypto");
const { readFile } = require("fs/promises");
const { readFileSync } = require("fs");
const os = require("os");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const PUBLIC_URL_FILE = path.join(__dirname, "public-url.txt");
const rooms = new Map();
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 750);
const WIN_PATTERNS = {
  anyLine: "Cualquier linea",
  horizontal: "Linea horizontal",
  vertical: "Linea vertical",
  diagonal: "Diagonal",
  corners: "Cuatro esquinas",
  fullCard: "Carton lleno"
};
const CARD_STYLES = new Set(["neon", "clasico", "fiesta", "diamante", "noche"]);
const NUMBER_POOLS = new Set([75, 90, 100]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function makeCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function numberPool(value) {
  const next = Number(value || 75);
  return NUMBER_POOLS.has(next) ? next : 75;
}

function makeCard(maxNumber = 75) {
  const rangeSize = Math.floor(maxNumber / 5);
  const ranges = Array.from({ length: 5 }, (_, index) => {
    const min = index * rangeSize + 1;
    const max = index === 4 ? maxNumber : (index + 1) * rangeSize;
    return [min, max];
  });
  const columns = ranges.map(([min, max]) => {
    const values = [];
    while (values.length < 5) {
      const next = min + Math.floor(Math.random() * (max - min + 1));
      if (!values.includes(next)) values.push(next);
    }
    return values;
  });

  const card = [];
  for (let row = 0; row < 5; row += 1) {
    const line = [];
    for (let col = 0; col < 5; col += 1) {
      line.push(row === 2 && col === 2 ? "FREE" : columns[col][row]);
    }
    card.push(line);
  }
  return card;
}

function publicRoom(room) {
  return {
    id: room.id,
    code: room.code,
    title: room.title,
    theme: room.theme,
    cardStyle: room.cardStyle,
    maxNumber: room.maxNumber,
    called: room.called,
    current: room.current,
    playerCount: room.players.size,
    winners: room.winners,
    winPattern: room.winPattern,
    winPatternLabel: WIN_PATTERNS[room.winPattern] || WIN_PATTERNS.anyLine,
    maxPlayers: room.maxPlayers,
    createdAt: room.createdAt
  };
}

function publicPlayers(room) {
  return Array.from(room.players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    card: player.card,
    joinedAt: player.joinedAt
  }));
}

function localNetworkOrigins(hostHeader) {
  const port = (hostHeader || `localhost:${PORT}`).split(":")[1] || PORT;
  const origins = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        origins.push(`http://${address.address}:${port}`);
      }
    }
  }
  return origins;
}

function requestOrigin(req) {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${host}`;
}

function publicUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  try {
    return readFileSync(PUBLIC_URL_FILE, "utf8").trim().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function shareOrigin(req) {
  return publicUrl() || requestOrigin(req);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return {};
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function broadcast(room) {
  const data = `data: ${JSON.stringify(publicRoom(room))}\n\n`;
  for (const client of room.clients) {
    if (client.destroyed || client.writableEnded) {
      room.clients.delete(client);
    } else {
      client.write(data);
    }
  }
  stopHeartbeatIfEmpty(room);
}

function startHeartbeat(room) {
  if (room.heartbeat) return;
  room.heartbeat = setInterval(() => {
    for (const client of room.clients) {
      if (client.destroyed || client.writableEnded) {
        room.clients.delete(client);
      } else {
        client.write(`: conectado ${Date.now()}\n\n`);
      }
    }
    stopHeartbeatIfEmpty(room);
  }, 25000);
  room.heartbeat.unref?.();
}

function stopHeartbeatIfEmpty(room) {
  if (room.clients.size || !room.heartbeat) return;
  clearInterval(room.heartbeat);
  room.heartbeat = null;
}

function requireRoom(res, id) {
  const room = rooms.get(id);
  if (!room) sendJson(res, 404, { error: "Sala no encontrada." });
  return room;
}

function requireHost(res, room, pin) {
  if (room.hostPin !== pin) {
    sendJson(res, 403, { error: "PIN de anfitrion invalido." });
    return false;
  }
  return true;
}

function getLines(card) {
  const horizontal = [...card];
  const vertical = [];
  for (let col = 0; col < 5; col += 1) vertical.push(card.map((row) => row[col]));
  const diagonal = [
    card.map((row, index) => row[index]),
    card.map((row, index) => row[4 - index])
  ];
  const corners = [[card[0][0], card[0][4], card[4][0], card[4][4]]];
  const fullCard = [card.flat()];
  return { horizontal, vertical, diagonal, corners, fullCard };
}

function hasBingo(card, called, pattern = "anyLine") {
  const marked = (value) => value === "FREE" || called.includes(value);
  const linesByPattern = getLines(card);
  const lines =
    pattern === "anyLine"
      ? [...linesByPattern.horizontal, ...linesByPattern.vertical, ...linesByPattern.diagonal]
      : linesByPattern[pattern] || [
          ...linesByPattern.horizontal,
          ...linesByPattern.vertical,
          ...linesByPattern.diagonal
        ];
  return lines.some((line) => line.every(marked));
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/network") {
    sendJson(res, 200, {
      publicOrigin: publicUrl(),
      currentOrigin: requestOrigin(req),
      origins: localNetworkOrigins(req.headers.host),
      note: "Estos links funcionan solo para personas conectadas a la misma red WiFi/LAN."
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readBody(req);
    const room = {
      id: randomUUID(),
      code: makeCode(),
      hostPin: makeCode(),
      title: String(body.title || "Bingo Flash").slice(0, 50),
      theme: String(body.theme || "cosmic").slice(0, 20),
      cardStyle: CARD_STYLES.has(body.cardStyle) ? body.cardStyle : "neon",
      maxNumber: numberPool(body.maxNumber),
      winPattern: WIN_PATTERNS[body.winPattern] ? body.winPattern : "anyLine",
      called: [],
      current: null,
      players: new Map(),
      clients: new Set(),
      heartbeat: null,
      winners: [],
      maxPlayers: Number.isFinite(DEFAULT_MAX_PLAYERS) ? DEFAULT_MAX_PLAYERS : 750,
      createdAt: new Date().toISOString()
    };
    rooms.set(room.id, room);
    const origin = shareOrigin(req);
    sendJson(res, 201, {
      room: publicRoom(room),
      links: {
        host: `${origin}/host.html?room=${room.id}&pin=${room.hostPin}`,
        player: `${origin}/play.html?room=${room.id}`
      }
    });
    return;
  }

  const codeMatch = url.pathname.match(/^\/api\/rooms\/code\/([A-Z0-9]+)$/i);
  if (req.method === "GET" && codeMatch) {
    const code = codeMatch[1].toUpperCase();
    const room = Array.from(rooms.values()).find((entry) => entry.code === code);
    if (!room) {
      sendJson(res, 404, { error: "Codigo de sala no encontrado." });
      return;
    }
    sendJson(res, 200, { room: publicRoom(room) });
    return;
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)(?:\/([^/]+))?$/);
  if (!roomMatch) {
    sendJson(res, 404, { error: "Ruta API no encontrada." });
    return;
  }

  const [, roomId, action] = roomMatch;
  const room = requireRoom(res, roomId);
  if (!room) return;

  if (req.method === "GET" && !action) {
    sendJson(res, 200, { room: publicRoom(room) });
    return;
  }

  if (req.method === "POST" && action === "settings") {
    const body = await readBody(req);
    if (!requireHost(res, room, body.pin)) return;
    if (body.winPattern && !WIN_PATTERNS[body.winPattern]) {
      sendJson(res, 422, { error: "Tipo de ganador invalido." });
      return;
    }
    if (body.winPattern) room.winPattern = body.winPattern;
    if (body.cardStyle && CARD_STYLES.has(body.cardStyle)) room.cardStyle = body.cardStyle;
    room.winners = [];
    broadcast(room);
    sendJson(res, 200, { room: publicRoom(room) });
    return;
  }

  if (req.method === "POST" && action === "players") {
    const body = await readBody(req);
    if (!requireHost(res, room, body.pin)) return;
    sendJson(res, 200, { players: publicPlayers(room), room: publicRoom(room) });
    return;
  }

  if (req.method === "GET" && action === "events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify(publicRoom(room))}\n\n`);
    room.clients.add(res);
    startHeartbeat(room);
    req.on("close", () => {
      room.clients.delete(res);
      stopHeartbeatIfEmpty(room);
    });
    return;
  }

  if (req.method === "POST" && action === "join") {
    if (room.players.size >= room.maxPlayers) {
      sendJson(res, 409, { error: "La sala esta llena." });
      return;
    }
    const body = await readBody(req);
    const player = {
      id: randomUUID(),
      name: String(body.name || "Jugador").slice(0, 32),
      card: makeCard(room.maxNumber),
      joinedAt: new Date().toISOString()
    };
    room.players.set(player.id, player);
    broadcast(room);
    sendJson(res, 201, { player, room: publicRoom(room) });
    return;
  }

  if (req.method === "POST" && action === "draw") {
    const body = await readBody(req);
    if (!requireHost(res, room, body.pin)) return;
    const pool = Array.from({ length: room.maxNumber }, (_, i) => i + 1).filter(
      (n) => !room.called.includes(n)
    );
    if (!pool.length) {
      sendJson(res, 409, { error: "Ya salieron todos los numeros." });
      return;
    }
    const next = pool[Math.floor(Math.random() * pool.length)];
    room.called.push(next);
    room.current = next;
    broadcast(room);
    sendJson(res, 200, { room: publicRoom(room) });
    return;
  }

  if (req.method === "POST" && action === "reset") {
    const body = await readBody(req);
    if (!requireHost(res, room, body.pin)) return;
    room.called = [];
    room.current = null;
    room.winners = [];
    for (const player of room.players.values()) player.card = makeCard(room.maxNumber);
    broadcast(room);
    sendJson(res, 200, { room: publicRoom(room) });
    return;
  }

  if (req.method === "POST" && action === "claim") {
    const body = await readBody(req);
    const player = room.players.get(body.playerId);
    if (!player) {
      sendJson(res, 404, { error: "Jugador no encontrado." });
      return;
    }
    const valid = hasBingo(player.card, room.called, room.winPattern);
    if (valid && !room.winners.some((winner) => winner.id === player.id)) {
      room.winners.push({
        id: player.id,
        name: player.name,
        pattern: room.winPattern,
        patternLabel: WIN_PATTERNS[room.winPattern] || WIN_PATTERNS.anyLine,
        at: new Date().toISOString()
      });
      broadcast(room);
    }
    sendJson(res, valid ? 200 : 422, {
      valid,
      message: valid
        ? `${WIN_PATTERNS[room.winPattern] || WIN_PATTERNS.anyLine} confirmado.`
        : `Todavia falta completar: ${WIN_PATTERNS[room.winPattern] || WIN_PATTERNS.anyLine}.`,
      room: publicRoom(room)
    });
    return;
  }

  sendJson(res, 404, { error: "Accion no encontrada." });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Ruta invalida." });
    return;
  }
  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "text/plain",
      "Cache-Control": "no-store"
    });
    res.end(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(await readFile(path.join(PUBLIC_DIR, "index.html")));
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }
  await serveStatic(req, res, url);
});

if (require.main === module) {
  server.listen({ port: PORT, host: "0.0.0.0", backlog: 1024 }, () => {
    console.log(`Bingo Virtual listo en http://localhost:${PORT}`);
  });
}

server.keepAliveTimeout = 70000;
server.headersTimeout = 75000;
server.requestTimeout = 0;

module.exports = { server };
