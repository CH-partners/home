import { collection, doc, setDoc, onSnapshot, runTransaction, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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
  const activeMemberStorageKey = "groupReviewActiveMember";

  let projects = [];
  let selectedProjectId = null;
  let selectedSheetKey = null;
  let selectedMember = sessionStorage.getItem(memberStorageKey) || "";
  let activeMember = sessionStorage.getItem(activeMemberStorageKey) || "";
  let sheetsData = {};
  let unsubscribeProjects = null;
  let unsubscribeSheets = null;
  let subscribedProjectId = null;
  let projectsLoaded = false;
  let projectsError = "";
  let creatingDefaultProject = false;
  const dirtySheetKeys = new Set();

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

  function ensureSelectedProject() {
    if (!selectedProjectId || !projects.some(project => project.id === selectedProjectId)) {
      selectedProjectId = projects[0]?.id || null;
    }
    return getSelectedProject();
  }

  function jsArg(value) {
    return JSON.stringify(String(value ?? ""))
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function compactDateTimeLabel() {
    const d = new Date();
    const pad = value => String(value).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function createMemberRow() {
    return {
      id: "row_" + Date.now() + "_" + Math.random().toString(36).slice(2),
      collateralNo: "",
      sheet: "",
      fieldNo: "",
      checked: false,
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
      checked: Boolean(row?.checked),
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
      lockedAt: data.lockedAt || "",
      completed: Boolean(data.completed)
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

  function markSheetDirty(sheetKey) {
    if (sheetKey) dirtySheetKeys.add(sheetKey);
  }

  function preserveDirtyLocalSheets(nextSheets) {
    dirtySheetKeys.forEach(sheetKey => {
      if (!sheetsData[sheetKey]) return;
      nextSheets[sheetKey] = {
        ...(nextSheets[sheetKey] || normalizeSheetDoc(sheetKey)),
        ...sheetsData[sheetKey],
        rows: sheetsData[sheetKey].rows
      };
    });

    return nextSheets;
  }

  function rowHasValue(row) {
    return row?.checked || ["collateralNo", "sheet", "fieldNo", "changeText"].some(field =>
      String(row?.[field] || "").trim() !== ""
    );
  }

  function fitReviewTextarea(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(72, el.scrollHeight)}px`;
  }

  function fitReviewTextareas() {
    document.querySelectorAll(".review-textarea").forEach(fitReviewTextarea);
  }

  window.fitGroupReviewTextarea = fitReviewTextarea;

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

  function isSheetCompleted(sheetKey) {
    return Boolean(sheetsData[sheetKey]?.completed);
  }

  function canUseActiveSheet(sheetKey) {
    if (!canUse()) return false;
    if (isAdmin(getCurrentUser())) return true;
    return !!activeMember && sheetKey === activeMember;
  }

  function canEditSheet(sheetKey) {
    return canUseActiveSheet(sheetKey) && !isSheetCompleted(sheetKey);
  }

  function canCheckSheet(sheetKey) {
    return canUseActiveSheet(sheetKey);
  }

  async function deleteRefsInBatches(refs) {
    let batch = writeBatch(db);
    let count = 0;

    for (const ref of refs) {
      batch.delete(ref);
      count += 1;

      if (count >= 450) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
    }

    if (count > 0) {
      await batch.commit();
    }
  }

  async function deleteGroupReviewProjectById(projectId) {
    const sheetSnap = await getDocs(sheetsColRef(projectId));
    const refs = sheetSnap.docs.map(sheetDoc => sheetDoc.ref);
    refs.push(projectRef(projectId));
    await deleteRefsInBatches(refs);
  }

  async function createGroupReviewProject(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) throw new Error("프로젝트 이름이 없습니다.");

    const id = "review_project_" + Date.now();
    const project = {
      id,
      name: trimmed,
      members: [...fixedMembers],
      createdAt: nowIso(),
      createdByEmail: getCurrentUser()?.email || "",
      createdBy: selectedMember || getCurrentUser()?.email || "unknown"
    };

    await setDoc(
      projectRef(id),
      removeUndefinedDeep(project)
    );

    if (!projects.some(item => item.id === id)) {
      projects.push(project);
      projects.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    }
    projectsLoaded = true;
    projectsError = "";
    selectedProjectId = id;
    selectedSheetKey = selectedMember || "";
    subscribeSheets(id);
    return id;
  }

  async function createDefaultProjectForSelectedMember() {
    if (!selectedMember || creatingDefaultProject) return;

    creatingDefaultProject = true;
    projectsError = "";
    renderGroupReviewUI();

    try {
      await createGroupReviewProject(`그룹리뷰 ${compactDateTimeLabel()}`);
    } catch (error) {
      projectsError = error.message || String(error);
      throw error;
    } finally {
      creatingDefaultProject = false;
      renderGroupReviewUI();
    }
  }

  function getDisplayProject() {
    return ensureSelectedProject() || {
      id: "",
      name: creatingDefaultProject ? "프로젝트 생성 중" : "임시 입력 시트"
    };
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

  async function releaseOwnMemberLock(member) {
    const project = getSelectedProject();
    if (!project || !member) return;

    const ref = sheetRef(project.id, member);
    await runTransaction(db, async transaction => {
      const snap = await transaction.get(ref);
      const data = snap.data() || {};
      if (data.lockSessionId && data.lockSessionId !== sessionId && !isAdmin(getCurrentUser())) return;

      transaction.set(ref, removeUndefinedDeep({
        type: "member",
        memberName: member,
        lockSessionId: "",
        lockedBy: "",
        lockedAt: "",
        updatedByEmail: getCurrentUser()?.email || ""
      }), { merge: true });
    });

    if (sheetsData[member]) {
      sheetsData[member].lockSessionId = "";
      sheetsData[member].lockedBy = "";
      sheetsData[member].lockedAt = "";
    }
  }

  function clearLocalOwnLocksExcept(memberToKeep) {
    fixedMembers.forEach(member => {
      if (member === memberToKeep) return;
      const lock = getLockState(member);
      if (!lock.own || !sheetsData[member]) return;

      sheetsData[member].lockSessionId = "";
      sheetsData[member].lockedBy = "";
      sheetsData[member].lockedAt = "";
    });
  }

  async function releaseOwnLocksExcept(memberToKeep) {
    const membersToRelease = fixedMembers.filter(member => member !== memberToKeep && getLockState(member).own);
    for (const member of membersToRelease) {
      await releaseOwnMemberLock(member);
    }
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
        sheetsData = preserveDirtyLocalSheets(nextSheets);

        if ((activeMember || selectedMember) && !selectedSheetKey) selectedSheetKey = activeMember || selectedMember;
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
    projectsLoaded = true;
    projectsError = "";
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

    if (projects.length) {
      ensureSelectedProject();
      selectedSheetKey = activeMember || selectedMember || "";
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
        projectsLoaded = true;
        projectsError = error.message || String(error);
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

      await createGroupReviewProject(trimmed);
      renderGroupReviewUI();
    } catch (error) {
      console.error("그룹리뷰 프로젝트 생성 실패:", error);
      alert("그룹리뷰 프로젝트 생성 실패: " + (error.message || error));
    }
  };

  window.selectGroupReviewProject = function(projectId) {
    selectedProjectId = projectId;
    selectedSheetKey = selectedMember || "";
    subscribeSheets(projectId);
    renderGroupReviewUI();
  };

  window.selectGroupReviewMember = async function(member) {
    try {
      if (!canUse()) return alert("리뷰 계정 또는 관리자만 사용할 수 있습니다.");
      if (!fixedMembers.includes(member)) return;
      if (activeMember && !isSheetCompleted(activeMember) && member !== activeMember && !isAdmin(getCurrentUser())) {
        alert("이미 사용 중인 이름이 있습니다. 완료 버튼을 누른 뒤 다른 이름을 선택하세요.");
        return;
      }

      if (activeMember && isSheetCompleted(activeMember) && member !== activeMember) {
        activeMember = "";
        selectedSheetKey = "";
        sessionStorage.removeItem(activeMemberStorageKey);
      }

      const lock = getLockState(member);
      if (lock.active && !lock.own && !isAdmin(getCurrentUser())) {
        alert(`${member} 시트는 다른 사람이 사용 중입니다. 잠시 후 다시 선택해주세요.`);
        return;
      }

      selectedMember = member;
      selectedSheetKey = activeMember || "";
      sessionStorage.setItem(memberStorageKey, member);
      clearLocalOwnLocksExcept(member);
      renderGroupReviewUI();
      void releaseOwnLocksExcept(member).catch(error => console.warn("이전 리뷰 이름 잠금 해제 실패:", error));
    } catch (error) {
      console.error("리뷰 이름 선택 실패:", error);
      alert("리뷰 이름 선택 실패: " + (error.message || error));
    }
  };

  window.startGroupReviewUse = async function() {
    try {
      if (!canUse()) return alert("리뷰 계정 또는 관리자만 사용할 수 있습니다.");
      if (!selectedMember) return alert("먼저 이름을 선택하세요.");
      if (activeMember) return alert("이미 사용 중입니다. 완료 버튼을 누른 뒤 다시 시작하세요.");

      let project = ensureSelectedProject();
      if (!project) {
        await createDefaultProjectForSelectedMember();
        project = ensureSelectedProject();
      }
      if (!project) return alert("그룹리뷰 프로젝트를 만들지 못했습니다. Firestore 권한을 확인하세요.");

      const sheet = ensureLocalSheet(selectedMember);
      if (!sheet.completed) {
        await lockSelectedMember(selectedMember);
      }

      activeMember = selectedMember;
      selectedSheetKey = activeMember;
      sessionStorage.setItem(memberStorageKey, selectedMember);
      sessionStorage.setItem(activeMemberStorageKey, activeMember);
      renderGroupReviewUI();
    } catch (error) {
      console.error("그룹리뷰 사용 시작 실패:", error);
      alert("그룹리뷰 사용 시작 실패: " + (error.message || error));
    }
  };

  window.deleteSelectedGroupReviewProject = async function() {
    try {
      if (!canUse()) return alert("리뷰 계정 또는 관리자만 사용할 수 있습니다.");

      const project = getSelectedProject();
      if (!project) return alert("삭제할 프로젝트를 먼저 선택하세요.");

      const ok = confirm(`"${project.name}" 프로젝트와 모든 개인 시트를 삭제할까요?`);
      if (!ok) return;

      await deleteGroupReviewProjectById(project.id);

      selectedProjectId = null;
      selectedSheetKey = selectedMember || "";
      sheetsData = {};
      renderGroupReviewUI();
      alert("선택한 그룹리뷰 프로젝트가 삭제되었습니다.");
    } catch (error) {
      console.error("그룹리뷰 프로젝트 삭제 실패:", error);
      alert("그룹리뷰 프로젝트 삭제 실패: " + (error.message || error));
    }
  };

  window.deleteAllGroupReviewProjects = async function() {
    try {
      if (!canUse()) return alert("리뷰 계정 또는 관리자만 사용할 수 있습니다.");
      if (!projects.length) return alert("삭제할 그룹리뷰 프로젝트가 없습니다.");

      const typed = prompt(`전체 ${projects.length}개 그룹리뷰 프로젝트와 모든 개인 시트를 삭제하려면 "전체삭제"를 입력하세요.`);
      if (typed !== "전체삭제") return;

      const targetIds = projects.map(project => project.id);
      for (const projectId of targetIds) {
        await deleteGroupReviewProjectById(projectId);
      }

      selectedProjectId = null;
      selectedSheetKey = selectedMember || "";
      sheetsData = {};
      renderGroupReviewUI();
      alert("전체 그룹리뷰 프로젝트가 삭제되었습니다.");
    } catch (error) {
      console.error("전체 그룹리뷰 프로젝트 삭제 실패:", error);
      alert("전체 그룹리뷰 프로젝트 삭제 실패: " + (error.message || error));
    }
  };

  window.selectGroupReviewSheet = function(sheetKey) {
    if (activeMember && !isSheetCompleted(activeMember) && sheetKey !== activeMember && !isAdmin(getCurrentUser())) {
      alert("사용 중에는 선택한 본인 시트만 볼 수 있습니다. 완료 후 다른 이름을 선택하세요.");
      return;
    }
    selectedSheetKey = sheetKey === "_qna" ? selectedMember : sheetKey;
    renderGroupReviewUI();
  };

  window.updateGroupReviewCell = function(rowIndex, field, value) {
    if (!selectedSheetKey) return;
    if (field === "checked") {
      if (!canCheckSheet(selectedSheetKey)) return;
    } else if (!canEditSheet(selectedSheetKey)) {
      return;
    }
    const sheet = ensureLocalSheet(selectedSheetKey);
    if (!sheet.rows[rowIndex]) return;
    sheet.rows[rowIndex][field] = field === "checked" ? Boolean(value) : value;
    markSheetDirty(selectedSheetKey);
  };

  window.addGroupReviewRow = function() {
    if (!selectedSheetKey || !canEditSheet(selectedSheetKey)) return alert("선택한 본인 시트만 수정할 수 있습니다.");
    ensureLocalSheet(selectedSheetKey).rows.push(createMemberRow());
    markSheetDirty(selectedSheetKey);
    renderGroupReviewUI();
  };

  window.removeGroupReviewRow = function(rowIndex) {
    if (!selectedSheetKey || !canEditSheet(selectedSheetKey)) return alert("선택한 본인 시트만 수정할 수 있습니다.");
    const sheet = ensureLocalSheet(selectedSheetKey);
    if (sheet.rows.length <= 1) return;
    sheet.rows.splice(rowIndex, 1);
    markSheetDirty(selectedSheetKey);
    renderGroupReviewUI();
  };

  async function persistGroupReviewSheet({ silent = false, keepLock = true, completed = null } = {}) {
    if (!selectedSheetKey || !canUseActiveSheet(selectedSheetKey)) {
      throw new Error("선택한 본인 시트만 저장할 수 있습니다.");
    }

    let project = ensureSelectedProject();
    if (!project) {
      await createDefaultProjectForSelectedMember();
      project = ensureSelectedProject();
    }
    if (!project) throw new Error("그룹리뷰 프로젝트를 만들지 못했습니다. Firestore 권한을 확인하세요.");

    const sheet = ensureLocalSheet(selectedSheetKey);
    const nextCompleted = completed === null ? Boolean(sheet.completed) : Boolean(completed);
    await setDoc(
      sheetRef(project.id, selectedSheetKey),
      removeUndefinedDeep({
        type: "member",
        memberName: selectedSheetKey,
        rows: sheet.rows,
        updatedAt: nowIso(),
        updatedBy: activeMember || selectedMember || selectedSheetKey,
        updatedByEmail: getCurrentUser()?.email || "",
        lockSessionId: keepLock ? sessionId : "",
        lockedBy: keepLock ? (activeMember || selectedMember || selectedSheetKey) : "",
        lockedAt: keepLock ? nowIso() : "",
        completed: nextCompleted
      }),
      { merge: true }
    );

    sheet.completed = nextCompleted;
    sheet.lockSessionId = keepLock ? sessionId : "";
    sheet.lockedBy = keepLock ? (activeMember || selectedMember || selectedSheetKey) : "";
    sheet.lockedAt = keepLock ? nowIso() : "";
    dirtySheetKeys.delete(selectedSheetKey);
    if (!silent) alert(`${selectedSheetKey} 시트가 저장되었습니다.`);
    return project;
  }

  window.saveGroupReviewSheet = async function() {
    try {
      await persistGroupReviewSheet({ silent: false, keepLock: !isSheetCompleted(selectedSheetKey) });
    } catch (error) {
      console.error("그룹리뷰 저장 실패:", error);
      alert("그룹리뷰 저장 실패: " + (error.message || error));
    }
  };

  window.completeGroupReviewUse = async function() {
    try {
      if (!activeMember) return alert("사용 중인 이름이 없습니다.");
      selectedMember = activeMember;
      selectedSheetKey = activeMember;

      await persistGroupReviewSheet({ silent: true, keepLock: false, completed: true });

      renderGroupReviewUI();
      alert("입력 완료되었습니다. 입력칸은 잠기고 확인 체크는 계속 가능합니다.");
    } catch (error) {
      console.error("그룹리뷰 완료 실패:", error);
      alert("그룹리뷰 완료 실패: " + (error.message || error));
    }
  };

  window.downloadGroupReviewExcel = function() {
    const project = getSelectedProject();
    if (!project) return alert("다운로드할 그룹리뷰 프로젝트가 없습니다.");
    if (typeof XLSX === "undefined") return alert("엑셀 다운로드 라이브러리를 불러오지 못했습니다.");

    const wb = XLSX.utils.book_new();

    fixedMembers.forEach(member => {
      const sheet = ensureLocalSheet(member);
      const rows = [["확인", "Collateral #", "Sheet", "Field no", "변경내용"]];
      sheet.rows.filter(rowHasValue).forEach(row => {
        rows.push([
          row.checked ? "확인" : "",
          row.collateralNo || "",
          row.sheet || "",
          row.fieldNo || "",
          row.changeText || ""
        ]);
      });

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [
        { wch: 8 },
        { wch: 12 },
        { wch: 10 },
        { wch: 8 },
        { wch: 80 }
      ];
      XLSX.utils.book_append_sheet(wb, ws, member.slice(0, 31));
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
      const active = member === (activeMember || selectedMember);
      const activeCompleted = activeMember && isSheetCompleted(activeMember);
      const disabled = activeMember && !activeCompleted
        ? member !== activeMember && !isAdmin(getCurrentUser())
        : lock.active && !lock.own && !isAdmin(getCurrentUser());
      const className =
        "work-badge review-member-btn" +
        (active ? " active" : "") +
        (lock.active && !lock.own ? " review-locked" : "") +
        (disabled ? " review-disabled" : "");
      const stateLabel = activeMember === member
        ? isSheetCompleted(member) ? " · 입력완료" : " · 사용 중"
        : !activeMember && selectedMember === member
          ? " · 선택됨"
          : lock.label ? ` · ${lock.label}` : "";
      const disabledAttr = disabled ? " disabled" : "";
      return `<button class="${className}" onclick="selectGroupReviewMember(${jsArg(member)})"${disabledAttr}>${escapeHtml(member + stateLabel)}</button>`;
    }).join("");

    const activeCompleted = activeMember && isSheetCompleted(activeMember);
    const controlHtml = activeMember
      ? activeCompleted
        ? `
        <div class="review-use-controls completed">
          <span><strong>${escapeHtml(activeMember)}</strong> 입력 완료 상태입니다. 입력칸은 잠겼고 확인 체크만 가능합니다.</span>
          <button class="action-btn" onclick="saveGroupReviewSheet()">확인 저장</button>
        </div>
      `
        : `
        <div class="review-use-controls active">
          <span><strong>${escapeHtml(activeMember)}</strong> 사용 중입니다. 입력이 끝나면 완료를 눌러 입력칸을 잠그세요.</span>
          <button class="action-btn danger" onclick="completeGroupReviewUse()">완료</button>
        </div>
      `
      : `
        <div class="review-use-controls">
          <span>${selectedMember ? `<strong>${escapeHtml(selectedMember)}</strong> 선택됨` : "이름을 선택한 뒤 사용 시작을 누르세요."}</span>
          <button class="action-btn" onclick="startGroupReviewUse()" ${selectedMember ? "" : "disabled"}>사용 시작</button>
        </div>
      `;

    return `
      <div class="work-info">
        이름 선택 후 사용 시작을 누르면 해당 이름 시트만 입력할 수 있습니다. 사용 중 표시는 ${lockMinutes}분 뒤 자동 만료됩니다.
      </div>
      <div class="work-badges review-member-badges">
        ${memberOptions}
      </div>
      ${controlHtml}
    `;
  }

  function renderSheetTabs() {
    const tabs = fixedMembers.map(member => {
        const active = selectedSheetKey === member;
        const editable = canEditSheet(member);
        const completed = isSheetCompleted(member);
        const suffix = completed ? " · 완료" : editable ? " · 입력" : "";
        const disabled = activeMember && !isSheetCompleted(activeMember) && member !== activeMember && !isAdmin(getCurrentUser());
        return `<button class="work-badge review-sheet-btn${active ? " active" : ""}${disabled ? " review-disabled" : ""}" onclick="selectGroupReviewSheet(${jsArg(member)})" ${disabled ? "disabled" : ""}>${escapeHtml(member + suffix)}</button>`;
      }).join("");

    return `<div class="work-badges review-sheet-tabs">${tabs}</div>`;
  }

  function renderMemberSheet(sheetKey) {
    const sheet = ensureLocalSheet(sheetKey);
    const editable = canEditSheet(sheetKey);
    const checkable = canCheckSheet(sheetKey);
    const completed = isSheetCompleted(sheetKey);
    const lock = getLockState(sheetKey);

    const rowsHtml = sheet.rows.map((row, rowIndex) => `
      <tr class="${row.checked ? "review-row-checked" : ""}">
        <td class="review-check-cell">
          <input type="checkbox" ${row.checked ? "checked" : ""} ${checkable ? "" : "disabled"}
            onchange="updateGroupReviewCell(${rowIndex}, 'checked', this.checked); this.closest('tr')?.classList.toggle('review-row-checked', this.checked)">
        </td>
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
        <td class="review-content-cell">
          <textarea class="review-textarea" ${editable ? "" : "readonly"}
            oninput="updateGroupReviewCell(${rowIndex}, 'changeText', this.value); fitGroupReviewTextarea(this)">${escapeHtml(row.changeText)}</textarea>
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
    const statusText = completed
      ? "입력 완료 상태입니다. 입력칸은 잠겼고 확인 체크만 가능합니다."
      : lockText;

    return `
      <div class="work-project-header">
        <div>
          <div class="work-project-title">${escapeHtml(sheetKey)}</div>
          <div class="note">${escapeHtml(statusText)} ${sheet.updatedAt ? "마지막 저장: " + escapeHtml(sheet.updatedAt) : ""}</div>
        </div>
      </div>

      <div class="work-header-actions">
        <button class="action-btn" onclick="addGroupReviewRow()" ${editable ? "" : "disabled"}>행 추가</button>
        <button class="action-btn" onclick="saveGroupReviewSheet()" ${checkable ? "" : "disabled"}>${completed ? "확인 저장" : "임시저장"}</button>
        ${completed ? "" : `<button class="action-btn danger" onclick="completeGroupReviewUse()" ${editable ? "" : "disabled"}>완료</button>`}
      </div>

      <div class="work-table-wrap">
        <table class="work-table review-table review-member-table">
          <colgroup>
            <col class="review-col-check">
            <col class="review-col-collateral">
            <col class="review-col-sheet">
            <col class="review-col-field">
            <col class="review-col-content">
            <col class="review-col-manage">
          </colgroup>
          <thead>
            <tr>
              <th>확인</th>
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

    if (activeMember && !selectedMember) {
      selectedMember = activeMember;
    }

    if (!selectedMember) {
      selectedSheetKey = "";
      body.innerHTML = `
        <div class="group-review-name-first">
          <div class="work-empty">
            <strong>리뷰 입력자 이름을 먼저 선택하세요.</strong><br>
            이름을 고른 뒤 사용 시작을 눌러야 입력 시트가 열립니다.
          </div>
          ${renderMemberSelector()}
        </div>
      `;
      return;
    }

    if (!activeMember) {
      selectedSheetKey = "";
      body.innerHTML = `
        <div class="group-review-name-first">
          <div class="work-empty">
            <strong>${escapeHtml(selectedMember)}</strong> 이름이 선택되었습니다.<br>
            아래의 <strong>사용 시작</strong>을 누르면 입력 시트가 열리고 다른 이름 선택이 잠깁니다.
          </div>
          ${renderMemberSelector()}
        </div>
      `;
      return;
    }

    selectedMember = activeMember;

    if (!selectedSheetKey) {
      selectedSheetKey = activeMember;
    }
    if (selectedSheetKey === "_qna") {
      selectedSheetKey = activeMember;
    }
    if (selectedSheetKey !== activeMember && !isSheetCompleted(activeMember) && !isAdmin(getCurrentUser())) {
      selectedSheetKey = activeMember;
    }

    const project = getDisplayProject();
    const projectNote = projectsError
      ? `프로젝트 목록을 불러오지 못했습니다. 저장 시 다시 시도합니다: ${projectsError}`
      : creatingDefaultProject
        ? "프로젝트를 생성하는 중입니다. 입력은 계속할 수 있습니다."
        : !projectsLoaded
          ? "프로젝트 목록을 불러오는 중입니다. 입력은 먼저 할 수 있습니다."
          : !projects.length
            ? "아직 프로젝트가 없습니다. 저장하면 기본 프로젝트가 자동 생성됩니다."
            : "프로젝트별/사람별 문서로 따로 저장되어 다른 사람 시트를 덮어쓰지 않습니다.";

    const sheetContent = renderMemberSheet(selectedSheetKey);

    body.innerHTML = `
      <div class="work-project-header">
        <div>
          <div class="work-project-title">${escapeHtml(project.name)}</div>
          <div class="note">${escapeHtml(projectNote)}</div>
        </div>
      </div>

      ${renderMemberSelector()}
      ${renderSheetTabs()}
      ${sheetContent}
    `;
    requestAnimationFrame(fitReviewTextareas);
  }

  function requireMemberSelection() {
    if (activeMember) {
      selectedMember = activeMember;
      selectedSheetKey = activeMember;
      renderGroupReviewUI();
      return;
    }
    selectedMember = "";
    selectedSheetKey = "";
    sessionStorage.removeItem(memberStorageKey);
    renderGroupReviewUI();
  }

  renderGroupReviewUI();

  return {
    renderGroupReviewUI,
    requireMemberSelection
  };
}
