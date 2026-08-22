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

  function ensureStyles() {
    if (document.getElementById("grv2-admin-tab-status-styles")) return;
    const style = document.createElement("style");
    style.id = "grv2-admin-tab-status-styles";
    style.textContent = `
      .grv2-tab.grv2-admin-tab {
        background: #ffffff !important;
        border: 1px solid #6f8faa !important;
        border-bottom-color: #6f8faa !important;
        color: #334155 !important;
        font-weight: 600;
      }
      .grv2-tab.grv2-admin-tab.active:not(.grv2-admin-complete):not(.grv2-admin-reuse) {
        background: #1f4e79 !important;
        border-color: #1f4e79 !important;
        color: #ffffff !important;
        font-weight: 800;
      }
      .grv2-tab.grv2-admin-complete {
        background: #facc15 !important;
        border-color: #ca8a04 !important;
        color: #713f12 !important;
        font-weight: 800;
      }
      .grv2-tab.grv2-admin-reuse {
        background: #dc2626 !important;
        border-color: #991b1b !important;
        color: #ffffff !important;
        font-weight: 900;
        box-shadow: inset 0 0 0 1px #7f1d1d !important;
      }
    `;
    document.head.appendChild(style);
  }

  function activeProjectId() {
    return document.querySelector("#groupReviewProjectBadges .grv2-project-badge.active")?.dataset?.projectId || "";
  }

  function clearAdminStatus() {
    document.querySelectorAll("#groupReviewBody .grv2-tab").forEach(tab => {
      tab.classList.remove("grv2-admin-tab", "grv2-admin-complete", "grv2-admin-reuse");
      tab.removeAttribute("title");
    });
  }

  function applySheetStatus(tab, sheet) {
    if (!tab || !sheet) return;

    // 관리자 화면에서는 상태 문구를 붙이지 않고 작업자 이름만 표시한다.
    const name = String(sheet.member_name || "");
    if (tab.textContent !== name) tab.textContent = name;

    tab.classList.add("grv2-admin-tab");
    const reuseRequested = Boolean(sheet.reuse_requested);
    const completed = Boolean(sheet.completed);
    tab.classList.toggle("grv2-admin-reuse", reuseRequested);
    tab.classList.toggle("grv2-admin-complete", completed && !reuseRequested);

    if (reuseRequested) tab.title = "재수정 요청";
    else if (completed) tab.title = "입력 완료";
    else tab.removeAttribute("title");
  }

  function applyRealtimeSheet(sheet) {
    if (currentRole !== "ADMIN" || !sheet?.id) return;
    const tab = document.querySelector(`#groupReviewBody .grv2-tab[data-sheet-id="${Number(sheet.id)}"]`);
    if (tab) applySheetStatus(tab, sheet);
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
        // API 상태와 한 번 더 맞춰 두고, 재수정 버튼 모듈에도 즉시 갱신 신호를 준다.
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

  async function applyAdminStatus() {
    if (applying) return;
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
      if (currentRole !== "ADMIN") {
        clearAdminStatus();
        closeSocket();
        return;
      }

      const sheets = await api(`/group-review/projects/${encodeURIComponent(projectId)}/sheets`);
      const byId = new Map((Array.isArray(sheets) ? sheets : []).map(sheet => [Number(sheet.id), sheet]));

      tabs.forEach(tab => {
        const sheet = byId.get(Number(tab.dataset.sheetId));
        if (sheet) applySheetStatus(tab, sheet);
      });
      ensureSocket();
    } catch (_) {
      // 기본 Group Review 화면은 그대로 유지한다.
    } finally {
      applying = false;
    }
  }

  function scheduleApply(delay = 80) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void applyAdminStatus();
    }, delay);
  }

  function startObserver() {
    const body = document.getElementById("groupReviewBody");
    if (!body) {
      setTimeout(startObserver, 100);
      return;
    }

    const observer = new MutationObserver(mutations => {
      if (applying) return;
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

  ensureStyles();
  startObserver();
}
