const API_ROOT = "/api/v1";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json; charset=utf-8";
  }
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers, credentials: "include" });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.detail || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export function initGroupReviewV2() {
  const state = {
    user: null,
    projects: [],
    project: null,
    sheets: [],
    sheet: null,
    rows: [],
    selectedCell: null,
    loading: false,
    socket: null,
    reconnectTimer: null,
    saveTimers: new Map(),
    saveInFlight: new Map()
  };

  const fieldDefs = [
    ["collateral_no", "collateral_no", true],
    ["sheet_label", "sheet_label", true],
    ["field_no", "field_no", true],
    ["change_before_text", "change_before", false],
    ["change_after_text", "change_after", false]
  ];

  const bodyEl = () => document.getElementById("groupReviewBody");
  const badgesEl = () => document.getElementById("groupReviewProjectBadges");
  const panelEl = () => document.querySelector('.sheet-panel[data-index="13"]');

  function ensureStyles() {
    if (document.getElementById("grv2-styles")) return;
    const style = document.createElement("style");
    style.id = "grv2-styles";
    style.textContent = `
      .grv2{font-family:Segoe UI,Noto Sans KR,Arial,sans-serif;color:#111827}
      .grv2-userbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;padding:10px 12px;background:#f8fafc;border:1px solid #dbe2ea;border-radius:8px}
      .grv2-user{font-size:13px}.grv2-user strong{margin-right:8px}.grv2-role{font-size:11px;padding:3px 7px;border-radius:999px;background:#e2e8f0}
      .grv2-live{font-size:11px;margin-left:8px}.grv2-live.on{color:#059669}.grv2-live.off{color:#b45309}
      .grv2-btn{border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:7px 10px;cursor:pointer}.grv2-btn:hover{background:#f8fafc}.grv2-btn:disabled{opacity:.5;cursor:not-allowed}
      .grv2-primary{background:#1d4ed8!important;color:#fff;border-color:#1d4ed8!important}.grv2-danger{border-color:#dc2626!important;color:#b91c1c}.grv2-success{border-color:#059669!important;color:#047857}
      .grv2-login{max-width:420px;margin:24px auto;padding:22px;background:white;border:1px solid #dbe2ea;border-radius:10px}.grv2-login h3{margin:0 0 14px}.grv2-login label{display:block;font-size:12px;font-weight:700;margin:10px 0 5px}.grv2-login input{width:100%;height:38px;border:1px solid #cbd5e1;border-radius:7px;padding:0 10px}.grv2-login button{width:100%;height:40px;margin-top:14px;background:#1d4ed8;color:white;border:0;border-radius:7px;font-weight:700;cursor:pointer}
      .grv2-note{padding:18px;border:1px dashed #cbd5e1;border-radius:8px;background:#f8fafc;color:#64748b;text-align:center}
      .grv2-tabs{display:flex;gap:5px;overflow:auto;border:1px solid #dbe2ea;border-bottom:0;background:#fff;padding:8px 8px 0;border-radius:9px 9px 0 0}.grv2-tab{border:1px solid transparent;border-bottom:0;background:#f1f5f9;border-radius:7px 7px 0 0;padding:7px 11px;cursor:pointer;white-space:nowrap}.grv2-tab.active{background:#fff;border-color:#dbe2ea;font-weight:700;position:relative;top:1px}.grv2-tab.own{box-shadow:inset 0 2px 0 #2563eb}.grv2-tab.done{color:#047857}
      .grv2-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:white;border:1px solid #dbe2ea;padding:8px}.grv2-toolbar select,.grv2-toolbar button{height:32px;border:1px solid #cbd5e1;background:white;border-radius:6px;padding:0 9px}.grv2-toolbar button{cursor:pointer}.grv2-toolbar .bold{font-weight:800}.grv2-toolbar .strike{text-decoration:line-through}.grv2-toolbar .spacer{flex:1}.grv2-status{font-size:12px;color:#64748b}
      .grv2-color-group{display:flex;align-items:center;gap:4px;padding-left:2px}.grv2-color-label{font-size:12px;color:#475569;margin-right:2px}.grv2-color-btn{width:30px!important;min-width:30px!important;padding:0!important;border:1px solid #94a3b8!important;font-weight:800}.grv2-color-btn:hover{box-shadow:0 0 0 2px #cbd5e1}.grv2-color-btn.clear{background:#fff!important;color:#64748b}.grv2-custom-color{height:32px;display:inline-flex;align-items:center;gap:5px;border:1px solid #cbd5e1;border-radius:6px;padding:0 7px;font-size:11px;color:#475569;background:#fff;cursor:pointer}.grv2-custom-color input{width:22px;height:22px;border:0;padding:0;background:transparent;cursor:pointer}.grv2-custom-color:has(input:disabled){opacity:.5;cursor:not-allowed}
      .grv2-grid{overflow:auto;border:1px solid #dbe2ea;border-top:0;background:white;min-height:360px}.grv2 table{width:100%;min-width:1130px;border-collapse:separate;border-spacing:0;table-layout:fixed}.grv2 th,.grv2 td{border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0}.grv2 th{position:sticky;top:0;z-index:2;background:#f8fafc;padding:9px 6px;font-size:12px}.grv2 td{padding:0;vertical-align:top}.grv2-no{width:46px;text-align:center;background:#fafafa;color:#64748b;font-size:12px;vertical-align:middle!important}.grv2-cell{min-height:38px;padding:8px;outline:none;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45}.grv2-cell.center{text-align:center}.grv2-cell.editable:focus,.grv2-cell.selected{box-shadow:inset 0 0 0 2px #2563eb}.grv2-cell.readonly{background:#f8fafc}.grv2-row.approved td,.grv2-row.approved .grv2-cell{background:#e5e7eb!important;color:#6b7280}.grv2-del{width:100%;height:38px;border:0;background:transparent;color:#94a3b8;font-size:18px;cursor:pointer}.grv2-del:hover{background:#fef2f2;color:#dc2626}.grv2-approve{height:30px;margin:4px;border:1px solid #94a3b8;background:#fff;border-radius:6px;padding:0 8px;cursor:pointer}.grv2-approved{display:block;padding:10px 4px;text-align:center;font-size:12px;color:#475569;font-weight:700}
      .grv2-bottom{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#fff;border:1px solid #dbe2ea;border-top:0;border-radius:0 0 9px 9px;padding:9px}.grv2-bottom-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.grv2-savehint{font-size:12px;color:#64748b}.grv2-project-title{font-weight:700;font-size:14px;margin:0 0 8px}.grv2-error{color:#b91c1c;font-size:12px;margin-top:8px}
      #groupReviewProjectBadges .grv2-project-badge{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:6px 10px;cursor:pointer;margin:0 5px 6px 0}#groupReviewProjectBadges .grv2-project-badge.active{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
    `;
    document.head.appendChild(style);
  }

  function setLegacyToolbarState() {
    const buttons = panelEl()?.querySelectorAll(".work-toolbar button") || [];
    if (buttons[0]) buttons[0].style.display = state.user?.role === "ADMIN" ? "" : "none";
    if (buttons[1]) buttons[1].style.display = state.user ? "" : "none";
    if (buttons[2]) buttons[2].style.display = "none";
    if (buttons[3]) buttons[3].style.display = "none";
  }

  function renderBadges() {
    const wrap = badgesEl();
    if (!wrap) return;
    if (!state.user || !state.projects.length) return void (wrap.innerHTML = "");
    wrap.innerHTML = state.projects.map(project => `<button type="button" class="grv2-project-badge ${state.project?.id === project.id ? "active" : ""}" data-project-id="${escapeHtml(project.id)}">${escapeHtml(project.name)}${project.completed ? " · 완료" : ""}</button>`).join("");
    wrap.querySelectorAll("[data-project-id]").forEach(button => button.addEventListener("click", () => selectProject(button.dataset.projectId)));
  }

  function renderLogin() {
    setLegacyToolbarState();
    renderBadges();
    const body = bodyEl();
    if (!body) return;
    body.innerHTML = `<div class="grv2"><div class="grv2-login"><h3>그룹리뷰 로그인</h3><div style="font-size:12px;color:#64748b">그룹리뷰 V2는 로컬 계정으로 로그인합니다.</div><form id="grv2LoginForm"><label for="grv2LoginId">아이디</label><input id="grv2LoginId" autocomplete="username" required><label for="grv2Password">비밀번호</label><input id="grv2Password" type="password" autocomplete="current-password" required><button type="submit">로그인</button><div id="grv2LoginError" class="grv2-error"></div></form></div></div>`;
    document.getElementById("grv2LoginForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const errorEl = document.getElementById("grv2LoginError");
      if (errorEl) errorEl.textContent = "";
      try {
        state.user = await api("/auth/login", { method: "POST", body: JSON.stringify({ login_id: document.getElementById("grv2LoginId").value, password: document.getElementById("grv2Password").value }) });
        await loadProjects();
      } catch (error) {
        if (errorEl) errorEl.textContent = error.message || "로그인에 실패했습니다.";
      }
    });
  }

  const styleFor = (row, key) => row.cell_styles?.[key] || {};
  function styleText(style) {
    const parts = [];
    if (style.fontSize) parts.push(`font-size:${style.fontSize}px`);
    if (style.bold) parts.push("font-weight:700");
    if (style.strike) parts.push("text-decoration:line-through");
    if (style.backgroundColor) parts.push(`background-color:${style.backgroundColor}`);
    return parts.join(";");
  }

  function isOwnSheet(sheet = state.sheet) {
    return !!(state.user?.role === "WORKER" && sheet && sheet.member_name === state.user.display_name);
  }

  function rowEditable(row) {
    return isOwnSheet() && !state.sheet?.completed && !state.sheet?.review_completed && !state.project?.completed && row.review_status === "draft";
  }

  function status(text) {
    const el = document.getElementById("grv2Status");
    if (el) el.textContent = text;
  }

  function updateLiveIndicator() {
    const el = document.getElementById("grv2Live");
    if (!el) return;
    const connected = state.socket?.readyState === WebSocket.OPEN;
    el.className = `grv2-live ${connected ? "on" : "off"}`;
    el.textContent = connected ? "● 실시간 연결" : "● 연결 중";
  }

  function renderMain() {
    ensureStyles();
    setLegacyToolbarState();
    renderBadges();
    const body = bodyEl();
    if (!body) return;
    if (!state.user) return renderLogin();

    const ownSheet = isOwnSheet();
    const sheetEditable = ownSheet && !state.sheet?.completed && !state.sheet?.review_completed && !state.project?.completed;
    const tabs = state.sheets.map(sheet => `<button type="button" class="grv2-tab ${state.sheet?.id === sheet.id ? "active" : ""} ${isOwnSheet(sheet) ? "own" : ""} ${sheet.completed ? "done" : ""}" data-sheet-id="${sheet.id}">${escapeHtml(sheet.member_name)}${isOwnSheet(sheet) ? " · 나" : ""}${sheet.completed ? " · 입력완료" : ""}</button>`).join("");
    const rowHtml = state.rows.map((row, index) => renderRowHtml(row, index)).join("");
    const readonlyMessage = state.project?.completed
      ? "프로젝트 완료 · 읽기 전용"
      : state.user.role === "ADMIN"
        ? "관리자: 행별 확인 가능"
        : ownSheet
          ? (state.sheet?.completed ? "입력 완료 · 관리자 검토 중" : "자동저장 사용 중")
          : `${state.sheet?.member_name || "다른 작업자"} 시트 · 읽기 전용`;

    const workerActions = state.user.role === "WORKER" && ownSheet
      ? `<button id="grv2CompleteSheet" type="button" class="grv2-btn grv2-success" ${state.sheet?.completed || state.project?.completed ? "disabled" : ""}>${state.sheet?.completed ? "입력 완료됨" : "입력 완료"}</button>`
      : "";
    const adminActions = state.user.role === "ADMIN"
      ? (state.project?.completed
          ? '<button id="grv2ReopenProject" type="button" class="grv2-btn grv2-danger">재오픈</button>'
          : '<button id="grv2CompleteProject" type="button" class="grv2-btn grv2-primary">프로젝트 완료</button>')
      : "";

    const quickColors = [
      ["노랑", "#FFF3B0"],
      ["연두", "#DCFCE7"],
      ["빨강", "#FECACA"],
      ["파랑", "#DBEAFE"],
      ["회색", "#E5E7EB"]
    ].map(([label, color]) => `<button type="button" class="grv2-color-btn" data-bg-color="${color}" title="${label}" aria-label="${label}" style="background:${color}" ${sheetEditable ? "" : "disabled"}></button>`).join("");

    body.innerHTML = `<div class="grv2"><div class="grv2-userbar"><div class="grv2-user"><strong>${escapeHtml(state.user.display_name)}</strong><span class="grv2-role">${escapeHtml(state.user.role)}</span><span id="grv2Live" class="grv2-live off">● 연결 중</span></div><button id="grv2Logout" type="button" class="grv2-btn">그룹리뷰 로그아웃</button></div>${state.project ? `<div class="grv2-project-title">${escapeHtml(state.project.name)}${state.project.completed ? " · 완료" : ""}</div>` : ""}${!state.project ? '<div class="grv2-note">생성된 리뷰 프로젝트가 없습니다.</div>' : `<div class="grv2-tabs">${tabs}</div><div class="grv2-toolbar"><select id="grv2Size" ${sheetEditable ? "" : "disabled"}><option>12</option><option selected>13</option><option>15</option><option>18</option><option>22</option></select><button id="grv2Bold" class="bold" type="button" ${sheetEditable ? "" : "disabled"}>B</button><button id="grv2Strike" class="strike" type="button" ${sheetEditable ? "" : "disabled"}>S</button><span class="grv2-color-group"><span class="grv2-color-label">셀 색</span>${quickColors}<button type="button" class="grv2-color-btn clear" data-bg-color="" title="색 제거" aria-label="색 제거" ${sheetEditable ? "" : "disabled"}>×</button><label class="grv2-custom-color" title="직접 색상"><span>직접</span><input id="grv2BgCustom" type="color" value="#FFF3B0" ${sheetEditable ? "" : "disabled"}></label></span><button id="grv2Clear" type="button" ${sheetEditable ? "" : "disabled"}>서식 지우기</button><span class="spacer"></span><span id="grv2Status" class="grv2-status">${readonlyMessage}</span></div><div class="grv2-grid"><table><thead><tr><th style="width:46px">#</th><th style="width:86px">Collateral#</th><th style="width:68px">Sheet</th><th style="width:76px">Field No.</th><th style="width:390px">변경전</th><th style="width:390px">변경후</th><th style="width:74px">${state.user.role === "ADMIN" ? "확인" : "삭제"}</th></tr></thead><tbody>${rowHtml}</tbody></table></div><div class="grv2-bottom"><div class="grv2-bottom-actions"><button id="grv2Add" type="button" class="grv2-btn" ${sheetEditable ? "" : "disabled"}>+ 행 추가</button>${workerActions}${adminActions}</div><span class="grv2-savehint">${sheetEditable ? "0.5초 입력 멈춤 또는 셀 이동 시 자동 저장" : readonlyMessage}</span></div>`}</div>`;

    bindViewEvents();
    updateLiveIndicator();
  }

  function renderRowHtml(row, index) {
    const editable = rowEditable(row);
    const approved = row.review_status === "approved";
    const cells = fieldDefs.map(([field, styleKey, centered]) => `<td><div class="grv2-cell ${centered ? "center" : ""} ${editable ? "editable" : "readonly"}" ${editable ? 'contenteditable="true"' : ""} spellcheck="false" data-row-id="${row.id}" data-field="${field}" data-style-key="${styleKey}" style="${escapeHtml(styleText(styleFor(row, styleKey)))}">${escapeHtml(row[field])}</div></td>`).join("");
    const action = state.user.role === "ADMIN"
      ? (approved ? '<span class="grv2-approved">확인완료</span>' : (state.project?.completed ? "" : `<button type="button" class="grv2-approve" data-approve-row="${row.id}">확인</button>`))
      : (editable ? `<button class="grv2-del" type="button" data-delete-row="${row.id}">×</button>` : "");
    return `<tr class="grv2-row ${approved ? "approved" : ""}" data-row-id="${row.id}"><td class="grv2-no">${index + 1}</td>${cells}<td>${action}</td></tr>`;
  }

  function bindRowEvents(rowEl) {
    rowEl.querySelectorAll(".grv2-cell.editable").forEach(cell => {
      cell.addEventListener("focus", () => selectCell(cell));
      cell.addEventListener("click", () => selectCell(cell));
      cell.addEventListener("input", () => scheduleCellSave(cell));
      cell.addEventListener("blur", () => flushCellSave(cell));
    });
    rowEl.querySelector("[data-delete-row]")?.addEventListener("click", event => removeRow(Number(event.currentTarget.dataset.deleteRow)));
    rowEl.querySelector("[data-approve-row]")?.addEventListener("click", event => approveRow(Number(event.currentTarget.dataset.approveRow)));
  }

  function bindViewEvents() {
    document.getElementById("grv2Logout")?.addEventListener("click", logoutLocal);
    bodyEl()?.querySelectorAll("[data-sheet-id]").forEach(button => button.addEventListener("click", () => selectSheet(Number(button.dataset.sheetId))));
    bodyEl()?.querySelectorAll(".grv2-row").forEach(bindRowEvents);
    bodyEl()?.querySelectorAll("[data-bg-color]").forEach(button => button.addEventListener("click", () => updateSelectedStyle("backgroundColor", button.dataset.bgColor || "")));
    document.getElementById("grv2Add")?.addEventListener("click", addRow);
    document.getElementById("grv2CompleteSheet")?.addEventListener("click", completeSheet);
    document.getElementById("grv2CompleteProject")?.addEventListener("click", completeProject);
    document.getElementById("grv2ReopenProject")?.addEventListener("click", reopenProject);
    document.getElementById("grv2Size")?.addEventListener("change", event => updateSelectedStyle("fontSize", Number(event.target.value)));
    document.getElementById("grv2Bold")?.addEventListener("click", () => toggleSelectedStyle("bold"));
    document.getElementById("grv2Strike")?.addEventListener("click", () => toggleSelectedStyle("strike"));
    document.getElementById("grv2BgCustom")?.addEventListener("change", event => updateSelectedStyle("backgroundColor", event.target.value));
    document.getElementById("grv2Clear")?.addEventListener("click", clearSelectedStyle);
  }

  function replaceRowDom(row) {
    const current = bodyEl()?.querySelector(`.grv2-row[data-row-id="${row.id}"]`);
    if (!current) {
      renderMain();
      return;
    }
    const index = state.rows.findIndex(item => item.id === row.id);
    const template = document.createElement("tbody");
    template.innerHTML = renderRowHtml(row, index);
    const replacement = template.firstElementChild;
    current.replaceWith(replacement);
    bindRowEvents(replacement);
  }

  function selectCell(cell) {
    if (!isOwnSheet()) return;
    document.querySelectorAll(".grv2-cell.selected").forEach(el => el.classList.remove("selected"));
    cell.classList.add("selected");
    const row = state.rows.find(item => item.id === Number(cell.dataset.rowId));
    state.selectedCell = row ? { row, field: cell.dataset.field, styleKey: cell.dataset.styleKey, el: cell } : null;
  }

  const cellKey = cell => `${cell.dataset.rowId}:${cell.dataset.field}`;
  function scheduleCellSave(cell) {
    const key = cellKey(cell);
    clearTimeout(state.saveTimers.get(key));
    status("입력 중...");
    state.saveTimers.set(key, setTimeout(() => saveCellText(cell), 500));
  }

  function flushCellSave(cell) {
    const key = cellKey(cell);
    clearTimeout(state.saveTimers.get(key));
    state.saveTimers.delete(key);
    return saveCellText(cell);
  }

  async function flushActiveCell() {
    const active = document.activeElement;
    if (active?.classList?.contains("grv2-cell") && active.classList.contains("editable")) {
      await flushCellSave(active);
    }
  }

  async function saveCellText(cell) {
    if (!cell?.isConnected || !isOwnSheet()) return;
    const rowId = Number(cell.dataset.rowId);
    const field = cell.dataset.field;
    const row = state.rows.find(item => item.id === rowId);
    if (!row || row.review_status !== "draft") return;
    const value = cell.innerText.replace(/\r/g, "");
    if (value === row[field]) return;
    const key = cellKey(cell);
    if (state.saveInFlight.get(key) === value) return;
    state.saveInFlight.set(key, value);
    try {
      status("저장 중...");
      const updated = await api(`/group-review/rows/${rowId}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) });
      Object.assign(row, updated);
      status("저장됨");
    } catch (error) {
      cell.textContent = row[field] || "";
      status(`저장 실패: ${error.message}`);
      alert(`저장 실패: ${error.message}`);
    } finally {
      state.saveInFlight.delete(key);
    }
  }

  async function addRow() {
    if (!state.sheet || !isOwnSheet()) return;
    try { await api(`/group-review/sheets/${state.sheet.id}/rows`, { method: "POST", body: JSON.stringify({}) }); await loadRows(); }
    catch (error) { alert(`행 추가 실패: ${error.message}`); }
  }

  async function removeRow(rowId) {
    if (!isOwnSheet() || !confirm("이 행을 삭제하시겠습니까?")) return;
    try { await api(`/group-review/rows/${rowId}`, { method: "DELETE" }); await loadRows(); }
    catch (error) { alert(`행 삭제 실패: ${error.message}`); }
  }

  async function approveRow(rowId) {
    if (state.user?.role !== "ADMIN") return;
    try {
      status("확인 처리 중...");
      const updated = await api(`/group-review/rows/${rowId}/approve`, { method: "POST" });
      applyRowUpdate(updated);
      replaceRowDom(updated);
      status("확인 완료");
    } catch (error) { alert(`확인 처리 실패: ${error.message}`); }
  }

  async function completeSheet() {
    if (!state.sheet || !isOwnSheet() || state.sheet.completed) return;
    if (!confirm("현재 시트 입력을 완료할까요? 완료 후에는 관리자 검토가 끝날 때까지 수정할 수 없습니다.")) return;
    try {
      await flushActiveCell();
      const completed = await api(`/group-review/sheets/${state.sheet.id}/complete`, { method: "POST" });
      state.sheet = { ...state.sheet, ...completed };
      state.sheets = state.sheets.map(sheet => sheet.id === completed.id ? { ...sheet, ...completed } : sheet);
      await loadRows();
      alert("입력 완료되었습니다. 관리자가 행별 확인 후 프로젝트를 완료할 수 있습니다.");
    } catch (error) { alert(`입력 완료 실패: ${error.message}`); }
  }

  async function completeProject() {
    if (state.user?.role !== "ADMIN" || !state.project || state.project.completed) return;
    if (!confirm(`"${state.project.name}" 프로젝트를 완료할까요? 완료 후 전체가 읽기 전용이 됩니다.`)) return;
    try {
      const project = await api(`/group-review/projects/${state.project.id}/complete`, { method: "POST" });
      state.project = project;
      state.projects = state.projects.map(item => item.id === project.id ? { ...item, completed: true } : item);
      await refreshCurrentProjectState();
      alert("프로젝트가 완료되었습니다.");
    } catch (error) { alert(`프로젝트 완료 실패: ${error.message}`); }
  }

  async function reopenProject() {
    if (state.user?.role !== "ADMIN" || !state.project || !state.project.completed) return;
    if (!confirm(`"${state.project.name}" 프로젝트를 재오픈할까요? 확인 완료된 회색 행은 잠긴 채 유지됩니다.`)) return;
    try {
      const project = await api(`/group-review/projects/${state.project.id}/reopen`, { method: "POST" });
      state.project = project;
      state.projects = state.projects.map(item => item.id === project.id ? { ...item, completed: false } : item);
      await refreshCurrentProjectState();
      alert("프로젝트가 재오픈되었습니다. 작업자는 미확인 영역과 새 행을 다시 작업할 수 있습니다.");
    } catch (error) { alert(`재오픈 실패: ${error.message}`); }
  }

  async function persistSelectedStyles() {
    if (!state.selectedCell || !isOwnSheet() || state.selectedCell.row.review_status !== "draft") return;
    try {
      const updated = await api(`/group-review/rows/${state.selectedCell.row.id}`, { method: "PATCH", body: JSON.stringify({ cell_styles: state.selectedCell.row.cell_styles || {} }) });
      Object.assign(state.selectedCell.row, updated);
      replaceRowDom(updated);
      status("서식 저장됨");
    } catch (error) { alert(`서식 저장 실패: ${error.message}`); }
  }

  async function updateSelectedStyle(key, value) {
    if (!state.selectedCell) return alert("먼저 내 시트의 셀을 선택하세요.");
    const { row, styleKey } = state.selectedCell;
    row.cell_styles ||= {}; row.cell_styles[styleKey] ||= {}; row.cell_styles[styleKey][key] = value;
    await persistSelectedStyles();
  }

  async function toggleSelectedStyle(key) {
    if (!state.selectedCell) return alert("먼저 내 시트의 셀을 선택하세요.");
    const { row, styleKey } = state.selectedCell;
    row.cell_styles ||= {}; row.cell_styles[styleKey] ||= {}; row.cell_styles[styleKey][key] = !row.cell_styles[styleKey][key];
    await persistSelectedStyles();
  }

  async function clearSelectedStyle() {
    if (!state.selectedCell) return alert("먼저 내 시트의 셀을 선택하세요.");
    state.selectedCell.row.cell_styles ||= {};
    state.selectedCell.row.cell_styles[state.selectedCell.styleKey] = {};
    await persistSelectedStyles();
  }

  function applyRowUpdate(row) {
    const index = state.rows.findIndex(item => item.id === row.id);
    if (index >= 0) state.rows[index] = row;
    else state.rows.push(row);
    state.rows.sort((a, b) => a.position - b.position);
  }

  function applySheetsUpdate(sheets) {
    if (!Array.isArray(sheets)) return;
    const selectedId = state.sheet?.id;
    state.sheets = sheets;
    state.sheet = state.sheets.find(sheet => sheet.id === selectedId)
      || (state.user?.role === "WORKER" ? state.sheets.find(sheet => sheet.member_name === state.user.display_name) : null)
      || state.sheets[0]
      || null;
  }

  async function refreshCurrentProjectState() {
    if (!state.project) return renderMain();
    const selectedId = state.sheet?.id;
    state.project = await api(`/group-review/projects/${state.project.id}`);
    state.sheets = await api(`/group-review/projects/${state.project.id}/sheets`);
    state.sheet = state.sheets.find(sheet => sheet.id === selectedId)
      || (state.user?.role === "WORKER" ? state.sheets.find(sheet => sheet.member_name === state.user.display_name) : null)
      || state.sheets[0]
      || null;
    state.rows = state.sheet ? await api(`/group-review/sheets/${state.sheet.id}/rows`) : [];
    state.selectedCell = null;
    renderMain();
    renderBadges();
  }

  function handleRealtime(message) {
    if (!message || message.actor_login_id === state.user?.login_id) return;

    if (message.type === "project_completed" || message.type === "project_reopened") {
      state.project = message.project || state.project;
      state.projects = state.projects.map(item => item.id === state.project?.id ? { ...item, completed: !!state.project.completed } : item);
      applySheetsUpdate(message.sheets);
      loadRows();
      renderBadges();
      return;
    }

    if (message.type === "sheet_completed") {
      const completedSheet = message.sheet;
      if (completedSheet) {
        state.sheets = state.sheets.map(sheet => sheet.id === completedSheet.id ? { ...sheet, ...completedSheet } : sheet);
        if (state.sheet?.id === completedSheet.id) {
          state.sheet = { ...state.sheet, ...completedSheet };
          state.rows = Array.isArray(message.rows) ? message.rows : state.rows;
          renderMain();
        } else {
          renderMain();
        }
      }
      return;
    }

    if (Number(message.sheet_id) !== Number(state.sheet?.id)) return;
    if (message.type === "row_upserted" || message.type === "row_approved") {
      const focused = document.activeElement?.classList?.contains("grv2-cell") ? document.activeElement : null;
      const focusedRowId = Number(focused?.dataset?.rowId || 0);
      if (message.type === "row_upserted" && focusedRowId === Number(message.row?.id)) return;
      applyRowUpdate(message.row);
      replaceRowDom(message.row);
      if (message.type === "row_approved") status("관리자 확인이 실시간 반영되었습니다.");
    } else if (message.type === "row_deleted") {
      state.rows = state.rows.filter(row => row.id !== Number(message.row_id));
      bodyEl()?.querySelector(`.grv2-row[data-row-id="${message.row_id}"]`)?.remove();
    } else if (message.type === "rows_reordered") {
      const focused = document.activeElement?.classList?.contains("grv2-cell");
      state.rows = Array.isArray(message.rows) ? message.rows : state.rows;
      if (!focused) renderMain();
    }
  }

  function closeSocket() {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    if (state.socket) {
      state.socket.onclose = null;
      state.socket.close();
      state.socket = null;
    }
    updateLiveIndicator();
  }

  function connectSocket() {
    closeSocket();
    if (!state.user || !state.project) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/api/v1/group-review/ws/projects/${encodeURIComponent(state.project.id)}`);
    state.socket = socket;
    socket.onopen = updateLiveIndicator;
    socket.onmessage = event => { try { handleRealtime(JSON.parse(event.data)); } catch (_) {} };
    socket.onclose = () => {
      if (state.socket === socket) state.socket = null;
      updateLiveIndicator();
      if (state.user && state.project) state.reconnectTimer = setTimeout(connectSocket, 1500);
    };
  }

  async function loadRows() {
    if (!state.sheet) { state.rows = []; renderMain(); return; }
    state.rows = await api(`/group-review/sheets/${state.sheet.id}/rows`);
    state.selectedCell = null;
    renderMain();
  }

  async function selectSheet(sheetId) {
    state.sheet = state.sheets.find(sheet => sheet.id === sheetId) || null;
    await loadRows();
  }

  async function selectProject(projectId) {
    try {
      state.project = await api(`/group-review/projects/${projectId}`);
      state.sheets = await api(`/group-review/projects/${projectId}/sheets`);
      state.sheet = state.user.role === "WORKER" ? (state.sheets.find(sheet => sheet.member_name === state.user.display_name) || state.sheets[0] || null) : (state.sheets[0] || null);
      await loadRows();
      renderBadges();
      connectSocket();
    } catch (error) { alert(`프로젝트 불러오기 실패: ${error.message}`); }
  }

  async function loadProjects(preferredProjectId = null) {
    if (!state.user) return renderLogin();
    state.projects = await api("/group-review/projects");
    const targetId = preferredProjectId || state.project?.id || state.projects[0]?.id || null;
    if (!targetId) { state.project = null; state.sheets = []; state.sheet = null; state.rows = []; closeSocket(); renderMain(); return; }
    await selectProject(targetId);
  }

  async function refreshSessionAndData() {
    if (state.loading) return;
    state.loading = true;
    ensureStyles();
    try { state.user = await api("/auth/me"); await loadProjects(); }
    catch (error) {
      if (error.status === 401) { closeSocket(); state.user = null; state.projects = []; state.project = null; state.sheets = []; state.sheet = null; state.rows = []; renderLogin(); }
      else { const body = bodyEl(); if (body) body.innerHTML = `<div class="grv2"><div class="grv2-note">그룹리뷰 연결 실패: ${escapeHtml(error.message)}</div></div>`; }
    } finally { state.loading = false; }
  }

  async function logoutLocal() {
    closeSocket();
    try { await api("/auth/logout", { method: "POST" }); } catch (_) {}
    state.user = null; state.projects = []; state.project = null; state.sheets = []; state.sheet = null; state.rows = [];
    renderLogin();
  }

  async function createProjectPrompt() {
    if (state.user?.role !== "ADMIN") return alert("그룹리뷰 관리자 계정으로 로그인해야 합니다.");
    const name = prompt("리뷰 프로젝트명을 입력하세요.");
    if (!name?.trim()) return;
    try { const created = await api("/group-review/projects", { method: "POST", body: JSON.stringify({ name: name.trim() }) }); await loadProjects(created.id); }
    catch (error) { alert(`프로젝트 생성 실패: ${error.message}`); }
  }

  async function downloadExcel() {
    if (!state.user || !state.project) return alert("프로젝트를 먼저 선택하세요.");
    if (!window.XLSX) return alert("엑셀 라이브러리를 불러오지 못했습니다.");
    try {
      const sheets = await api(`/group-review/projects/${state.project.id}/sheets`);
      const workbook = XLSX.utils.book_new();
      for (const sheet of sheets) {
        const rows = await api(`/group-review/sheets/${sheet.id}/rows`);
        const data = rows.map(row => ({ "Collateral#": row.collateral_no, "Sheet": row.sheet_label, "Field No.": row.field_no, "변경전": row.change_before_text, "변경후": row.change_after_text, "확인": row.review_status === "approved" ? "Y" : "" }));
        const worksheet = XLSX.utils.json_to_sheet(data.length ? data : [{ "Collateral#": "", "Sheet": "", "Field No.": "", "변경전": "", "변경후": "", "확인": "" }]);
        const safeName = String(sheet.member_name || `Sheet${sheet.id}`).replace(/[\\/?*\[\]:]/g, "_").slice(0, 31) || `Sheet${sheet.id}`;
        XLSX.utils.book_append_sheet(workbook, worksheet, safeName);
      }
      XLSX.writeFile(workbook, `${state.project.name || "group-review"}.xlsx`);
    } catch (error) { alert(`엑셀 다운로드 실패: ${error.message}`); }
  }

  window.createGroupReviewProjectPrompt = createProjectPrompt;
  window.downloadGroupReviewExcel = downloadExcel;
  window.deleteSelectedGroupReviewProject = () => alert("V2 프로젝트 삭제는 현재 비활성화되어 있습니다.");
  window.deleteAllGroupReviewProjects = () => alert("V2 전체 프로젝트 삭제는 현재 비활성화되어 있습니다.");

  ensureStyles();
  refreshSessionAndData();
  return { renderGroupReviewUI: refreshSessionAndData, refresh: refreshSessionAndData };
}
