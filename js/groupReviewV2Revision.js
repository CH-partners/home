const API_ROOT = "/api/v1";

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json; charset=utf-8";
  }
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers, credentials: "include" });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`);
  return data;
}

export function installGroupReviewRevisionV2(groupReviewApi) {
  if (window.__grv2RevisionInstalled) return;
  window.__grv2RevisionInstalled = true;

  const state = {
    user: null,
    projectId: "",
    sheetId: 0,
    rows: new Map(),
    socket: null,
    reconnectTimer: null,
    observer: null,
    refreshTimer: null,
    busy: false
  };

  function ensureStyles() {
    if (document.getElementById("grv2-revision-styles")) return;
    const style = document.createElement("style");
    style.id = "grv2-revision-styles";
    style.textContent = `
      .grv2-revision-wrap{display:flex;flex-direction:column;gap:4px;align-items:center;padding:4px}
      .grv2-revision-btn{border:1px solid #f59e0b;background:#fff7ed;color:#9a3412;border-radius:6px;padding:4px 7px;font-size:11px;cursor:pointer;white-space:nowrap}
      .grv2-revision-btn:hover{background:#ffedd5}
      .grv2-revision-badge{display:inline-flex;padding:2px 6px;border-radius:999px;font-size:10px;font-weight:700;white-space:nowrap;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}
      .grv2-revision-child{background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe}
    `;
    document.head.appendChild(style);
  }

  function activeProjectId() {
    return document.querySelector("#groupReviewProjectBadges .grv2-project-badge.active")?.dataset?.projectId || "";
  }

  function activeSheetId() {
    return Number(document.querySelector("#groupReviewBody .grv2-tab.active")?.dataset?.sheetId || 0);
  }

  function projectCompleted() {
    return document.querySelector("#groupReviewProjectBadges .grv2-project-badge.active")?.textContent?.includes("· 완료") || false;
  }

  async function refreshContext() {
    const projectId = activeProjectId();
    const sheetId = activeSheetId();
    if (!projectId || !sheetId) return;
    try {
      if (!state.user) state.user = await api("/auth/me");
      const rows = await api(`/group-review/sheets/${sheetId}/revision-rows`);
      state.projectId = projectId;
      state.sheetId = sheetId;
      state.rows = new Map(rows.map(row => [Number(row.id), row]));
      applyUi();
      connectSocket();
    } catch (_) {}
  }

  function applyUi() {
    document.querySelectorAll("#groupReviewBody .grv2-row").forEach(rowEl => {
      const rowId = Number(rowEl.dataset.rowId || 0);
      const row = state.rows.get(rowId);
      if (!row) return;
      const actionCell = rowEl.lastElementChild;
      if (!actionCell) return;

      const baseApprove = actionCell.querySelector(".grv2-approve");
      if (baseApprove) {
        baseApprove.style.display = row.review_status === "submitted" ? "" : "none";
      }

      let wrap = actionCell.querySelector(".grv2-revision-wrap");
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.className = "grv2-revision-wrap";
        actionCell.appendChild(wrap);
      }

      const desired = [];
      if (row.review_status === "revision_requested") {
        desired.push('<span class="grv2-revision-badge">재수정 요청</span>');
      } else if (row.parent_revision_row_id && Number(row.revision_no) > 1) {
        desired.push(`<span class="grv2-revision-badge grv2-revision-child">재수정 v${Number(row.revision_no)}</span>`);
      }
      if (
        state.user?.role === "ADMIN" &&
        !projectCompleted() &&
        ["submitted", "approved"].includes(row.review_status)
      ) {
        desired.push(`<button type="button" class="grv2-revision-btn" data-revision-row="${Number(row.id)}">재수정 요청</button>`);
      }
      const html = desired.join("");
      if (wrap.innerHTML !== html) wrap.innerHTML = html;
    });
  }

  async function requestRevision(rowId) {
    if (state.busy || state.user?.role !== "ADMIN") return;
    if (!confirm("이 행을 재수정 요청할까요? 기존 행은 보존되고 새 재수정 행이 생성됩니다.")) return;
    state.busy = true;
    try {
      await api(`/group-review/rows/${rowId}/revision-request`, { method: "POST" });
      await groupReviewApi?.refresh?.();
      setTimeout(refreshContext, 100);
      alert("재수정 요청되었습니다. 작업자에게 새 재수정 행이 생성되었습니다.");
    } catch (error) {
      alert(`재수정 요청 실패: ${error.message}`);
    } finally {
      state.busy = false;
    }
  }

  async function completeSheetRevisionAware() {
    const sheetId = activeSheetId();
    if (state.busy || state.user?.role !== "WORKER" || !sheetId) return;
    if (!confirm("현재 시트 입력을 완료할까요? 재수정 행도 함께 검토 대상으로 제출됩니다.")) return;
    state.busy = true;
    try {
      await api(`/group-review/sheets/${sheetId}/complete-revision-aware`, { method: "POST" });
      await groupReviewApi?.refresh?.();
      setTimeout(refreshContext, 100);
      alert("입력 완료되었습니다.");
    } catch (error) {
      alert(`입력 완료 실패: ${error.message}`);
    } finally {
      state.busy = false;
    }
  }

  async function completeProjectRevisionAware() {
    const projectId = activeProjectId();
    if (state.busy || state.user?.role !== "ADMIN" || !projectId) return;
    const name = document.querySelector("#groupReviewBody .grv2-project-title")?.textContent?.replace(/\s*·\s*완료\s*$/, "") || "선택 프로젝트";
    if (!confirm(`"${name}" 프로젝트를 완료할까요?`)) return;
    state.busy = true;
    try {
      await api(`/group-review/projects/${projectId}/complete-revision-aware`, { method: "POST" });
      await groupReviewApi?.refresh?.();
      setTimeout(refreshContext, 100);
      alert("프로젝트가 완료되었습니다.");
    } catch (error) {
      alert(`프로젝트 완료 실패: ${error.message}`);
    } finally {
      state.busy = false;
    }
  }

  function onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const revisionButton = target.closest("[data-revision-row]");
    if (revisionButton) {
      event.preventDefault();
      event.stopPropagation();
      void requestRevision(Number(revisionButton.dataset.revisionRow));
      return;
    }

    if (target.closest("#grv2CompleteSheet")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void completeSheetRevisionAware();
      return;
    }

    if (target.closest("#grv2CompleteProject")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void completeProjectRevisionAware();
      return;
    }

    if (target.closest(".grv2-tab,.grv2-project-badge,#grv2Refresh,[data-approve-row]")) {
      setTimeout(refreshContext, 120);
    }
  }

  function closeSocket() {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    if (state.socket) {
      state.socket.onclose = null;
      state.socket.close();
    }
    state.socket = null;
  }

  function connectSocket() {
    const projectId = activeProjectId();
    if (!projectId) return;
    if (state.socket && state.projectId === projectId && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.socket.readyState)) return;
    closeSocket();
    state.projectId = projectId;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/api/v1/group-review/ws/projects/${encodeURIComponent(projectId)}`);
    state.socket = socket;
    socket.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "revision_requested") {
          void groupReviewApi?.refresh?.();
          setTimeout(refreshContext, 100);
        }
      } catch (_) {}
    };
    socket.onclose = () => {
      if (state.socket === socket) state.socket = null;
      if (activeProjectId()) state.reconnectTimer = setTimeout(connectSocket, 1500);
    };
  }

  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(refreshContext, 100);
  }

  function startObserver() {
    const body = document.getElementById("groupReviewBody");
    if (!body) return setTimeout(startObserver, 100);
    state.observer = new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.target === body)) scheduleRefresh();
    });
    state.observer.observe(body, { childList: true });
    refreshContext();
  }

  ensureStyles();
  document.addEventListener("click", onClick, true);
  startObserver();
}
