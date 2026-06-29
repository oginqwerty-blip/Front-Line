(function () {
  const panel = document.querySelector("#networkPanel");
  const statusText = document.querySelector("#networkStatusText");
  const clientsList = document.querySelector("#networkClients");
  const helpText = document.querySelector("#networkHelp");

  if (!panel || !statusText || !clientsList || !helpText) return;

  const ROOM_KEY = "frontLineRoomId";
  const CLIENT_KEY = "frontLineClientId";

  let latestVersion = 0;
  let selfSeat = null;
  let initialPublished = false;

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
      const normalized = fromUrl.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24).toUpperCase();
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
    helpText.textContent = "Local match detection starts when opened through the local server.";
  }

  function renderNetwork(data) {
    panel.hidden = false;
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
      ? `You are ${data.self.seat}. Share this room URL: ${window.location.href}`
      : "Connecting to match room...";
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
    try {
      const response = await fetch(apiUrl("/api/register"), { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderNetwork(await response.json());
      await fetchState();
    } catch (error) {
      panel.hidden = false;
      statusText.textContent = "Offline";
      clientsList.innerHTML = "";
      helpText.textContent = "Server not detected.";
    }
  }

  if (!/^https?:$/.test(window.location.protocol)) {
    renderOffline();
    return;
  }

  ping();
  window.setInterval(ping, 3000);
})();
