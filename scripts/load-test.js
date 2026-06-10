const { server } = require("../server");

const PORT = Number(process.env.TEST_PORT || 3310);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PLAYER_COUNT = Number(process.env.LOAD_PLAYERS || 320);
const EVENT_CLIENTS = Number(process.env.LOAD_EVENTS || 320);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY || 50);

function listen() {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port: PORT, host: "127.0.0.1", backlog: 1024 }, () => {
      setTimeout(resolve, 100);
    });
  });
}

async function api(path, data) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: data ? "POST" : "GET",
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || payload.message || response.statusText);
  return payload;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await api("/api/network");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`No se pudo abrir el servidor de prueba en ${BASE_URL}.`);
}

async function openEventClient(roomId) {
  const response = await fetch(`${BASE_URL}/api/rooms/${roomId}/events`);
  if (!response.ok) throw new Error(`EventSource fallo: ${response.status}`);
  const reader = response.body.getReader();
  await reader.read();
  return reader;
}

async function inBatches(items, worker) {
  const results = [];
  for (let start = 0; start < items.length; start += CONCURRENCY) {
    const batch = items.slice(start, start + CONCURRENCY);
    results.push(...(await Promise.all(batch.map(worker))));
  }
  return results;
}

async function main() {
  await listen();
  if (!server.listening) throw new Error("El servidor de prueba no quedo escuchando.");
  await waitForServer();
  const created = await api("/api/rooms", { title: "Prueba 300+" });
  const roomId = created.room.id;
  const pin = new URL(created.links.host).searchParams.get("pin");

  const readers = await inBatches(Array.from({ length: EVENT_CLIENTS }), () =>
    openEventClient(roomId)
  );

  const players = await inBatches(
    Array.from({ length: PLAYER_COUNT }, (_, index) => index),
    (index) => api(`/api/rooms/${roomId}/join`, { name: `Jugador ${index + 1}` })
  );

  await api(`/api/rooms/${roomId}/draw`, { pin });
  const snapshot = await api(`/api/rooms/${roomId}`);

  for (const reader of readers) await reader.cancel();

  if (players.length !== PLAYER_COUNT || snapshot.room.playerCount !== PLAYER_COUNT) {
    throw new Error(`Entraron ${snapshot.room.playerCount}/${PLAYER_COUNT} jugadores.`);
  }

  console.log(
    `OK: ${PLAYER_COUNT} jugadores y ${EVENT_CLIENTS} conexiones en vivo respondieron bien.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    server.close();
  });
