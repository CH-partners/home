import { setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export function initAllocation(ctx) {
  const { allocationRef, fixedMembers, isAdmin, escapeHtml, removeUndefinedDeep, getCurrentUser } = ctx;

  let allocationData = {
    members: [...fixedMembers],
    projects: []
  };
  let selectedProjectId = null;

function getSelectedProject() {
  return allocationData.projects.find(p => p.id === selectedProjectId) || null;
}

function createEmptyProject(name) {
  return {
    id: "project_" + Date.now(),
    name,
    memo: "",
    columns: [],
    rows: fixedMembers.map(member => ({
      name: member,
      active: true,
      values: {}
    }))
  };
}

window.createProjectPrompt = function() {
  if (!isAdmin(getCurrentUser())) return alert("관리자만 수정할 수 있습니다.");
  const name = prompt("프로젝트 이름을 입력하세요.");
  if (!name || !name.trim()) return;

  const trimmed = name.trim();
  if (allocationData.projects.some(p => p.name === trimmed)) {
    alert("같은 프로젝트명이 이미 있습니다.");
    return;
  }

  const newProject = createEmptyProject(trimmed);
  allocationData.projects.push(newProject);
  selectedProjectId = newProject.id;
  renderAllocationUI();
};

window.addColumnPrompt = function() {
  if (!isAdmin(getCurrentUser())) return alert("관리자만 수정할 수 있습니다.");
  const project = getSelectedProject();
  if (!project) return alert("먼저 프로젝트를 선택하세요.");

  const columnName = prompt("항목명을 입력하세요.");
  if (!columnName || !columnName.trim()) return;

  const trimmed = columnName.trim();
  if (project.columns.includes(trimmed)) {
    alert("같은 항목명이 이미 있습니다.");
    return;
  }

  project.columns.push(trimmed);
  project.rows.forEach(row => {
    row.values[trimmed] = "";
  });

  renderAllocationUI();
};

window.editColumnPrompt = function() {
  if (!isAdmin(getCurrentUser()))
    return alert("관리자만 수정할 수 있습니다.");

  const project = getSelectedProject();

  if (!project)
    return alert("먼저 프로젝트를 선택하세요.");

  if (!project.columns.length)
    return alert("편집할 항목이 없습니다.");

  const oldName = prompt(
    "편집할 항목명을 입력하세요.\n\n" +
    project.columns.join(", ")
  );

  if (!oldName) return;

  const oldTrim = oldName.trim();

  if (!project.columns.includes(oldTrim)) {
    alert("존재하지 않는 항목입니다.");
    return;
  }

  const mode = prompt(
    `"${oldTrim}" 항목을 어떻게 처리할까요?\n\n` +
    "1 = 이름 수정\n" +
    "2 = 삭제"
  );

  if (!mode) return;

  if (mode.trim() === "1") {
    const newName = prompt("새 항목명을 입력하세요.", oldTrim);

    if (!newName) return;

    const newTrim = newName.trim();

    if (!newTrim) return;

    if (
      project.columns.includes(newTrim) &&
      newTrim !== oldTrim
    ) {
      alert("같은 이름의 항목이 이미 있습니다.");
      return;
    }

    project.columns = project.columns.map(col =>
      col === oldTrim ? newTrim : col
    );

    project.rows.forEach(row => {
      row.values[newTrim] = row.values[oldTrim] || "";
      delete row.values[oldTrim];
    });

    renderAllocationUI();
    return;
  }

  if (mode.trim() === "2") {
    if (!confirm(`"${oldTrim}" 항목을 삭제하시겠습니까?`))
      return;

    project.columns = project.columns.filter(
      col => col !== oldTrim
    );

    project.rows.forEach(row => {
      delete row.values[oldTrim];
    });

    renderAllocationUI();
    return;
  }

  alert("1 또는 2만 입력하세요.");
};

window.deleteSelectedProject = function() {
  if (!isAdmin(getCurrentUser())) return alert("관리자만 수정할 수 있습니다.");
  const project = getSelectedProject();
  if (!project) return;

  if (!confirm(`"${project.name}" 프로젝트를 삭제하시겠습니까?`)) return;
  allocationData.projects = allocationData.projects.filter(p => p.id !== project.id);
  selectedProjectId = allocationData.projects[0]?.id || null;
  renderAllocationUI();
};

window.deleteAllProjects = async function() {
  try {
    if (!isAdmin(getCurrentUser())) return alert("관리자만 수정할 수 있습니다.");

    if (!allocationData.projects.length) {
      alert("삭제할 프로젝트가 없습니다.");
      return;
    }

    const firstConfirm = confirm(
      `현재 등록된 프로젝트 ${allocationData.projects.length}개를 모두 삭제하시겠습니까?`
    );
    if (!firstConfirm) return;

    const secondConfirm = confirm(
      "정말 전체 프로젝트를 삭제하시겠습니까? 이 작업은 저장 후 되돌릴 수 없습니다."
    );
    if (!secondConfirm) return;

    allocationData.projects = [];
    selectedProjectId = null;

    await setDoc(allocationRef, removeUndefinedDeep(allocationData), { merge: true });

    renderAllocationUI();
    alert("전체 프로젝트가 삭제되었습니다.");
  } catch (error) {
    console.error("전체 프로젝트 삭제 실패:", error);
    alert("전체 프로젝트 삭제 실패: " + (error.message || error));
  }
};

window.selectProject = function(projectId) {
  selectedProjectId = projectId;
  renderAllocationUI();
};

window.updateProjectMemo = function(projectId, value) {
  const project = allocationData.projects.find(
    p => p.id === projectId
  );

  if (!project) return;

  project.memo = value;
};

window.updateAllocationCell = function(projectId, rowIndex, columnName, value) {
  const project = allocationData.projects.find(p => p.id === projectId);
  if (!project || !project.rows[rowIndex]) return;
  project.rows[rowIndex].values[columnName] = value;
};

window.saveAllocationData = async function() {
  try {
    if (!isAdmin(getCurrentUser())) return alert("관리자만 저장할 수 있습니다.");
    await setDoc(allocationRef, removeUndefinedDeep(allocationData), { merge: true });
    alert("Project 분배표가 저장되었습니다.");
  } catch (error) {
    console.error("Project 분배표 저장 실패:", error);
    alert("Project 분배표 저장 실패: " + (error.message || error));
  }
};

function renderAllocationUI() {
  const badgeWrap = document.getElementById("workProjectBadges");
  const body = document.getElementById("workAllocationBody");
  if (!badgeWrap || !body) return;

  badgeWrap.innerHTML = "";

  if (!allocationData.projects.length) {
    body.innerHTML = `
      <div class="work-empty">
        생성된 프로젝트가 없습니다.<br>
        상단의 <strong>분배표 생성</strong> 버튼으로 프로젝트를 먼저 만드세요.
      </div>
    `;
    return;
  }

  if (!selectedProjectId || !allocationData.projects.some(p => p.id === selectedProjectId)) {
    selectedProjectId = allocationData.projects[0].id;
  }

  allocationData.projects.forEach(project => {
    const btn = document.createElement("button");
    btn.className = "work-badge" + (project.id === selectedProjectId ? " active" : "");
    btn.textContent = project.name;
    btn.onclick = () => window.selectProject(project.id);
    badgeWrap.appendChild(btn);
  });

  const project = getSelectedProject();
  if (!project) {
    body.innerHTML = `<div class="work-empty">선택된 프로젝트가 없습니다.</div>`;
    return;
  }

  const headers = project.columns.map(col => `<th>${escapeHtml(col)}</th>`).join("");
  const rowsHtml = project.rows.map((row, rowIndex) => {
    const cells = project.columns.map(col => {
      const value = row.values?.[col] ?? "";
      return `<td><input type="text" value="${escapeHtml(value)}" ${isAdmin(getCurrentUser()) ? "" : "readonly"} oninput="updateAllocationCell('${project.id}', ${rowIndex}, '${escapeHtml(col)}', this.value)"></td>`;
    }).join("");

    return `
      <tr
        ondragover="dragMemberOver(event)"
        ondrop="dropMemberRow(event, '${project.id}', ${rowIndex})"
        ondragend="dragMemberEnd(event)"
        style="${row.active ? '' : 'opacity:0.3'}"
      >
       <td class="drag-member-cell">
          <span
            class="drag-handle"
            draggable="true"
            ondragstart="dragMemberStart(event, '${project.id}', ${rowIndex})"
            ondragend="dragMemberEnd(event)"
          >☰</span>
          <span>${escapeHtml(row.name)}</span>
        
          <button class="member-toggle-btn"
            onclick="toggleMemberActive('${project.id}', ${rowIndex})">
            ${row.active ? '제외' : '참여'}
          </button>
        </td>
        ${cells}
      </tr>
    `;
  }).join("");

  body.innerHTML = `
    <div class="work-project-header">

  <div class="work-project-title">
    ${escapeHtml(project.name)}
  </div>

      <input
        type="text"
        class="work-project-memo"
        placeholder="프로젝트 메모 입력..."
        value="${escapeHtml(project.memo || "")}"
        ${isAdmin(getCurrentUser()) ? "" : "readonly"}
        oninput="updateProjectMemo('${project.id}', this.value)"
      >
    
    </div>
    <div class="work-info">첫 번째 열은 이름 고정이며, 두 번째 열부터 항목 추가로 생성됩니다, ☰버튼 마우스 클릭&드래그로 순서를 바꿀수 있씁니다. </div>
    <div class="work-header-actions">
      <button class="action-btn"
        onclick="addColumnPrompt()">
        항목 추가
      </button>
    
      <button class="action-btn"
        onclick="editColumnPrompt()">
        항목 편집
      </button>
    
      <button class="action-btn"
        onclick="saveAllocationData()">
        저장
      </button>
    
      <button class="action-btn"
        onclick="deleteSelectedProject()">
        프로젝트 삭제
      </button>

      <button class="action-btn"
        onclick="deleteAllProjects()">
        프로젝트 전체 삭제
      </button>
    </div>
    <div class="work-table-wrap">
      <table class="work-table">
        <thead>
          <tr>
            <th>이름</th>
            ${headers}
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}
  
function createDefaultContentTable() {
  return {
    enabled: true,
    rows: [
      ["구분", "내용"],
      ["", ""]
    ]
  };
}

function cloneTableData(data) {
  return {
    enabled: !!data?.enabled,
    rows: Array.isArray(data?.rows)
      ? data.rows.map(row => Array.isArray(row) ? [...row] : [])
      : []
  };
}

function normalizeContentTableRows(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return [["구분", "내용"], ["", ""]];
  }

  const maxCols = Math.max(...rows.map(row => Array.isArray(row) ? row.length : 0), 1);

  return rows.map(row => {
    const safeRow = Array.isArray(row) ? [...row] : [];
    while (safeRow.length < maxCols) safeRow.push("");
    return safeRow;
  });
}
function serializeTableData(tableData) {
  if (!tableData?.enabled) {
    return {
      enabled: false,
      rows: []
    };
  }

  const rows = normalizeContentTableRows(tableData.rows || []);

  return {
    enabled: true,
    rows: rows.map(row => {
      const obj = {};
      row.forEach((cell, idx) => {
        obj[`c${idx}`] = cell ?? "";
      });
      return obj;
    })
  };
}

function deserializeTableData(tableData) {
  if (!tableData?.enabled || !Array.isArray(tableData.rows) || !tableData.rows.length) {
    return {
      enabled: false,
      rows: []
    };
  }

  const rows = tableData.rows.map(rowObj => {
    const keys = Object.keys(rowObj).sort((a, b) => {
      return Number(a.replace("c", "")) - Number(b.replace("c", ""));
    });
    return keys.map(key => rowObj[key] ?? "");
  });

  return {
    enabled: true,
    rows
  };
}
function renderContentTableEditor() {
  const table = document.getElementById("contentTableEditor");
  if (!table) return;

  if (!currentContentTableData.enabled) {
    table.innerHTML = `
      <tbody>
        <tr>
          <td style="padding:16px; color:#64748b;">
            표를 사용하려면 "표 사용" 버튼을 눌러주세요.
          </td>
        </tr>
      </tbody>
    `;
    return;
  }

  currentContentTableData.rows = normalizeContentTableRows(currentContentTableData.rows);
  const rows = currentContentTableData.rows;

  const theadHtml = `
    <thead>
      <tr>
        ${rows[0].map((cell, colIndex) => `
          <th>
            <input
              type="text"
              value="${escapeHtml(cell || "")}"
              oninput="updateContentTableCell(0, ${colIndex}, this.value)"
              placeholder="헤더 입력"
            >
          </th>
        `).join("")}
      </tr>
    </thead>
  `;

  const tbodyHtml = `
    <tbody>
      ${rows.slice(1).map((row, rowOffset) => {
        const rowIndex = rowOffset + 1;
        return `
          <tr>
            ${row.map((cell, colIndex) => `
              <td>
                <input
                  type="text"
                  value="${escapeHtml(cell || "")}"
                  oninput="updateContentTableCell(${rowIndex}, ${colIndex}, this.value)"
                  placeholder="내용 입력"
                >
              </td>
            `).join("")}
          </tr>
        `;
      }).join("")}
    </tbody>
  `;

  table.innerHTML = theadHtml + tbodyHtml;
}

window.updateContentTableCell = function(rowIndex, colIndex, value) {
  if (!currentContentTableData.enabled) return;
  if (!currentContentTableData.rows[rowIndex]) return;
  currentContentTableData.rows[rowIndex][colIndex] = value;
};

window.enableContentTable = function() {
  if (!currentContentTableData.enabled) {
    currentContentTableData = createDefaultContentTable();
  }
  renderContentTableEditor();
};

window.addContentTableRow = function() {
  if (!currentContentTableData.enabled) {
    currentContentTableData = createDefaultContentTable();
  }
  const colCount = currentContentTableData.rows[0]?.length || 2;
  currentContentTableData.rows.push(Array(colCount).fill(""));
  renderContentTableEditor();
};

window.addContentTableColumn = function() {
  if (!currentContentTableData.enabled) {
    currentContentTableData = createDefaultContentTable();
  }

  currentContentTableData.rows = normalizeContentTableRows(currentContentTableData.rows);

  currentContentTableData.rows.forEach((row, idx) => {
    row.push(idx === 0 ? `항목${row.length + 1}` : "");
  });

  renderContentTableEditor();
};

window.removeLastContentTableRow = function() {
  if (!currentContentTableData.enabled) return;

  if (currentContentTableData.rows.length <= 2) {
    alert("최소 1개의 내용 행은 유지해야 합니다.");
    return;
  }

  currentContentTableData.rows.pop();
  renderContentTableEditor();
};

window.removeLastContentTableColumn = function() {
  if (!currentContentTableData.enabled) return;

  currentContentTableData.rows = normalizeContentTableRows(currentContentTableData.rows);
  const colCount = currentContentTableData.rows[0]?.length || 0;

  if (colCount <= 1) {
    alert("최소 1개의 열은 유지해야 합니다.");
    return;
  }

  currentContentTableData.rows.forEach(row => row.pop());
  renderContentTableEditor();
};

window.clearContentTable = function() {
  currentContentTableData = {
    enabled: false,
    rows: []
  };
  renderContentTableEditor();
};

function buildContentTableHtml(tableData) {
  if (!tableData?.enabled) return "";

  const rows = normalizeContentTableRows(tableData.rows || []);
  if (!rows.length) return "";

  const headerRow = rows[0];
  const bodyRows = rows.slice(1);

  const thead = `
    <thead>
      <tr>
        ${headerRow.map(cell => `<th>${escapeHtml(cell || "")}</th>`).join("")}
      </tr>
    </thead>
  `;

  const tbody = `
    <tbody>
      ${bodyRows.map(row => `
        <tr>
          ${row.map(cell => `<td>${escapeHtml(cell || "")}</td>`).join("")}
        </tr>
      `).join("")}
    </tbody>
  `;

  return `
    <div class="content-table-preview">
      <table>
        ${thead}
        ${tbody}
      </table>
    </div>
  `;
}
  
window.toggleMemberActive = function(projectId, rowIndex) {
  const project = allocationData.projects.find(p => p.id === projectId);
  if (!project) return;
  const row = project.rows[rowIndex];
  row.active = !row.active;
  renderAllocationUI();
};

let draggedMemberIndex = null;

window.dragMemberStart = function(event, projectId, rowIndex) {
  draggedMemberIndex = rowIndex;

  const tr = event.currentTarget.closest("tr");
  if (tr) tr.classList.add("dragging");

  event.dataTransfer.effectAllowed = "move";
};

window.dragMemberEnd = function(event) {
  document
    .querySelectorAll(".dragging")
    .forEach(el => el.classList.remove("dragging"));

  draggedMemberIndex = null;
};

window.dragMemberOver = function(event) {
  event.preventDefault();
};

window.dropMemberRow = function(event, projectId, targetIndex) {
  event.preventDefault();

  const project = allocationData.projects.find(
    p => p.id === projectId
  );

  if (!project) return;

  if (
  draggedMemberIndex === null ||
  draggedMemberIndex === targetIndex
) {
  window.dragMemberEnd(event);
  return;
}

  const movedRow =
    project.rows.splice(draggedMemberIndex, 1)[0];

  project.rows.splice(targetIndex, 0, movedRow);

  document
    .querySelectorAll(".dragging")
    .forEach(el => el.classList.remove("dragging"));

  draggedMemberIndex = null;

  renderAllocationUI();
};

window.downloadAllAllocationExcel = function() {
  if (!allocationData.projects.length) {
    alert("다운로드할 분배표 프로젝트가 없습니다.");
    return;
  }

  const wb = XLSX.utils.book_new();

  allocationData.projects.forEach(project => {
    const data = [];

    data.push(["이름", ...project.columns]);

    project.rows.forEach(row => {
      if (!row.active) return;

      const rowData = [row.name];

      project.columns.forEach(col => {
        rowData.push(row.values?.[col] || "");
      });

      data.push(rowData);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);

    const sheetName = String(project.name || "프로젝트")
      .replace(/[\\/?*[\]:]/g, "")
      .slice(0, 31);

    XLSX.utils.book_append_sheet(wb, ws, sheetName || "프로젝트");
  });

  XLSX.writeFile(wb, "전체_분배표.xlsx");
};



  onSnapshot(allocationRef, snap => {
    const data = snap.data() || {};
    allocationData = {
      members: Array.isArray(data.members) && data.members.length ? data.members : [...fixedMembers],
      projects: Array.isArray(data.projects) ? data.projects : []
    };

    if (!selectedProjectId || !allocationData.projects.some(p => p.id === selectedProjectId)) {
      selectedProjectId = allocationData.projects[0]?.id || null;
    }

    renderAllocationUI();
  });

  return {
    renderAllocationUI
  };
}
