(function () {
  const panel = document.querySelector("#networkPanel");
  const statusText = document.querySelector("#networkStatusText");
  const clientsList = document.querySelector("#networkClients");
  const helpText = document.querySelector("#networkHelp");
  const roomJoinForm = document.querySelector("#roomJoinForm");
  const roomCodeInput = document.querySelector("#roomCodeInput");

  if (!panel || !statusText || !clientsList || !helpText) return;

  const ROOM_KEY = "frontLineRoomId";
  const CLIENT_KEY = "frontLineClientId";

  let latestVersion = 0;
  let selfSeat = null;
  let initialPublished = false;
  let consecutiveFailures = 0;
  let pingInFlight = false;

  function randomId(length = 8) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let output = "";
    const bytes = new Uint8Array(length);
    window.crypto.getRandomValues(bytes);
    bytes.forEach((byte) => {
      output += chars[byte % chars.length];
    });
    return output;
  }

  function normalizeRoomCode(value) {
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24).toUpperCase();
  }

  function ensureClientId() {
    const existing = localStorage.getItem(CLIENT_KEY);
    if (existing) return existing;
    const next = `c_${randomId(14)}`;
    localStorage.setItem(CLIENT_KEY, next);
    return next;
  }

  function ensureRoomId() {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("room");
    if (fromUrl) {
      const normalized = normalizeRoomCode(fromUrl) || randomId(6);
      localStorage.setItem(ROOM_KEY, normalized);
      if (normalized !== fromUrl) {
        url.searchParams.set("room", normalized);
        window.history.replaceState(null, "", url);
      }
      return normalized;
    }

    const next = localStorage.getItem(ROOM_KEY) || randomId(6);
    localStorage.setItem(ROOM_KEY, next);
    url.searchParams.set("room", next);
    window.history.replaceState(null, "", url);
    return next;
  }

  const clientId = ensureClientId();
  const roomId = /^https?:$/.test(window.location.protocol) ? ensureRoomId() : "STATIC";
  if (roomCodeInput) roomCodeInput.value = roomId === "STATIC" ? "" : roomId;

  function apiUrl(path) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("room", roomId);
    url.searchParams.set("clientId", clientId);
    return url;
  }

  function renderOffline() {
    panel.hidden = false;
    statusText.textContent = "Static";
    clientsList.innerHTML = "";
    helpText.textContent = "Room codes work when opened through the local or online server.";
  }

  function renderNetwork(data) {
    panel.hidden = false;
    consecutiveFailures = 0;
    selfSeat = data.self?.seat ?? null;
    window.FrontLineGame?.setNetworkInfo(selfSeat, data.ready);
    const seated = data.clients.filter((client) => client.seat !== "Spectator");
    statusText.textContent = data.ready ? `Room ${data.room}` : `Room ${data.room} ${seated.length}/2`;
    clientsList.innerHTML = "";
    data.clients.forEach((client) => {
      const item = document.createElement("div");
      item.className = [
        "network-client",
        client.clientId === data.self?.clientId ? "self" : "",
        client.seat.toLowerCase(),
      ].filter(Boolean).join(" ");
      item.innerHTML = `<strong>${client.seat}</strong><span>${client.ip}</span>`;
      clientsList.append(item);
    });
    helpText.textContent = data.self
      ? data.ready
        ? `You are ${data.self.seat}. Share code ${data.room}, or share this URL.`
        : `Waiting for an opponent. You can solo play for now. Share code ${data.room}.`
      : "Connecting to match room...";
  }

  function joinRoom(event) {
    event.preventDefault();
    if (!/^https?:$/.test(window.location.protocol)) {
      helpText.textContent = "Open through the server before joining a room.";
      return;
    }
    const nextRoom = normalizeRoomCode(roomCodeInput?.value);
    if (!nextRoom) {
      helpText.textContent = "Enter a room code first.";
      roomCodeInput?.focus();
      return;
    }
    if (nextRoom === roomId) {
      helpText.textContent = `Already in room ${roomId}.`;
      return;
    }

    localStorage.setItem(ROOM_KEY, nextRoom);
    const url = new URL(window.location.href);
    url.searchParams.set("room", nextRoom);
    window.location.assign(url.toString());
  }

  async function fetchState() {
    const response = await fetch(apiUrl("/api/state"), { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.state && selfSeat === "North" && !initialPublished) {
      initialPublished = true;
      await publishState("initial", window.FrontLineGame?.exportState?.());
      return;
    }
    if (data.state && data.version > latestVersion) {
      latestVersion = data.version;
      window.FrontLineGame?.applyState?.(data.state);
    }
  }

  async function publishState(reason, state) {
    if (!state) return;
    const response = await fetch(apiUrl("/api/state"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, clientId, state }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    latestVersion = data.version;
  }

  window.FrontLineNetwork = {
    publishState: (reason, state) => {
      publishState(reason, state).catch(() => {
        statusText.textContent = "Sync Error";
        helpText.textContent = "Could not send the match state to the server.";
      });
    },
  };

  async function ping() {
    if (pingInFlight) return;
    pingInFlight = true;
    try {
      const response = await fetch(apiUrl("/api/register"), { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderNetwork(await response.json());
      await fetchState();
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures < 3) return;
      panel.hidden = false;
      statusText.textContent = "Offline";
      clientsList.innerHTML = "";
      helpText.textContent = "Connection is unstable. Retrying...";
    } finally {
      pingInFlight = false;
    }
  }

  if (!/^https?:$/.test(window.location.protocol)) {
    roomJoinForm?.addEventListener("submit", joinRoom);
    renderOffline();
    return;
  }

  roomCodeInput?.addEventListener("input", () => {
    const normalized = normalizeRoomCode(roomCodeInput.value);
    if (roomCodeInput.value !== normalized) roomCodeInput.value = normalized;
  });
  roomJoinForm?.addEventListener("submit", joinRoom);
  ping();
  window.setInterval(ping, 1200);
})();
