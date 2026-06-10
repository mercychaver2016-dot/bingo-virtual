const params = new URLSearchParams(location.search);
let roomId = params.get("room");
const roomCode = params.get("code");
const hostPin = params.get("pin");
let roomState = null;
let playersRefreshTimer = null;
let roomRefreshTimer = null;
let lastSpokenNumber = null;
let voiceEnabled = localStorage.getItem("bingo-voice-enabled") === "true";
let player = readSavedPlayer();
let manualMarks = readManualMarks();

const $ = (selector) => document.querySelector(selector);

function playerKey() {
  return `bingo-player-${roomId}`;
}

function oldPlayerKey() {
  return `vingo-player-${roomId}`;
}

function marksKey() {
  return `bingo-marks-${roomId}-${player?.id || "anon"}`;
}

function readSavedPlayer() {
  if (!roomId) return null;
  return JSON.parse(sessionStorage.getItem(playerKey()) || sessionStorage.getItem(oldPlayerKey()) || "null");
}

function readManualMarks() {
  if (!roomId || !player?.id) return new Set();
  return new Set(JSON.parse(sessionStorage.getItem(marksKey()) || "[]"));
}

function saveManualMarks() {
  if (!roomId || !player?.id) return;
  sessionStorage.setItem(marksKey(), JSON.stringify([...manualMarks]));
}

async function api(path, data) {
  const response = await fetch(path, {
    method: data ? "POST" : "GET",
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || payload.message || "Error inesperado");
  return payload;
}

function renderCalled(called, maxNumber = 75) {
  const grid = $("#called-grid");
  if (!grid) return;
  grid.innerHTML = "";
  for (let n = 1; n <= maxNumber; n += 1) {
    const item = document.createElement("span");
    item.textContent = n;
    item.className = called.includes(n) ? "called" : "";
    grid.appendChild(item);
  }
}

function renderWinners(winners) {
  const target = $("#winners");
  if (!target) return;
  if (!winners.length) {
    target.textContent = "Sin ganadores todavia";
    return;
  }
  target.innerHTML = "";
  winners.forEach((winner) => {
    const item = document.createElement("div");
    item.className = "winner-item";
    item.innerHTML = `<strong>${winner.name}</strong><span>${winner.patternLabel || "Bingo confirmado"}</span>`;
    target.appendChild(item);
  });
}

function renderRoom(room) {
  roomState = room;
  document.body.dataset.theme = room.theme;
  document.body.dataset.cardStyle = room.cardStyle || "neon";
  $("#room-title") && ($("#room-title").textContent = room.title);
  $("#join-title") && ($("#join-title").textContent = room.title);
  $("#room-code") && ($("#room-code").textContent = room.code || "--");
  $("#current-ball") && ($("#current-ball").textContent = room.current || "--");
  $("#player-current") && ($("#player-current").textContent = room.current || "--");
  if ($("#code-link") && room.code) {
    $("#code-link").value = `${location.origin}/play.html?code=${room.code}`;
  }
  $("#win-rule") && ($("#win-rule").textContent = `Jugada: ${room.winPatternLabel || "--"}`);
  $("#player-rule") && ($("#player-rule").textContent = room.winPatternLabel || "--");
  if ($("#host-win-pattern") && $("#host-win-pattern").value !== room.winPattern) {
    $("#host-win-pattern").value = room.winPattern || "anyLine";
  }
  if ($("#host-card-style") && $("#host-card-style").value !== room.cardStyle) {
    $("#host-card-style").value = room.cardStyle || "neon";
  }
  document.querySelectorAll("#player-count").forEach((node) => {
    node.textContent = `${room.playerCount}/${room.maxPlayers}`;
  });
  renderCalled(room.called, room.maxNumber);
  renderWinners(room.winners);
  renderWinnerBanner(room.winners);
  syncPlayerCardAfterReset(room);
  updateSelectableNumbers();
  speakCurrentNumber(room.current);
  schedulePlayersRefresh();
}

async function syncPlayerCardAfterReset(room) {
  if (!player || !room?.cardVersion || player.cardVersion === room.cardVersion) return;
  try {
    const payload = await api(`/api/rooms/${roomId}/player`, { playerId: player.id });
    player = payload.player;
    manualMarks = new Set();
    sessionStorage.setItem(playerKey(), JSON.stringify(player));
    saveManualMarks();
    renderCard();
    showPlayerMessage("Juego reiniciado. Tienes un carton nuevo.", "success");
  } catch {
    // The polling/event stream will try again on the next room update.
  }
}

function renderWinnerBanner(winners) {
  const banner = $("#winner-banner");
  if (!banner) return;
  if (!winners.length) {
    banner.classList.add("hidden");
    banner.innerHTML = "";
    return;
  }
  const latest = winners[winners.length - 1];
  banner.classList.remove("hidden");
  banner.innerHTML = `
    <span>Ganador confirmado</span>
    <strong>${latest.name}</strong>
    <small>${latest.patternLabel || "Bingo confirmado"}</small>
  `;
}

function connectEvents() {
  if (!roomId || !window.EventSource) return;
  const events = new EventSource(`/api/rooms/${roomId}/events`);
  events.onmessage = (event) => renderRoom(JSON.parse(event.data));
  events.onerror = () => {
    scheduleRoomRefresh();
  };
}

function renderCard() {
  const card = $("#bingo-card");
  if (!card || !player) return;
  card.innerHTML = "";
  card.dataset.cardStyle = roomState?.cardStyle || "neon";
  card.onclick = async (event) => {
    const cell = event.target.closest("button[data-value]");
    if (!cell || !card.contains(cell)) return;
    const value = cell.dataset.value;
    if (value === "FREE") return;
    if (!canMarkNumber(value)) {
      await refreshRoom();
      if (!canMarkNumber(value)) {
        showPlayerMessage("Ese numero todavia no ha salido.", "error");
        return;
      }
    }
    if (manualMarks.has(value)) manualMarks.delete(value);
    else manualMarks.add(value);
    saveManualMarks();
    cell.classList.toggle("marked", manualMarks.has(value));
    cell.setAttribute("aria-pressed", cell.classList.contains("marked") ? "true" : "false");
    showPlayerMessage(manualMarks.has(value) ? "Numero marcado." : "Marca quitada.", "success");
  };
  ["B", "I", "N", "G", "O"].forEach((letter) => {
    const head = document.createElement("strong");
    head.textContent = letter;
    card.appendChild(head);
  });
  player.card.flat().forEach((value) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.textContent = value;
    cell.dataset.value = value;
    const isMarked = value === "FREE" || manualMarks.has(String(value));
    cell.className = isMarked ? "marked" : "";
    cell.setAttribute("aria-pressed", isMarked ? "true" : "false");
    card.appendChild(cell);
  });
  updateSelectableNumbers();
}

async function initLanding() {
  const form = $("#create-room");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const payload = await api("/api/rooms", data);
    location.href = payload.links.host;
  });
}

async function initHost() {
  if (!$("#draw-number")) return;
  const playerLink = `${location.origin}/play.html?room=${roomId}`;
  $("#player-link").value = playerLink;
  $("#public-link").value = playerLink;
  $("#player-link").addEventListener("focus", (event) => event.target.select());
  $("#code-link")?.addEventListener("focus", (event) => event.target.select());
  $("#public-link")?.addEventListener("focus", (event) => event.target.select());
  $("#network-link")?.addEventListener("focus", (event) => event.target.select());
  setupVoiceToggle();
  await refreshRoom();
  await refreshShareLinks();
  const shareTimer = setInterval(async () => {
    const foundPublic = await refreshShareLinks();
    if (foundPublic) clearInterval(shareTimer);
  }, 2500);
  $("#draw-number").addEventListener("click", async () => {
    const payload = await api(`/api/rooms/${roomId}/draw`, { pin: hostPin });
    renderRoom(payload.room);
    await refreshPlayers();
  });
  $("#reset-game").addEventListener("click", async () => {
    const payload = await api(`/api/rooms/${roomId}/reset`, { pin: hostPin });
    renderRoom(payload.room);
    await refreshPlayers();
  });
  $("#host-win-pattern").addEventListener("change", async (event) => {
    const payload = await api(`/api/rooms/${roomId}/settings`, {
      pin: hostPin,
      winPattern: event.target.value
    });
    renderRoom(payload.room);
  });
  $("#host-card-style").addEventListener("change", async (event) => {
    const payload = await api(`/api/rooms/${roomId}/settings`, {
      pin: hostPin,
      cardStyle: event.target.value
    });
    renderRoom(payload.room);
    await refreshPlayers();
  });
  await refreshPlayers();
  connectEvents();
  startRoomPolling();
}

async function refreshShareLinks() {
  try {
    const payload = await api("/api/network");
    if (payload.publicOrigin) {
      $("#public-link").value = `${payload.publicOrigin}/play.html?room=${roomId}`;
    }
    if (payload.origins?.length) {
      $("#network-link").value = `${payload.origins[0]}/play.html?room=${roomId}`;
      $("#network-share").classList.remove("hidden");
    }
    return Boolean(payload.publicOrigin);
  } catch {
    return false;
  }
}

function startRoomPolling() {
  if (roomRefreshTimer || !roomId) return;
  roomRefreshTimer = setInterval(async () => {
    await refreshRoom();
    await refreshPlayers();
  }, 3000);
}

function scheduleRoomRefresh() {
  if (!roomId) return;
  setTimeout(refreshRoom, 1000);
}

async function refreshRoom() {
  if (!roomId) return;
  try {
    const payload = await api(`/api/rooms/${roomId}`);
    renderRoom(payload.room);
  } catch {
    // The next poll/EventSource reconnect can recover the visible state.
  }
}

function schedulePlayersRefresh() {
  if (!$("#players-list") || playersRefreshTimer) return;
  playersRefreshTimer = setTimeout(async () => {
    playersRefreshTimer = null;
    await refreshPlayers();
  }, 300);
}

async function refreshPlayers() {
  const target = $("#players-list");
  if (!target || !hostPin || !roomId) return;
  try {
    const payload = await api(`/api/rooms/${roomId}/players`, { pin: hostPin });
    renderPlayers(payload.players);
  } catch (error) {
    target.textContent = error.message;
  }
}

function renderPlayers(players) {
  const target = $("#players-list");
  if (!target) return;
  if (!players.length) {
    target.textContent = "Sin jugadores todavia";
    return;
  }
  target.innerHTML = "";
  players.forEach((entry) => {
    const item = document.createElement("details");
    item.className = "player-card";
    const summary = document.createElement("summary");
    summary.textContent = entry.name;
    const mini = document.createElement("div");
    mini.className = "mini-card";
    mini.dataset.cardStyle = roomState?.cardStyle || "neon";
    ["B", "I", "N", "G", "O"].forEach((letter) => {
      const head = document.createElement("strong");
      head.textContent = letter;
      mini.appendChild(head);
    });
    entry.card.flat().forEach((value) => {
      const cell = document.createElement("span");
      cell.textContent = value;
      if (value === "FREE") cell.className = "marked";
      mini.appendChild(cell);
    });
    item.appendChild(summary);
    item.appendChild(mini);
    target.appendChild(item);
  });
}

async function initPlayer() {
  const form = $("#join-room");
  if (!form) return;
  if (!roomId && roomCode) {
    try {
      const payload = await api(`/api/rooms/code/${roomCode}`);
      roomId = payload.room.id;
      renderRoom(payload.room);
      history.replaceState(null, "", `/play.html?room=${roomId}`);
      player = readSavedPlayer();
      manualMarks = readManualMarks();
    } catch (error) {
      $("#join-title").textContent = error.message;
      form.classList.add("hidden");
      return;
    }
  }
  if (!roomId) {
    $("#join-title").textContent = "Falta el codigo de sala";
    form.classList.add("hidden");
    return;
  }
  const saved = player;
  if (saved) {
    $("#join-panel").classList.add("hidden");
    $("#play-zone").classList.remove("hidden");
    await refreshRoom();
    renderCard();
  }
  setupVoiceToggle();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const payload = await api(`/api/rooms/${roomId}/join`, data);
    player = payload.player;
    manualMarks = new Set();
    sessionStorage.setItem(playerKey(), JSON.stringify(player));
    saveManualMarks();
    sessionStorage.removeItem(oldPlayerKey());
    $("#join-panel").classList.add("hidden");
    $("#play-zone").classList.remove("hidden");
    renderRoom(payload.room);
    renderCard();
  });
  $("#claim-bingo").addEventListener("click", async () => {
    const target = $("#claim-message");
    try {
      const payload = await api(`/api/rooms/${roomId}/claim`, { playerId: player.id });
      renderRoom(payload.room);
      target.textContent = payload.message;
      target.className = "claim-message success";
    } catch (error) {
      target.textContent = error.message;
      target.className = "claim-message error";
    }
  });
  connectEvents();
  startRoomPolling();
}

function numberLetter(number) {
  const max = roomState?.maxNumber || 75;
  const columnSize = Math.floor(max / 5);
  const index = Math.min(4, Math.floor((number - 1) / columnSize));
  return ["B", "I", "N", "G", "O"][index];
}

function canMarkNumber(value) {
  const number = Number(value);
  const visibleCurrent = Number($("#player-current")?.textContent || $("#current-ball")?.textContent);
  return (
    roomState?.called?.includes(number) ||
    roomState?.current === number ||
    visibleCurrent === number
  );
}

function showPlayerMessage(message, type = "success") {
  const target = $("#claim-message");
  if (!target) return;
  target.textContent = message;
  target.className = `claim-message ${type}`;
}

function updateSelectableNumbers() {
  const card = $("#bingo-card");
  if (!card || !roomState?.called) return;
  card.dataset.cardStyle = roomState.cardStyle || "neon";
  card.querySelectorAll("button[data-value]").forEach((cell) => {
    if (cell.dataset.value === "FREE") {
      return;
    }
    const isMarked = manualMarks.has(cell.dataset.value);
    cell.classList.remove("can-mark");
    cell.classList.toggle("marked", isMarked);
    cell.setAttribute("aria-pressed", isMarked ? "true" : "false");
  });
}

function setupVoiceToggle() {
  const button = $("#voice-toggle");
  if (!button) return;
  updateVoiceButton();
  button.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    localStorage.setItem("bingo-voice-enabled", String(voiceEnabled));
    updateVoiceButton();
    if (voiceEnabled) {
      if (roomState?.current) speakNumber(roomState.current);
      else speakText("Voz activada");
    } else {
      window.speechSynthesis?.cancel?.();
    }
  });
}

function updateVoiceButton() {
  const button = $("#voice-toggle");
  if (!button) return;
  button.textContent = voiceEnabled ? "Voz activa" : "Activar voz";
}

function speakCurrentNumber(number) {
  if (!number || number === lastSpokenNumber) return;
  lastSpokenNumber = number;
  speakNumber(number);
}

function speakNumber(number) {
  speakText(`${numberLetter(number)} ${number}`);
}

function speakText(text) {
  if (!voiceEnabled || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-ES";
  utterance.rate = 0.86;
  utterance.pitch = 1.05;
  window.speechSynthesis.speak(utterance);
}

initLanding();
initHost();
initPlayer();
