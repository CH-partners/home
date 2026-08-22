const API_ROOT = "/api/v1";

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json; charset=utf-8";
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function makeColumnId() {
  return `col_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function initAllocation() {
  const state = {
    user: null,
    projects: [],
    project: null,
    dirty: false,
    draggedRowIndex: null,
    loading: false
  };

  const bodyEl = () => document.getElementById("workAllocationBody");
  const badgesEl = () => document.getElementById("workProjectBadges");
  const panelEl = () => document.querySelector('.sheet-panel[data-index="11"]');

  function isAdmin() {
    return state.user?.role === "ADMIN";
  }

  function setStatus(text) {
    const el = document.getElementById("allocationV2Status");
    if (el) el.textContent = text;
  }

  function markDirty() {
    if (!isAdmin()) return;
    state.dirty = true;
    setStatus("저장 필요");
  }

  function ensureToolbar() {
    const toolbar = panelEl()?.querySelector(".work-toolbar");
    if (!toolbar) return;
    toolbar.innerHTML = `
      <button class="action-btn" onclick="createProjectPrompt()" ${isAdmin() ? "" : "style=\"display:none\""}>프로젝트 생성</button>
      <button class="action-btn" onclick="renameAllocationProjectPrompt()" ${isAdmin() ? "" : "style=\"display:none\""}>프로젝트명 변경</button>
      <button class="action-btn" onclick="downloadAllAllocationExcel()" ${isAdmin() ? "" : "style=\"display:none\""}>엑셀 다운로드</button>
      <button class="action-btn danger" onclick="deleteSelectedProject()" ${isAdmin() ? "" : "style=\"display:none\""}>프로젝트 삭제</button>
    `;
  }

  function renderLogin() {
    ensureToolbar();
    if (badgesEl()) badgesEl().innerHTML = "";
    const body = bodyEl();
    if (!body) return;
    body.innerHTML = `
      <div class="grv2-login" style="max-width:420px;margin:24px auto;">
        <h3>분배표 로그인</h3>
        <div style="font-size:12px;color:#64748b">그룹리뷰와 동일한 로컬 계정을 사용합니다.</div>
        <form id="allocationLoginForm">
          <label style="display:block;margin-top:10px">아이디</label>
          <input id="allocationLoginId" autocomplete="username" required style="width:100%;height:38px">
          <label style="display:block;margin-top:10px">비밀번호</label>
          <input id="allocationPassword" type="password" autocomplete="current-password" required style="width:100%;height:38px">
          <button type="submit" class="action-btn" style="width:100%;margin-top:12px">로그인</button>
          <div id="allocationLoginError" style="color:#b91c1c;font-size:12px;margin-top:8px"></div>
        </form>
      </div>
    `;
    document.getElementById("allocationLoginForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const errorEl = document.getElementById("allocationLoginError");
      if (errorEl) errorEl.textContent = "";
      try {
        state.user = await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({
            login_id: document.getElementById("allocationLoginId").value,
            password: document.getElementById("allocationPassword").value
          })
        });
        await loadProjects();
      } catch (error) {
        if (errorEl) errorEl.textContent = error.message || "로그인에 실패했습니다.";
      }
    });
  }

  function renderBadges() {
    const wrap = badgesEl();
    if (!wrap) return;
    wrap.innerHTML = state.projects.map(project => `
      <button type="button" class="work-badge ${state.project?.id === project.id ? "active" : ""}" data-allocation-project="${escapeHtml(project.id)}">${escapeHtml(project.name)}</button>
    `).join("");
    wrap.querySelectorAll("[data-allocation-project]").forEach(button => {
      button.addEventListener("click", () => selectProject(button.dataset.allocationProject));
    });
  }

  function renderAllocationUI() {
    ensureToolbar();
    renderBadges();
    const body = bodyEl();
    if (!body) return;
    if (!state.user) return renderLogin();
    if (!state.project) {
      body.innerHTML = `<div class="work-empty">생성된 분배표 프로젝트가 없습니다.</div>`;
      return;
    }

    const admin = isAdmin();
    const headers = state.project.columns.map((column, index) => `
      <th>
        <div style="display:flex;align-items:center;gap:4px;justify-content:center">
          <span>${escapeHtml(column.label)}</span>
          ${admin ? `<button type="button" class="small-btn" data-edit-column="${index}" title="항목명 수정">✎</button>` : ""}
        </div>
      </th>
    `).join("");

    const rows = state.project.rows.map((row, rowIndex) => {
      const active = row.active !== false;
      const cells = state.project.columns.map(column => `
        <td><input type="text" value="${escapeHtml(row.values?.[column.id] || "")}" data-row-index="${rowIndex}" data-column-id="${escapeHtml(column.id)}" ${admin ? "" : "readonly"}></td>
      `).join("");
      return `
        <tr data-row-index="${rowIndex}" class="${active ? "" : "allocation-row-inactive"}" ${admin ? 'draggable="true"' : ""}>
          <td class="drag-member-cell">
            ${admin ? '<span class="drag-handle" title="드래그하여 순서 변경">☰</span>' : ""}
            <span>${escapeHtml(row.name)}</span>
            ${admin ? `<button type="button" class="small-btn ${active ? "danger" : ""}" data-toggle-worker="${rowIndex}" style="margin-left:8px">${active ? "제외" : "참여"}</button>` : ""}
            ${!active ? '<span class="allocation-inactive-label">비활성</span>' : ""}
          </td>
          ${cells}
        </tr>
      `;
    }).join("");

    body.innerHTML = `
      <div class="work-project-header">
        <div class="work-project-title">${escapeHtml(state.project.name)}</div>
        <input id="allocationMemo" type="text" class="work-project-memo" placeholder="프로젝트 메모" value="${escapeHtml(state.project.memo || "")}" ${admin ? "" : "readonly"}>
      </div>
      ${admin ? '<div class="work-info">이름 열의 ☰를 드래그하면 행 순서를 바꿀 수 있습니다. 항목 추가/수정과 셀 입력 후 저장하세요.</div>' : ""}
      <div class="work-header-actions">
        ${admin ? '<button class="action-btn" id="allocationAddColumn">열 추가</button><button class="action-btn" id="allocationSaveInline">저장</button>' : ""}
        <span id="allocationV2Status" style="font-size:12px;color:#64748b">${state.dirty ? "저장 필요" : "저장됨"}</span>
      </div>
      <div class="work-table-wrap">
        <table class="work-table">
          <thead><tr><th>이름</th>${headers}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    if (!admin) return;

    document.getElementById("allocationMemo")?.addEventListener("input", event => {
      state.project.memo = event.target.value;
      markDirty();
    });
    document.getElementById("allocationAddColumn")?.addEventListener("click", addColumnPrompt);
    document.getElementById("allocationSaveInline")?.addEventListener("click", () => window.saveAllocationData?.());
    body.querySelectorAll("[data-edit-column]").forEach(button => button.addEventListener("click", () => editColumnPrompt(Number(button.dataset.editColumn))));
    body.querySelectorAll("[data-toggle-worker]").forEach(button => button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const row = state.project.rows[Number(button.dataset.toggleWorker)];
      if (!row) return;
      row.active = row.active === false;
      markDirty();
      renderAllocationUI();
    }));
    body.querySelectorAll("input[data-row-index][data-column-id]").forEach(input => input.addEventListener("input", event => {
      const row = state.project.rows[Number(event.target.dataset.rowIndex)];
      if (!row) return;
      row.values[event.target.dataset.columnId] = event.target.value;
      markDirty();
    }));
    body.querySelectorAll("tbody tr[draggable=true]").forEach(rowEl => {
      rowEl.addEventListener("dragstart", event => {
        if (event.target.closest("button")) {
          event.preventDefault();
          return;
        }
        state.draggedRowIndex = Number(rowEl.dataset.rowIndex);
        event.dataTransfer.effectAllowed = "move";
        rowEl.classList.add("dragging");
      });
      rowEl.addEventListener("dragover", event => event.preventDefault());
      rowEl.addEventListener("drop", event => {
        event.preventDefault();
        const targetIndex = Number(rowEl.dataset.rowIndex);
        const sourceIndex = state.draggedRowIndex;
        if (!Number.isInteger(sourceIndex) || sourceIndex === targetIndex) return;
        const [moved] = state.project.rows.splice(sourceIndex, 1);
        state.project.rows.splice(targetIndex, 0, moved);
        state.draggedRowIndex = null;
        markDirty();
        renderAllocationUI();
      });
      rowEl.addEventListener("dragend", () => {
        state.draggedRowIndex = null;
        body.querySelectorAll(".dragging").forEach(el => el.classList.remove("dragging"));
      });
    });
  }

  function addColumnPrompt() {
    if (!isAdmin() || !state.project) return;
    const label = prompt("추가할 항목명을 입력하세요.");
    if (!label?.trim()) return;
    const trimmed = label.trim();
    if (state.project.columns.some(column => column.label === trimmed)) return alert("같은 항목명이 이미 있습니다.");
    const id = makeColumnId();
    state.project.columns.push({ id, label: trimmed });
    state.project.rows.forEach(row => { row.values ||= {}; row.values[id] = ""; });
    markDirty();
    renderAllocationUI();
  }

  function editColumnPrompt(index) {
    if (!isAdmin() || !state.project) return;
    const column = state.project.columns[index];
    if (!column) return;
    const next = prompt("항목명을 수정하세요.\n빈 값으로 확인하면 변경하지 않습니다.", column.label);
    if (!next?.trim()) return;
    const trimmed = next.trim();
    if (state.project.columns.some((item, itemIndex) => itemIndex !== index && item.label === trimmed)) return alert("같은 항목명이 이미 있습니다.");
    column.label = trimmed;
    markDirty();
    renderAllocationUI();
  }

  async function selectProject(projectId) {
    if (state.dirty && isAdmin() && !confirm("저장하지 않은 변경사항이 있습니다. 다른 프로젝트로 이동할까요?")) return;
    try {
      state.project = await api(`/allocation/projects/${projectId}`);
      state.dirty = false;
      renderAllocationUI();
    } catch (error) {
      if (error.status === 404) {
        state.project = null;
        state.dirty = false;
        await loadProjects();
        return;
      }
      alert(`프로젝트 불러오기 실패: ${error.message}`);
    }
  }

  async function loadProjects(preferredId = null) {
    try {
      state.projects = await api("/allocation/projects");
      if (!state.projects.length) {
        state.project = null;
        state.dirty = false;
        renderAllocationUI();
        return;
      }

      const candidates = [preferredId, state.project?.id].filter(Boolean);
      const targetId = candidates.find(id => state.projects.some(project => project.id === id)) || state.projects[0].id;
      await selectProject(targetId);
    } catch (error) {
      if (error.status === 401) {
        state.user = null;
        state.projects = [];
        state.project = null;
        renderLogin();
      } else {
        const body = bodyEl();
        if (body) body.innerHTML = `<div class="work-empty">분배표 연결 실패: ${escapeHtml(error.message)}</div>`;
      }
    }
  }

  async function refreshSession() {
    if (state.loading) return;
    state.loading = true;
    try {
      state.user = await api("/auth/me");
      await loadProjects();
    } catch (error) {
      if (error.status === 401) renderLogin();
      else if (bodyEl()) bodyEl().innerHTML = `<div class="work-empty">분배표 연결 실패: ${escapeHtml(error.message)}</div>`;
    } finally {
      state.loading = false;
    }
  }

  window.createProjectPrompt = async function() {
    if (!isAdmin()) return alert("관리자만 프로젝트를 생성할 수 있습니다.");
    const name = prompt("분배표 프로젝트 이름을 입력하세요.");
    if (!name?.trim()) return;
    try {
      const project = await api("/allocation/projects", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      await loadProjects(project.id);
    } catch (error) { alert(`프로젝트 생성 실패: ${error.message}`); }
  };

  window.renameAllocationProjectPrompt = async function() {
    if (!isAdmin() || !state.project) return;
    const name = prompt("새 프로젝트명을 입력하세요.", state.project.name);
    if (!name?.trim() || name.trim() === state.project.name) return;
    try {
      const project = await api(`/allocation/projects/${state.project.id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) });
      state.project = project;
      state.projects = await api("/allocation/projects");
      state.dirty = false;
      renderAllocationUI();
    } catch (error) { alert(`프로젝트명 변경 실패: ${error.message}`); }
  };

  window.saveAllocationData = async function() {
    if (!isAdmin() || !state.project) return alert("관리자만 저장할 수 있습니다.");
    try {
      setStatus("저장 중...");
      if (state.project.memo !== undefined) {
        await api(`/allocation/projects/${state.project.id}`, { method: "PATCH", body: JSON.stringify({ memo: state.project.memo || "" }) });
      }
      state.project = await api(`/allocation/projects/${state.project.id}/grid`, {
        method: "PUT",
        body: JSON.stringify({ columns: state.project.columns, rows: state.project.rows })
      });
      state.dirty = false;
      renderAllocationUI();
      alert("분배표가 저장되었습니다.");
    } catch (error) {
      setStatus("저장 실패");
      alert(`분배표 저장 실패: ${error.message}`);
    }
  };

  window.deleteSelectedProject = async function() {
    if (!isAdmin() || !state.project) return alert("관리자만 프로젝트를 삭제할 수 있습니다.");
    if (!confirm(`"${state.project.name}" 프로젝트를 삭제하시겠습니까?`)) return;
    try {
      await api(`/allocation/projects/${state.project.id}`, { method: "DELETE" });
      state.project = null;
      state.dirty = false;
      await loadProjects();
    } catch (error) { alert(`프로젝트 삭제 실패: ${error.message}`); }
  };

  window.deleteAllProjects = function() {
    alert("전체 프로젝트 삭제는 배포 안정화를 위해 비활성화했습니다. 프로젝트별 삭제를 사용하세요.");
  };

  window.addColumnPrompt = addColumnPrompt;
  window.editColumnPrompt = () => alert("각 열 제목 옆 ✎ 버튼으로 항목명을 수정하세요.");
  window.selectProject = selectProject;

  window.downloadAllAllocationExcel = async function() {
    if (!isAdmin()) return alert("관리자만 엑셀을 다운로드할 수 있습니다.");
    if (!window.XLSX) return alert("엑셀 라이브러리를 불러오지 못했습니다.");
    if (!state.projects.length) return alert("다운로드할 프로젝트가 없습니다.");
    try {
      const workbook = XLSX.utils.book_new();
      for (const item of state.projects) {
        const project = item.id === state.project?.id ? state.project : await api(`/allocation/projects/${item.id}`);
        const data = [["이름", "상태", ...project.columns.map(column => column.label)]];
        project.rows.forEach(row => data.push([row.name, row.active === false ? "제외" : "참여", ...project.columns.map(column => row.values?.[column.id] || "")]));
        const worksheet = XLSX.utils.aoa_to_sheet(data);
        const safeName = String(project.name || "분배표").replace(/[\\/?*\[\]:]/g, "_").slice(0, 31) || "분배표";
        XLSX.utils.book_append_sheet(workbook, worksheet, safeName);
      }
      XLSX.writeFile(workbook, "전체_분배표.xlsx");
    } catch (error) { alert(`엑셀 다운로드 실패: ${error.message}`); }
  };

  refreshSession();
  return {
    renderAllocationUI,
    refresh: refreshSession
  };
}
