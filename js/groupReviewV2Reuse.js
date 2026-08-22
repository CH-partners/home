const API_ROOT = "/api/v1";

async function api(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    credentials: "include",
    headers: { ...(options.headers || {}) }
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`);
  return data;
}

export function installGroupReviewReuseV2(groupReviewApi) {
  let socket = null;
  let socketProjectId = null;
  let reconnectTimer = null;
  let refreshTimer = null;
  let rendering = false;

  const bodyEl = () => document.getElementById("groupReviewBody");
  const activeProjectButton = () => document.querySelector("#groupReviewProjectBadges [data-project-id].active");
  const activeSheetButton = () => bodyEl()?.querySelector("[data-sheet-id].active");

  function selectedProjectId() {
    return activeProjectButton()?.dataset.projectId || "";
  }

  function selectedSheetId() {
    return Number(activeSheetButton()?.dataset.sheetId || 0);
  }

  function ownSheetId() {
    const own = Array.from(bodyEl()?.querySelectorAll("[data-sheet-id]") || [])
      .find(button => button.textContent.includes("· 나"));
    return Number(own?.dataset.sheetId || 0);
  }

  async function refreshBasePreservingSheet() {
    const sheetId = selectedSheetId();
    await groupReviewApi?.refresh?.();
    if (sheetId) {
      bodyEl()?.querySelector(`[data-sheet-id="${sheetId}"]`)?.click();
    }
  }

  async function currentContext() {
    const projectId = selectedProjectId();
    if (!projectId) return null;
    const [user, sheets] = await Promise.all([
      api("/auth/me"),
      api(`/group-review/projects/${projectId}/sheets`)
    ]);
    const selectedId = selectedSheetId();
    const ownId = ownSheetId();
    const selectedSheet = sheets.find(sheet => sheet.id === selectedId) || null;
    const ownSheet = sheets.find(sheet => sheet.id === ownId) || null;
    return { projectId, user, sheets, selectedSheet, ownSheet };
  }

  function removeControls(host = null) {
    const scope = host || document;
    scope.querySelectorAll(".grv2-reuse-control,.grv2-reuse-note").forEach(node => node.remove());
  }

  function makeButton(text, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `grv2-btn ${className || ""} grv2-reuse-control`.trim();
    button.textContent = text;
    button.addEventListener("click", handler);
    return button;
  }

  function desiredSignature(context) {
    if (!context) return "none";
    const { user, selectedSheet, ownSheet } = context;
    if (user.role === "WORKER") {
      if (!ownSheet?.completed) return "worker:none";
      return `worker:${ownSheet.id}:${ownSheet.reuse_requested ? "pending" : "ready"}`;
    }
    if (user.role === "ADMIN") {
      if (!selectedSheet?.completed || !selectedSheet.reuse_requested) return `admin:none:${selectedSheet?.id || 0}`;
      return `admin:${selectedSheet.id}:pending`;
    }
    return "none";
  }

  async function renderControls() {
    if (rendering) return;
    rendering = true;
    try {
      const body = bodyEl();
      const host = body?.querySelector(".grv2-bottom-actions");
      if (!host) return;

      let context;
      try {
        context = await currentContext();
      } catch (_) {
        return;
      }
      if (!context) return;

      const signature = desiredSignature(context);
      if (host.dataset.reuseSignature === signature) return;

      removeControls(host);
      host.dataset.reuseSignature = signature;

      const { user, selectedSheet, ownSheet } = context;
      if (user.role === "WORKER" && ownSheet?.completed) {
        const button = makeButton(
          ownSheet.reuse_requested ? "재사용 요청중" : "재사용 요청",
          "grv2-reuse-request",
          async () => {
            if (ownSheet.reuse_requested) return;
            if (!confirm("본인 시트를 다시 사용할 수 있도록 관리자에게 재사용 요청을 보낼까요?")) return;
            try {
              button.disabled = true;
              await api(`/group-review/sheets/${ownSheet.id}/reuse-request`, { method: "POST" });
              await refreshBasePreservingSheet();
              scheduleRender(0);
              alert("재사용 요청을 보냈습니다. 관리자 승인 전까지 입력은 잠긴 상태입니다.");
            } catch (error) {
              button.disabled = false;
              alert(`재사용 요청 실패: ${error.message}`);
            }
          }
        );
        button.disabled = Boolean(ownSheet.reuse_requested);
        host.appendChild(button);
      }

      if (user.role === "ADMIN" && selectedSheet?.completed && selectedSheet.reuse_requested) {
        const note = document.createElement("span");
        note.className = "grv2-reuse-note";
        note.textContent = `${selectedSheet.member_name} 재사용 요청`;
        note.style.fontSize = "12px";
        note.style.fontWeight = "700";
        note.style.color = "#c2410c";
        host.appendChild(note);

        host.appendChild(makeButton("재사용 승인", "grv2-success", async event => {
          if (!confirm(`${selectedSheet.member_name} 시트 재사용을 승인할까요?\n확인 완료된 회색 행은 잠긴 채 유지됩니다.`)) return;
          try {
            event.currentTarget.disabled = true;
            await api(`/group-review/sheets/${selectedSheet.id}/reuse-approve`, { method: "POST" });
            await refreshBasePreservingSheet();
            scheduleRender(0);
            alert("재사용을 승인했습니다.");
          } catch (error) {
            event.currentTarget.disabled = false;
            alert(`재사용 승인 실패: ${error.message}`);
          }
        }));

        host.appendChild(makeButton("요청 거절", "grv2-danger", async event => {
          if (!confirm(`${selectedSheet.member_name} 시트 재사용 요청을 거절할까요?`)) return;
          try {
            event.currentTarget.disabled = true;
            await api(`/group-review/sheets/${selectedSheet.id}/reuse-reject`, { method: "POST" });
            await refreshBasePreservingSheet();
            scheduleRender(0);
            alert("재사용 요청을 거절했습니다.");
          } catch (error) {
            event.currentTarget.disabled = false;
            alert(`재사용 거절 실패: ${error.message}`);
          }
        }));
      }
    } finally {
      rendering = false;
    }
  }

  function scheduleRender(delay = 80) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void renderControls();
      ensureSocket();
    }, delay);
  }

  function closeSocket() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
      socket = null;
    }
    socketProjectId = null;
  }

  function ensureSocket() {
    const projectId = selectedProjectId();
    if (!projectId) return closeSocket();
    if (socket && socketProjectId === projectId && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;

    closeSocket();
    socketProjectId = projectId;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/api/v1/group-review/ws/projects/${encodeURIComponent(projectId)}`);
    socket.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (!["reuse_requested", "reuse_approved", "reuse_rejected"].includes(message.type)) return;
        const sheetId = selectedSheetId();
        void refreshBasePreservingSheet().then(() => {
          if (sheetId) bodyEl()?.querySelector(`[data-sheet-id="${sheetId}"]`)?.click();
          scheduleRender(0);
        });
      } catch (_) {}
    };
    socket.onclose = () => {
      socket = null;
      if (selectedProjectId()) reconnectTimer = setTimeout(ensureSocket, 1500);
    };
  }

  const observer = new MutationObserver(() => {
    if (!rendering) scheduleRender();
  });
  const startObserver = () => {
    const body = bodyEl();
    const badges = document.getElementById("groupReviewProjectBadges");
    if (!body || !badges) return setTimeout(startObserver, 100);
    observer.observe(body, { childList: true, subtree: true });
    observer.observe(badges, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    scheduleRender(0);
  };

  startObserver();
  return { refresh: () => scheduleRender(0), destroy: () => { observer.disconnect(); closeSocket(); } };
}
