export function installGroupReviewCellLockV2() {
  if (window.__grv2CellLockInstalled) return;
  window.__grv2CellLockInstalled = true;

  const state = {
    socket: null,
    projectId: "",
    connectionId: "",
    pending: new Map(),
    locks: new Map(),
    ownedKey: "",
    observer: null,
    reconnectTimer: null
  };

  function cellKey(sheetId, rowId, fieldName) {
    return `${sheetId}:${rowId}:${fieldName}`;
  }

  function activeProjectId() {
    return document.querySelector("#groupReviewProjectBadges .grv2-project-badge.active")?.dataset?.projectId || "";
  }

  function activeSheetId() {
    return Number(document.querySelector("#groupReviewBody .grv2-tab.active")?.dataset?.sheetId || 0);
  }

  function reviewCells() {
    return Array.from(document.querySelectorAll("#groupReviewBody .grv2-cell[data-row-id][data-field]"));
  }

  function ensureStyles() {
    if (document.getElementById("grv2-cell-lock-styles")) return;
    const style = document.createElement("style");
    style.id = "grv2-cell-lock-styles";
    style.textContent = `
      .grv2-cell.grv2-lock-wait{cursor:wait!important;background:#f8fafc!important}
      .grv2-cell.grv2-locked-other{position:relative;cursor:not-allowed!important;background:#fff7ed!important;box-shadow:inset 0 0 0 2px #f97316!important}
      .grv2-cell.grv2-locked-other::after{content:attr(data-lock-label);position:absolute;right:4px;top:3px;max-width:88%;font-size:10px;line-height:1.2;padding:2px 5px;border-radius:999px;background:#f97316;color:#fff;border:1px solid #ea580c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;font-weight:800}
      .grv2-cell.grv2-lock-owned{box-shadow:inset 0 0 0 2px #2563eb!important}
      .grv2-cell.grv2-lock-owned:not(.grv2-editing){caret-color:transparent!important}
      .grv2-cell.grv2-lock-owned.grv2-editing{caret-color:auto!important}
    `;
    document.head.appendChild(style);
  }

  function lockForCell(cell) {
    return state.locks.get(cellKey(activeSheetId(), Number(cell.dataset.rowId), cell.dataset.field));
  }

  function applyCellState(cell) {
    const key = cellKey(activeSheetId(), Number(cell.dataset.rowId), cell.dataset.field);
    const lock = state.locks.get(key);
    const owned = state.ownedKey === key;
    const editable = cell.classList.contains("editable");

    cell.classList.toggle("grv2-lock-owned", owned);
    cell.classList.toggle("grv2-locked-other", Boolean(lock && !owned));
    if (!owned) cell.classList.remove("grv2-editing");

    if (lock && !owned) {
      cell.dataset.lockLabel = `👤 ${lock.display_name || "다른 작업자"} 사용 중`;
      cell.setAttribute("contenteditable", "false");
    } else if (owned && editable) {
      cell.removeAttribute("data-lock-label");
      cell.setAttribute("contenteditable", "true");
    } else {
      cell.removeAttribute("data-lock-label");
      cell.setAttribute("contenteditable", "false");
    }
  }

  function applyAllCellStates() {
    reviewCells().forEach(applyCellState);
  }

  function send(message) {
    if (state.socket?.readyState !== WebSocket.OPEN) return false;
    state.socket.send(JSON.stringify(message));
    return true;
  }

  function requestLock(cell) {
    if (!cell?.classList.contains("editable")) return;
    const sheetId = activeSheetId();
    const rowId = Number(cell.dataset.rowId);
    const fieldName = cell.dataset.field || "";
    if (!sheetId || !rowId || !fieldName) return;

    const key = cellKey(sheetId, rowId, fieldName);
    const existing = state.locks.get(key);
    if (existing && state.ownedKey !== key) {
      cell.blur();
      return;
    }
    if (state.ownedKey === key) {
      cell.setAttribute("contenteditable", "true");
      cell.focus();
      return;
    }

    releaseOwnedLock();

    const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    state.pending.set(requestId, { cell, key, sheetId, rowId, fieldName });
    cell.classList.add("grv2-lock-wait");

    const ok = send({
      type: "cell_lock_request",
      request_id: requestId,
      sheet_id: sheetId,
      row_id: rowId,
      field_name: fieldName
    });
    if (!ok) {
      state.pending.delete(requestId);
      cell.classList.remove("grv2-lock-wait");
      alert("실시간 연결 후 셀을 다시 선택하세요.");
    }
  }

  function releaseOwnedLock() {
    if (!state.ownedKey) return;
    const [sheetId, rowId, ...fieldParts] = state.ownedKey.split(":");
    const fieldName = fieldParts.join(":");
    send({ type: "cell_unlock", sheet_id: Number(sheetId), row_id: Number(rowId), field_name: fieldName });
    state.locks.delete(state.ownedKey);
    state.ownedKey = "";
    applyAllCellStates();
  }

  function handleMessage(message) {
    if (!message) return;
    if (message.type === "connected") {
      state.connectionId = message.connection_id || "";
      state.locks.clear();
      (message.locks || []).forEach(lock => state.locks.set(lock.key, lock));
      state.ownedKey = "";
      applyAllCellStates();
      return;
    }

    if (message.type === "cell_lock_granted") {
      const pending = state.pending.get(message.request_id);
      if (!pending) return;
      state.pending.delete(message.request_id);
      pending.cell.classList.remove("grv2-lock-wait");
      state.locks.set(message.lock.key, message.lock);
      state.ownedKey = message.lock.key;
      pending.cell.classList.remove("grv2-editing");
      applyAllCellStates();
      if (pending.cell.isConnected) {
        pending.cell.setAttribute("contenteditable", "true");
        pending.cell.focus();
      }
      return;
    }

    if (message.type === "cell_lock_denied") {
      const pending = state.pending.get(message.request_id);
      if (!pending) return;
      state.pending.delete(message.request_id);
      pending.cell.classList.remove("grv2-lock-wait");
      if (message.lock?.key) state.locks.set(message.lock.key, message.lock);
      applyAllCellStates();
      if (message.lock?.display_name) {
        const status = document.getElementById("grv2Status");
        if (status) status.textContent = `${message.lock.display_name} 사용 중`;
      }
      return;
    }

    if (message.type === "cell_locked" && message.lock?.key) {
      state.locks.set(message.lock.key, message.lock);
      applyAllCellStates();
      return;
    }

    if (message.type === "cell_unlocked" && message.lock?.key) {
      state.locks.delete(message.lock.key);
      if (state.ownedKey === message.lock.key) state.ownedKey = "";
      applyAllCellStates();
    }
  }

  function closeSocket() {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    state.pending.clear();
    state.locks.clear();
    state.ownedKey = "";
    if (state.socket) {
      state.socket.onclose = null;
      state.socket.close();
    }
    state.socket = null;
    state.connectionId = "";
    applyAllCellStates();
  }

  function connect() {
    const projectId = activeProjectId();
    if (!projectId) return;
    if (state.socket && state.projectId === projectId && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.socket.readyState)) return;

    closeSocket();
    state.projectId = projectId;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/api/v1/group-review/ws/projects/${encodeURIComponent(projectId)}`);
    state.socket = socket;
    socket.onmessage = event => {
      try { handleMessage(JSON.parse(event.data)); } catch (_) {}
    };
    socket.onclose = () => {
      if (state.socket === socket) state.socket = null;
      state.connectionId = "";
      state.pending.clear();
      state.locks.clear();
      state.ownedKey = "";
      applyAllCellStates();
      if (activeProjectId()) state.reconnectTimer = setTimeout(connect, 1500);
    };
  }

  function onPointerDown(event) {
    const cell = event.target instanceof Element ? event.target.closest("#groupReviewBody .grv2-cell.editable") : null;
    if (!cell) return;
    const lock = lockForCell(cell);
    const key = cellKey(activeSheetId(), Number(cell.dataset.rowId), cell.dataset.field);
    if (state.ownedKey === key) return;
    event.preventDefault();
    event.stopPropagation();
    if (lock) {
      const status = document.getElementById("grv2Status");
      if (status) status.textContent = `${lock.display_name || "다른 작업자"} 사용 중`;
      return;
    }
    requestLock(cell);
  }

  function findDirectionalTarget(cell, key) {
    const row = cell.closest(".grv2-row");
    if (!row) return null;

    if (key === "ArrowLeft" || key === "ArrowRight") {
      const cells = Array.from(row.querySelectorAll(".grv2-cell.editable"));
      const index = cells.indexOf(cell);
      if (index < 0) return null;
      const nextIndex = index + (key === "ArrowLeft" ? -1 : 1);
      return cells[nextIndex] || null;
    }

    const rows = Array.from(document.querySelectorAll("#groupReviewBody .grv2-row"));
    const rowIndex = rows.indexOf(row);
    if (rowIndex < 0) return null;
    const step = key === "ArrowUp" ? -1 : 1;
    const fieldName = cell.dataset.field;

    for (let index = rowIndex + step; index >= 0 && index < rows.length; index += step) {
      const candidate = Array.from(rows[index].querySelectorAll(".grv2-cell.editable"))
        .find(item => item.dataset.field === fieldName);
      if (candidate) return candidate;
    }
    return null;
  }

  function ownedCellFromEvent(event) {
    const cell = event.target instanceof Element ? event.target.closest("#groupReviewBody .grv2-cell.editable") : null;
    if (!cell) return null;
    const key = cellKey(activeSheetId(), Number(cell.dataset.rowId), cell.dataset.field);
    return state.ownedKey === key ? cell : null;
  }

  function beginEditing(event) {
    const cell = ownedCellFromEvent(event);
    if (cell) cell.classList.add("grv2-editing");
  }

  function onKeyDown(event) {
    const cell = ownedCellFromEvent(event);
    if (!cell) return;

    if (event.key === "Escape" && cell.classList.contains("grv2-editing")) {
      event.preventDefault();
      event.stopPropagation();
      cell.classList.remove("grv2-editing");
      return;
    }

    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;

    // Once text input has started, arrow keys belong to the text caret.
    if (cell.classList.contains("grv2-editing")) return;

    event.preventDefault();
    event.stopPropagation();

    const target = findDirectionalTarget(cell, event.key);
    if (!target) return;

    const targetLock = lockForCell(target);
    const targetKey = cellKey(activeSheetId(), Number(target.dataset.rowId), target.dataset.field);
    if (targetLock && state.ownedKey !== targetKey) {
      const status = document.getElementById("grv2Status");
      if (status) status.textContent = `${targetLock.display_name || "다른 작업자"} 사용 중`;
      return;
    }

    // Selection mode: save/release the current cell and select the next cell.
    cell.blur();
    requestAnimationFrame(() => {
      if (target.isConnected) requestLock(target);
    });
  }

  function onFocusOut(event) {
    const cell = event.target instanceof Element ? event.target.closest("#groupReviewBody .grv2-cell.editable") : null;
    if (!cell) return;
    const key = cellKey(activeSheetId(), Number(cell.dataset.rowId), cell.dataset.field);
    if (state.ownedKey !== key) return;
    setTimeout(() => {
      if (state.ownedKey === key) releaseOwnedLock();
    }, 800);
  }

  function onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest(".grv2-project-badge")) {
      releaseOwnedLock();
      setTimeout(connect, 150);
    } else if (target.closest(".grv2-tab")) {
      releaseOwnedLock();
      setTimeout(applyAllCellStates, 100);
    } else if (target.closest("#grv2CompleteSheet,#grv2Refresh,#grv2Logout")) {
      releaseOwnedLock();
    }
  }

  function startObserver() {
    const body = document.getElementById("groupReviewBody");
    if (!body) return setTimeout(startObserver, 100);
    state.observer = new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.target === body || mutation.addedNodes.length)) {
        connect();
        applyAllCellStates();
      }
    });
    state.observer.observe(body, { childList: true, subtree: true });
    connect();
    applyAllCellStates();
  }

  ensureStyles();
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("beforeinput", beginEditing, true);
  document.addEventListener("compositionstart", beginEditing, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("click", onClick, true);
  window.addEventListener("beforeunload", releaseOwnedLock);
  startObserver();
}
