const API_ROOT = "/api/v1";

async function api(path) {
  const response = await fetch(`${API_ROOT}${path}`, { credentials: "include" });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`);
  return data;
}

export function installGroupReviewAdminTabStatusV2() {
  if (window.__grv2AdminTabStatusInstalled) return;
  window.__grv2AdminTabStatusInstalled = true;

  let timer = null;
  let applying = false;
  let currentRole = "";
  let socket = null;
  let socketProjectId = "";
  let reconnectTimer = null;

  function activeProjectId() {
    return document.querySelector("#groupReviewProjectBadges .grv2-project-badge.active")?.dataset?.projectId || "";
  }

  function normalizeBaseTabs() {
    document.querySelectorAll("#groupReviewBody .grv2-tab").forEach(tab => {
      if (!tab.classList.contains("done")) return;
      const normalized = String(tab.textContent || "")
        .replace(/\s*·\s*입력완료\s*$/g, "")
        .replace(/\s*·\s*완료\s*$/g, "");
      if (tab.textContent !== normalized) tab.textContent = normalized;
    });
  }

  function clearStatusClasses() {
    document.querySelectorAll("#groupReviewBody .grv2-tab").forEach(tab => {
      tab.classList.remove(
        "grv2-admin-tab",
        "grv2-admin-complete",
        "grv2-admin-reuse",
        "grv2-worker-complete"
      );
      tab.removeAttribute("title");
    });
  }

  function applyAdminStatus(tab, sheet) {
    if (!tab || !sheet) return;

    const name = String(sheet.member_name || "");
    if (tab.textContent !== name) tab.textContent = name;

    tab.classList.add("grv2-admin-tab");
    const reuseRequested = Boolean(sheet.reuse_requested);
    const completed = Boolean(sheet.completed);
    tab.classList.toggle("grv2-admin-reuse", reuseRequested);
    tab.classList.toggle("grv2-admin-complete", completed && !reuseRequested);

    if (reuseRequested) tab.title = "재수정 요청";
    else if (completed) tab.title = "완료";
    else tab.removeAttribute("title");
  }

  function applyWorkerStatus(tab, sheet, user) {
    if (!tab || !sheet || !user) return;

    const name = String(sheet.member_name || "");
    const ownSuffix = sheet.member_name === user.display_name ? " · 나" : "";
    const text = `${name}${ownSuffix}`;
    if (tab.textContent !== text) tab.textContent = text;

    const completed = Boolean(sheet.completed);
    tab.classList.toggle("grv2-worker-complete", completed);
    if (completed) tab.title = "완료";
    else tab.removeAttribute("title");
  }

  function applyRealtimeSheet(sheet) {
    if (currentRole !== "ADMIN" || !sheet?.id) return;
    const tab = document.querySelector(`#groupReviewBody .grv2-tab[data-sheet-id="${Number(sheet.id)}"]`);
    if (tab) applyAdminStatus(tab, sheet);
  }

  function closeSocket() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
      socket = null;
    }
    socketProjectId = "";
  }

  function ensureSocket() {
    const projectId = activeProjectId();
    if (currentRole !== "ADMIN" || !projectId) {
      closeSocket();
      return;
    }
    if (socket && socketProjectId === projectId && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;

    closeSocket();
    socketProjectId = projectId;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/api/v1/group-review/ws/projects/${encodeURIComponent(projectId)}`);
    socket = ws;

    ws.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (!["reuse_requested", "reuse_approved", "reuse_rejected", "sheet_completed"].includes(message.type)) return;
        if (message.sheet) applyRealtimeSheet(message.sheet);
        document.dispatchEvent(new CustomEvent("grv2:sheet-status-realtime", { detail: message }));
        scheduleApply(60);
      } catch (_) {}
    };

    ws.onclose = () => {
      if (socket === ws) socket = null;
      if (currentRole === "ADMIN" && activeProjectId()) {
        reconnectTimer = setTimeout(ensureSocket, 1500);
      }
    };
  }

  async function applyTabStatus() {
    if (applying) return;
    normalizeBaseTabs();

    const projectId = activeProjectId();
    const tabs = Array.from(document.querySelectorAll("#groupReviewBody .grv2-tab[data-sheet-id]"));
    if (!projectId || !tabs.length) {
      currentRole = "";
      closeSocket();
      return;
    }

    applying = true;
    try {
      const user = await api("/auth/me");
      currentRole = user?.role || "";
      const sheets = await api(`/group-review/projects/${encodeURIComponent(projectId)}/sheets`);
      const byId = new Map((Array.isArray(sheets) ? sheets : []).map(sheet => [Number(sheet.id), sheet]));

      clearStatusClasses();
      normalizeBaseTabs();

      if (currentRole === "ADMIN") {
        tabs.forEach(tab => {
          const sheet = byId.get(Number(tab.dataset.sheetId));
          if (sheet) applyAdminStatus(tab, sheet);
        });
        ensureSocket();
        return;
      }

      if (currentRole === "WORKER") {
        tabs.forEach(tab => {
          const sheet = byId.get(Number(tab.dataset.sheetId));
          if (sheet) applyWorkerStatus(tab, sheet, user);
        });
      }
      closeSocket();
    } catch (_) {
      normalizeBaseTabs();
    } finally {
      applying = false;
    }
  }

  function scheduleApply(delay = 80) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void applyTabStatus();
    }, delay);
  }

  function startObserver() {
    const body = document.getElementById("groupReviewBody");
    if (!body) {
      setTimeout(startObserver, 100);
      return;
    }

    normalizeBaseTabs();

    const observer = new MutationObserver(mutations => {
      if (applying) return;
      normalizeBaseTabs();
      const screenRebuilt = mutations.some(mutation => mutation.target === body || mutation.addedNodes.length);
      if (screenRebuilt) scheduleApply();
    });
    observer.observe(body, { childList: true, subtree: true });

    document.addEventListener("click", event => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".grv2-project-badge")) scheduleApply(180);
    }, true);

    [0, 200, 600].forEach(delay => setTimeout(() => scheduleApply(0), delay));
  }

  normalizeBaseTabs();
  startObserver();
}
