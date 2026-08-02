import { collection, doc, setDoc, onSnapshot, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export function initGroupReview(ctx) {
  const {
    db,
    fixedMembers,
    isAdmin,
    canUseGroupReview,
    escapeHtml,
    removeUndefinedDeep,
    getCurrentUser
  } = ctx;

  const projectsColRef = collection(db, "groupReviewProjects");
  const lockMinutes = 15;
  const sessionStorageKey = "groupReviewSessionId";
  const memberStorageKey = "groupReviewSelectedMember";

  let projects = [];
  let selectedProjectId = null;
  let selectedSheetKey = null;
  let selectedMember = localStorage.getItem(memberStorageKey) || "";
  let sheetsData = {};
  let unsubscribeProjects = null;
  let unsubscribeSheets = null;
  let subscribedProjectId = null;

  let sessionId = localStorage.getItem(sessionStorageKey);
  if (!sessionId) {
    sessionId = "review_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    localStorage.setItem(sessionStorageKey, sessionId);
  }

  function canUse() {
    return canUseGroupReview(getCurrentUser());
  }

  function projectRef(projectId) {
    return doc(db, "groupReviewProjects", projectId);
  }

  function sheetsColRef(projectId) {
    return collection(db, "groupReviewProjects", projectId, "sheets");
  }

  function sheetRef(projectId, sheetKey) {
    return doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
  }

  function getSelectedProject() {
    return projects.find(project => project.id === selectedProjectId) || null;
  }

  function jsArg(value) {
    return JSON.stringify(String(value ?? ""));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function createMemberRow() {
    return {
      id: "row_" + Date.now() + "_" + Math.random().toString(36).slice(2),
      collateralNo: "",
      sheet: "",
      fieldNo: "",
      changeText: ""
    };
  }

  function createBlankRows(count = 10) {
    return Array.from({ length: count }, () => createMemberRow());
  }

  function normalizeMemberRows(rows) {
    if (!Array.isArray(rows)) return [];

    return rows.map(row => ({
      id: row?.id || "row_" + Date.now() + "_" + Math.random().toString(36).slice(2),
      collateralNo: String(row?.collateralNo ?? ""),
      sheet: String(row?.sheet ?? ""),
      fieldNo: String(row?.fieldNo ?? ""),
      changeText: String(row?.changeText ?? "")
    }));
  }

  function normalizeSheetDoc(sheetKey, data = {}) {
    return {
      type: data.type || "member",
      memberName: data.memberName || sheetKey,
      rows: normalizeMemberRows(data.rows),
      updatedAt: data.updatedAt || "",
      updatedBy: data.updatedBy || "",
      updatedByEmail: data.updatedByEmail || "",
      lockSessionId: data.lockSessionId || "",
      lockedBy: data.lockedBy || "",
      lockedAt: data.lockedAt || ""
    };
  }

  function ensureLocalSheet(sheetKey) {
    if (!sheetsData[sheetKey]) {
      sheetsData[sheetKey] = normalizeSheetDoc(sheetKey, {
        type: "member",
        memberName: sheetKey,
        rows: createBlankRows()
      });
    }

    if (!sheetsData[sheetKey].rows.length) {
      sheetsData[sheetKey].rows = createBlankRows();
    }

    return sheetsData[sheetKey];
  }

  function rowHasValue(row) {
    return ["collateralNo", "sheet", "fieldNo", "changeText"].some(field =>
      String(row?.[field] || "").trim() !== ""
    );
  }

  function getLockState(member) {
    const sheet = sheetsData[member];
    if (!sheet?.lockSessionId || !sheet.lockedAt) {
      return { active: false, own: false, label: "" };
    }

    const lockedTime = Date.parse(sheet.lockedAt);
    if (!Number.isFinite(lockedTime)) {
      return { active: false, own: false, label: "" };
    }

    const active = Date.now() - lockedTime < lockMinutes * 60 * 1000;
    const own = sheet.lockSessionId === sessionId;

    return {
      active,
      own,
      label: active ? (own ? "내가 사용 중" : "사용 중") : ""
    };
  }

  function canEditSheet(sheetKey) {
    if (!canUse()) return false;
    if (isAdmin(getCurrentUser())) return true;
    return !!selectedMember && sheetKey === selectedMember;
  }

  async function lockSelectedMember(member) {
    const project = getSelectedProject();
    if (!project || !member) return;

    const ref = sheetRef(project.id, member);
    await runTransaction(db, async transaction => {
      const snap = await transaction.get(ref);
      const data = snap.data() || {};
      const lockedAt = Date.parse(data.lockedAt || "");
      const lockedByOther =
        data.lockSessionId &&
        data.lockSessionId !== sessionId &&
        Number.isFinite(lockedAt) &&
        Date.now() - lockedAt < lockMinutes * 60 * 1000;

      if (lockedByOther && !isAdmin(getCurrentUser())) {
        throw new Error(`${member} 시트는 다른 사람이 사용 중입니다. 잠시 후 다시 선택해주세요.`);
      }

      transaction.set(ref, removeUndefinedDeep({
        type: "member",
        memberName: member,
        lockSessionId: sessionId,
        lockedBy: member,
        lockedAt: nowIso(),
        updatedByEmail: getCurrentUser()?.email || ""
      }), { merge: true });
    });
  }

  function subscribeSheets(projectId) {
    if (unsubscribeSheets) {
      unsubscribeSheets();
      unsubscribeSheets = null;
    }

    sheetsData = {};
    subscribedProjectId = projectId || null;

    if (!projectId) {
      renderGroupReviewUI();
      return;
    }

    unsubscribeSheets = onSnapshot(
      sheetsColRef(projectId),
      snap => {
        const nextSheets = {};
        snap.forEach(sheetDoc => {
          nextSheets[sheetDoc.id] = normalizeSheetDoc(sheetDoc.id, sheetDoc.data() || {});
        });
        sheetsData = nextSheets;

        if (selectedMember && !selectedSheetKey) selectedSheetKey = selectedMember;
        renderGroupReviewUI();
      },
      error => {
        console.error("그룹리뷰 시트 구독 실패:", error);
        sheetsData = {};
        renderGroupReviewUI();
      }
    );
  }

  function stopSubscriptions() {
    if (unsubscribeSheets) {
      unsubscribeSheets();
      unsubscribeSheets = null;
    }
    if (unsubscribeProjects) {
      unsubscribeProjects();
      unsubscribeProjects = null;
    }
    subscribedProjectId = null;
    sheetsData = {};
  }

  function handleProjectsSnapshot(snap) {
    projects = [];
    snap.forEach(projectDoc => {
      const data = projectDoc.data() || {};
      projects.push({
        id: projectDoc.id,
        name: data.name || projectDoc.id,
        members: Array.isArray(data.members) ? data.members : [...fixedMembers],
        createdAt: data.createdAt || ""
      });
    });

    projects.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

    if (!selectedProjectId || !projects.some(project => project.id === selectedProjectId)) {
      selectedProjectId = projects[0]?.id || null;
      selectedSheetKey = selectedMember || fixedMembers[0];
    }

    if (selectedProjectId !== subscribedProjectId) {
      subscribeSheets(selectedProjectId);
    }

    renderGroupReviewUI();
  }

  function subscribeProjects() {
    if (unsubscribeProjects || !canUse()) return;

    unsubscribeProjects = onSnapshot(
      projectsColRef,
      handleProjectsSnapshot,
      error => {
        console.error("그룹리뷰 프로젝트 구독 실패:", error);
        unsubscribeProjects = null;
        projects = [];
        renderGroupReviewUI();
      }
    );
  }

  window.createGroupReviewProjectPrompt = async function() {
    try {
      if (!canUse()) return alert("리뷰 계정 또는 관리자만 사용할 수 있습니다.");

      const name = prompt("그룹리뷰 프로젝트 이름을 입력하세요.");
      if (!name || !name.trim()) return;

      const trimmed = name.trim();
      if (projects.some(project => project.name === trimmed)) {
        alert("같은 프로젝트명이 이미 있습니다.");
        return;
      }

      const id = "review_project_" + Date.now();
      await setDoc(
        projectRef(id),
        removeUndefinedDeep({
          id,
          name: trimmed,
          members: [...fixedMembers],
          createdAt: nowIso(),
          createdByEmail: getCurrentUser()?.email || "",
          createdBy: selectedMember || getCurrentUser()?.email || "unknown"
        })
      );

      selectedProjectId = id;
      selectedSheetKey = selectedMember || fixedMembers[0];
      subscribeSheets(id);
      renderGroupReviewUI();
    } catch (error) {
      console.error("그룹리뷰 프로젝트 생성 실패:", error);
      alert("그룹리뷰 프로젝트 생성 실패: " + (error.message || error));
    }
  };

  window.selectGroupReviewProject = function(projectId) {
    selectedProjectId = projectId;
    selectedSheetKey = selectedMember || fixedMembers[0];
    subscribeSheets(projectId);
    renderGroupReviewUI();
  };

  window.selectGroupReviewMember = async function(member) {
    try {
      if (!canUse()) return alert("리뷰 계정 또는 관리자만 사용할 수 있습니다.");
      if (!fixedMembers.includes(member)) return;

      const lock = getLockState(member);
      if (lock.active && !lock.own && !isAdmin(getCurrentUser())) {
        alert(`${member} 시트는 다른 사람이 사용 중입니다. 잠시 후 다시 선택해주세요.`);
        return;
      }

      selectedMember = member;
      selectedSheetKey = member;
      localStorage.setItem(memberStorageKey, member);

      await lockSelectedMember(member);
      renderGroupReviewUI();
    } catch (error) {
      console.error("리뷰 이름 선택 실패:", error);
      alert("리뷰 이름 선택 실패: " + (error.message || error));
    }
  };

  window.selectGroupReviewSheet = function(sheetKey) {
    selectedSheetKey = sheetKey;
    renderGroupReviewUI();
  };

  window.updateGroupReviewCell = function(rowIndex, field, value) {
    if (!selectedSheetKey || !canEditSheet(selectedSheetKey)) return;
    const sheet = ensureLocalSheet(selectedSheetKey);
    if (!sheet.rows[rowIndex]) return;
    sheet.rows[rowIndex][field] = value;
  };

  window.addGroupReviewRow = function() {
    if (!selectedSheetKey || !canEditSheet(selectedSheetKey)) return alert("선택한 본인 시트만 수정할 수 있습니다.");
    ensureLocalSheet(selectedSheetKey).rows.push(createMemberRow());
    renderGroupReviewUI();
  };

  window.removeGroupReviewRow = function(rowIndex) {
    if (!selectedSheetKey || !canEditSheet(selectedSheetKey)) return alert("선택한 본인 시트만 수정할 수 있습니다.");
    const sheet = ensureLocalSheet(selectedSheetKey);
    if (sheet.rows.length <= 1) return;
    sheet.rows.splice(rowIndex, 1);
    renderGroupReviewUI();
  };

  window.saveGroupReviewSheet = async function() {
    try {
      if (!selectedSheetKey || !canEditSheet(selectedSheetKey)) {
        return alert("선택한 본인 시트만 저장할 수 있습니다.");
      }

      const project = getSelectedProject();
      if (!project) return alert("먼저 프로젝트를 선택하세요.");

      const sheet = ensureLocalSheet(selectedSheetKey);
      await setDoc(
        sheetRef(project.id, selectedSheetKey),
        removeUndefinedDeep({
          type: "member",
          memberName: selectedSheetKey,
          rows: sheet.rows,
          updatedAt: nowIso(),
          updatedBy: selectedMember || selectedSheetKey,
          updatedByEmail: getCurrentUser()?.email || "",
          lockSessionId: sessionId,
          lockedBy: selectedMember || selectedSheetKey,
          lockedAt: nowIso()
        }),
        { merge: true }
      );

      alert(`${selectedSheetKey} 시트가 저장되었습니다.`);
    } catch (error) {
      console.error("그룹리뷰 저장 실패:", error);
      alert("그룹리뷰 저장 실패: " + (error.message || error));
    }
  };

  window.downloadGroupReviewExcel = function() {
    const project = getSelectedProject();
    if (!project) return alert("다운로드할 그룹리뷰 프로젝트가 없습니다.");
    if (typeof XLSX === "undefined") return alert("엑셀 다운로드 라이브러리를 불러오지 못했습니다.");

    const wb = XLSX.utils.book_new();
    const qnaRows = [["Collateral #", "Sheet", "Field no", "내용", "답변"]];

    fixedMembers.forEach(member => {
      const sheet = ensureLocalSheet(member);
      sheet.rows.filter(rowHasValue).forEach(row => {
        qnaRows.push([
          row.collateralNo || "",
          row.sheet || "",
          row.fieldNo || "",
          `[${member}] ${row.changeText || ""}`.trim(),
          ""
        ]);
      });
    });

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(qnaRows), "Q&A");

    fixedMembers.forEach(member => {
      const sheet = ensureLocalSheet(member);
      const rows = [["Collateral #", "Sheet", "Field no", "변경내용"]];
      sheet.rows.filter(rowHasValue).forEach(row => {
        rows.push([
          row.collateralNo || "",
          row.sheet || "",
          row.fieldNo || "",
          row.changeText || ""
        ]);
      });

      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), member.slice(0, 31));
    });

    const safeName = String(project.name || "그룹리뷰").replace(/[\\/?*[\]:]/g, "_");
    XLSX.writeFile(wb, `${safeName}_Group_Review.xlsx`);
  };

  function renderProjectBadges() {
    const wrap = document.getElementById("groupReviewProjectBadges");
    if (!wrap) return;

    wrap.innerHTML = "";

    projects.forEach(project => {
      const btn = document.createElement("button");
      btn.className = "work-badge" + (project.id === selectedProjectId ? " active" : "");
      btn.textContent = project.name;
      btn.onclick = () => window.selectGroupReviewProject(project.id);
      wrap.appendChild(btn);
    });
  }

  function renderMemberSelector() {
    const memberOptions = fixedMembers.map(member => {
      const lock = getLockState(member);
      const active = member === selectedMember;
      const className = "work-badge" + (active ? " active" : "") + (lock.active && !lock.own ? " review-locked" : "");
      const lockLabel = lock.label ? ` · ${lock.label}` : "";
      return `<button class="${className}" onclick="selectGroupReviewMember(${jsArg(member)})">${escapeHtml(member + lockLabel)}</button>`;
    }).join("");

    return `
      <div class="work-info">
        공용 리뷰 계정은 이름을 선택한 뒤 해당 이름 시트만 입력합니다. 사용 중 표시는 ${lockMinutes}분 뒤 자동 만료됩니다.
      </div>
      <div class="work-badges review-member-badges">
        ${memberOptions}
      </div>
    `;
  }

  function renderSheetTabs() {
    const qnaActive = selectedSheetKey === "_qna";
    const tabs = [
      `<button class="work-badge${qnaActive ? " active" : ""}" onclick="selectGroupReviewSheet('_qna')">Q&A 전체</button>`,
      ...fixedMembers.map(member => {
        const active = selectedSheetKey === member;
        const editable = canEditSheet(member);
        const suffix = editable ? " · 입력" : "";
        return `<button class="work-badge${active ? " active" : ""}" onclick="selectGroupReviewSheet(${jsArg(member)})">${escapeHtml(member + suffix)}</button>`;
      })
    ].join("");

    return `<div class="work-badges review-sheet-tabs">${tabs}</div>`;
  }

  function renderQnaSheet() {
    const rows = [];

    fixedMembers.forEach(member => {
      const sheet = ensureLocalSheet(member);
      sheet.rows.filter(rowHasValue).forEach(row => {
        rows.push({ member, ...row });
      });
    });

    const bodyRows = rows.length
      ? rows.map(row => `
          <tr>
            <td>${escapeHtml(row.collateralNo)}</td>
            <td>${escapeHtml(row.sheet)}</td>
            <td>${escapeHtml(row.fieldNo)}</td>
            <td>${escapeHtml(row.changeText)}</td>
            <td>${escapeHtml(row.member)}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="5" class="note">아직 입력된 리뷰가 없습니다.</td></tr>`;

    return `
      <div class="work-info">
        Q&A 전체는 개인 시트 입력 내용을 취합해서 보여주는 읽기 전용 화면입니다.
      </div>
      <div class="work-table-wrap">
        <table class="work-table">
          <thead>
            <tr>
              <th>Collateral #</th>
              <th>Sheet</th>
              <th>Field no</th>
              <th>내용</th>
              <th>작성자</th>
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    `;
  }

  function renderMemberSheet(sheetKey) {
    const sheet = ensureLocalSheet(sheetKey);
    const editable = canEditSheet(sheetKey);
    const lock = getLockState(sheetKey);

    const rowsHtml = sheet.rows.map((row, rowIndex) => `
      <tr>
        <td>
          <input type="text" value="${escapeHtml(row.collateralNo)}" ${editable ? "" : "readonly"}
            oninput="updateGroupReviewCell(${rowIndex}, 'collateralNo', this.value)">
        </td>
        <td>
          <input type="text" value="${escapeHtml(row.sheet)}" ${editable ? "" : "readonly"}
            oninput="updateGroupReviewCell(${rowIndex}, 'sheet', this.value)">
        </td>
        <td>
          <input type="text" value="${escapeHtml(row.fieldNo)}" ${editable ? "" : "readonly"}
            oninput="updateGroupReviewCell(${rowIndex}, 'fieldNo', this.value)">
        </td>
        <td>
          <input type="text" value="${escapeHtml(row.changeText)}" ${editable ? "" : "readonly"}
            oninput="updateGroupReviewCell(${rowIndex}, 'changeText', this.value)">
        </td>
        <td>
          ${editable ? `<button class="small-btn danger" onclick="removeGroupReviewRow(${rowIndex})">삭제</button>` : ""}
        </td>
      </tr>
    `).join("");

    const lockText = lock.active
      ? lock.own
        ? "현재 내가 선택한 시트입니다."
        : "다른 사용자가 선택한 시트입니다."
      : "현재 사용 중 표시가 없습니다.";

    return `
      <div class="work-project-header">
        <div>
          <div class="work-project-title">${escapeHtml(sheetKey)}</div>
          <div class="note">${escapeHtml(lockText)} ${sheet.updatedAt ? "마지막 저장: " + escapeHtml(sheet.updatedAt) : ""}</div>
        </div>
      </div>

      <div class="work-header-actions">
        <button class="action-btn" onclick="addGroupReviewRow()" ${editable ? "" : "disabled"}>행 추가</button>
        <button class="action-btn" onclick="saveGroupReviewSheet()" ${editable ? "" : "disabled"}>현재 시트 저장</button>
      </div>

      <div class="work-table-wrap">
        <table class="work-table">
          <thead>
            <tr>
              <th>Collateral #</th>
              <th>Sheet</th>
              <th>Field no</th>
              <th>변경내용</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  }

  function renderGroupReviewUI() {
    const body = document.getElementById("groupReviewBody");
    if (!body) return;

    if (!canUse()) {
      stopSubscriptions();
      const badgeWrap = document.getElementById("groupReviewProjectBadges");
      if (badgeWrap) badgeWrap.innerHTML = "";
      body.innerHTML = `
        <div class="work-empty">
          그룹리뷰는 리뷰 전용 계정 또는 관리자 계정으로 로그인해야 사용할 수 있습니다.
        </div>
      `;
      return;
    }

    subscribeProjects();
    renderProjectBadges();

    if (!projects.length) {
      body.innerHTML = `
        <div class="work-empty">
          생성된 그룹리뷰 프로젝트가 없습니다.<br>
          상단의 <strong>리뷰 프로젝트 생성</strong> 버튼으로 프로젝트를 먼저 만드세요.
        </div>
      `;
      return;
    }

    const project = getSelectedProject();
    if (!project) {
      body.innerHTML = `<div class="work-empty">선택된 그룹리뷰 프로젝트가 없습니다.</div>`;
      return;
    }

    if (!selectedSheetKey) {
      selectedSheetKey = selectedMember || fixedMembers[0];
    }

    const sheetContent = selectedSheetKey === "_qna"
      ? renderQnaSheet()
      : renderMemberSheet(selectedSheetKey);

    body.innerHTML = `
      <div class="work-project-header">
        <div>
          <div class="work-project-title">${escapeHtml(project.name)}</div>
          <div class="note">프로젝트별/사람별 문서로 따로 저장되어 다른 사람 시트를 덮어쓰지 않습니다.</div>
        </div>
      </div>

      ${renderMemberSelector()}
      ${renderSheetTabs()}
      ${sheetContent}
    `;
  }

  renderGroupReviewUI();

  return {
    renderGroupReviewUI
  };
}
