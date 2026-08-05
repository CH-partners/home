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
  const reviewTextSizes = [
    { value: "small", label: "작게" },
    { value: "normal", label: "기본" },
    { value: "large", label: "크게" },
    { value: "huge", label: "아주 크게" }
  ];
  const reviewTextSizeSet = new Set(reviewTextSizes.map(item => item.value));

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

  function normalizeReviewTextSize(value) {
    const size = String(value || "normal").trim();
    return reviewTextSizeSet.has(size) ? size : "normal";
  }

  function normalizeReviewBold(value) {
    return value === true || value === "true" || value === 1 || value === "1";
  }

  function textToReviewTextHtml(text, bold = false) {
    const html = escapeHtml(String(text ?? "")).replace(/\r\n|\r|\n/g, "<br>");
    return bold && html ? `<strong>${html}</strong>` : html;
  }

  function sanitizeReviewTextHtml(html) {
    const raw = String(html || "");
    if (!raw.trim()) return "";

    const template = document.createElement("template");
    const output = document.createElement("div");
    template.innerHTML = raw;

    const appendLineBreak = target => {
      if (target.childNodes.length && target.lastChild?.nodeName !== "BR") {
        target.appendChild(document.createElement("br"));
      }
    };

    const appendCleanNode = (node, target) => {
      if (node.nodeType === Node.TEXT_NODE) {
        target.appendChild(document.createTextNode(node.textContent || ""));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();
      if (tag === "br") {
        target.appendChild(document.createElement("br"));
        return;
      }
      if (tag === "strong" || tag === "b") {
        const strong = document.createElement("strong");
        node.childNodes.forEach(child => appendCleanNode(child, strong));
        if (strong.textContent || strong.querySelector("br")) target.appendChild(strong);
        return;
      }
      if (tag === "span") {
        const sizeClass = Array.from(node.classList || []).find(cls => {
          const match = /^review-text-size-(.+)$/.exec(cls);
          return match && reviewTextSizeSet.has(match[1]);
        });
        if (sizeClass) {
          const span = document.createElement("span");
          span.className = sizeClass;
          node.childNodes.forEach(child => appendCleanNode(child, span));
          if (span.textContent || span.querySelector("br")) target.appendChild(span);
          return;
        }
      }
      if (["div", "p", "li"].includes(tag)) {
        appendLineBreak(target);
        node.childNodes.forEach(child => appendCleanNode(child, target));
        return;
      }

      node.childNodes.forEach(child => appendCleanNode(child, target));
    };

    template.content.childNodes.forEach(node => appendCleanNode(node, output));
    return output.innerHTML.replace(/(<br>)+$/g, "").trim();
  }

  function reviewTextHtmlToText(html) {
    const box = document.createElement("div");
    box.innerHTML = sanitizeReviewTextHtml(html);
    return (box.innerText || box.textContent || "").replace(/\u00a0/g, " ").replace(/\n$/, "");
  }

  function getReviewEditorText(editor) {
    return (editor?.innerText || editor?.textContent || "").replace(/\u00a0/g, " ").replace(/\n$/, "");
  }

  function getReviewTextSizeOptions() {
    return `<option value="" selected disabled hidden>글자크기</option>` + reviewTextSizes.map(size =>
      `<option value="${size.value}">${escapeHtml(size.label)}</option>`
    ).join("");
  }

  function reviewFieldKeys(field) {
    return field === "before"
      ? { text: "changeBeforeText", html: "changeBeforeHtml" }
      : { text: "changeAfterText", html: "changeAfterHtml" };
  }

  function getReviewTextHtml(row, field) {
    const { text: textKey, html: htmlKey } = reviewFieldKeys(field);
    return sanitizeReviewTextHtml(row?.[htmlKey] || textToReviewTextHtml(row?.[textKey] || ""));
  }

  function wrapHtmlWithSize(html, size) {
    const trimmed = String(html || "").trim();
    if (!trimmed) return "";
    const normalized = normalizeReviewTextSize(size);
    return normalized === "normal" ? trimmed : `<span class="review-text-size-${normalized}">${trimmed}</span>`;
  }

  function createMemberRow() {
    return {
      id: "row_" + Date.now() + "_" + Math.random().toString(36).slice(2),
      collateralNo: "",
      sheet: "",
      fieldNo: "",
      checked: false,
      changeBeforeText: "",
      changeBeforeHtml: "",
      changeAfterText: "",
      changeAfterHtml: ""
    };
  }

  function createBlankRows(count = 10) {
    return Array.from({ length: count }, () => createMemberRow());
  }

  function normalizeMemberRows(rows) {
    if (!Array.isArray(rows)) return [];

    return rows.map(row => {
      const hasSplitFields =
        row?.changeBeforeText !== undefined || row?.changeBeforeHtml !== undefined ||
        row?.changeAfterText !== undefined || row?.changeAfterHtml !== undefined;

      // 이전 버전에는 변경내용 칸이 하나였고(row.changeText), 그보다 더 이전엔 칸 전체에 균일한 글자크기(row.changeTextSize)를
      // 적용했음 — 기존 데이터는 "변경 후" 칸으로 이관하면서 그 크기를 인라인 span으로 보존한다.
      const legacyBaseHtml = row?.changeTextHtml || textToReviewTextHtml(row?.changeText ?? "", normalizeReviewBold(row?.changeTextBold));
      const legacyAfterHtml = wrapHtmlWithSize(legacyBaseHtml, row?.changeTextSize);

      const beforeHtml = sanitizeReviewTextHtml(
        row?.changeBeforeHtml || (hasSplitFields ? wrapHtmlWithSize(textToReviewTextHtml(row?.changeBeforeText ?? ""), row?.changeBeforeSize) : "")
      );
      const afterHtml = sanitizeReviewTextHtml(
        row?.changeAfterHtml || (hasSplitFields ? wrapHtmlWithSize(textToReviewTextHtml(row?.changeAfterText ?? ""), row?.changeAfterSize) : legacyAfterHtml)
      );

      return {
        id: row?.id || "row_" + Date.now() + "_" + Math.random().toString(36).slice(2),
        collateralNo: String(row?.collateralNo ?? ""),
        sheet: String(row?.sheet ?? ""),
        fieldNo: String(row?.fieldNo ?? ""),
        checked: Boolean(row?.checked),
        changeBeforeText: String(row?.changeBeforeText ?? reviewTextHtmlToText(beforeHtml)),
        changeBeforeHtml: beforeHtml,
        changeAfterText: String(row?.changeAfterText ?? reviewTextHtmlToText(afterHtml)),
        changeAfterHtml: afterHtml
      };
    });
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
    return row?.checked || ["collateralNo", "sheet", "fieldNo", "changeBeforeText", "changeAfterText"].some(field =>
      String(row?.[field] || "").trim() !== ""
    );
  }

  function fitReviewTextarea(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(38, el.scrollHeight)}px`;
  }

  function fitReviewTextareas() {
    document.querySelectorAll(".review-textarea, .review-rich-editor").forEach(fitReviewTextarea);
  }

  window.fitGroupReviewTextarea = fitReviewTextarea;
  window.fitGroupReviewTextEditor = fitReviewTextarea;

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

  function isAdminReviewingSheet(sheetKey = selectedSheetKey) {
    return isAdmin(getCurrentUser()) && !!sheetKey && sheetKey !== activeMember;
  }

  function getFirstReviewSheetKey() {
    return fixedMembers.find(member => sheetsData[member]?.rows?.some(rowHasValue)) || fixedMembers[0] || "";
  }

  function ensureAdminSelectedSheet() {
    if (!selectedSheetKey || !fixedMembers.includes(selectedSheetKey)) {
      selectedSheetKey = getFirstReviewSheetKey();
    }
    return selectedSheetKey;
  }

  function getSelectedSheetIndex() {
    const index = fixedMembers.indexOf(selectedSheetKey);
    return index >= 0 ? index : 0;
  }

  function getSheetProgress(sheetKey) {
    const sheet = ensureLocalSheet(sheetKey);
    const valueRows = sheet.rows.filter(rowHasValue);
    const checkedRows = valueRows.filter(row => row.checked);
    return {
      total: valueRows.length,
      checked: checkedRows.length
    };
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

  window.updateGroupReviewRichText = function(rowIndex, field, editor) {
    if (!selectedSheetKey || !canEditSheet(selectedSheetKey)) return;

    const sheet = ensureLocalSheet(selectedSheetKey);
    const row = sheet.rows[rowIndex];
    if (!row || !editor) return;

    const { text: textKey, html: htmlKey } = reviewFieldKeys(field);
    row[htmlKey] = sanitizeReviewTextHtml(editor.innerHTML);
    row[textKey] = getReviewEditorText(editor);
    markSheetDirty(selectedSheetKey);
    fitReviewTextarea(editor);
  };

  window.handleGroupReviewTextPaste = function(event, rowIndex, field, editor) {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") || "";
    document.execCommand("insertText", false, text);
    if (editor) window.updateGroupReviewRichText(rowIndex, field, editor);
  };

  // 완료 버튼 옆의 공용 툴바(글자크기·굵게) 하나로 시트 전체의 전/후 입력칸을 다 처리하기 때문에,
  // 버튼을 누른 시점의 브라우저 선택영역을 거슬러 올라가 어느 행(rowIndex)·어느 칸(전/후)인지 판단한다.
  function findReviewEditorContext(node) {
    let el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const editor = el?.closest?.(".review-rich-editor");
    if (!editor) return null;

    const cell = editor.closest("[data-review-content-row]");
    const rowIndex = cell ? Number(cell.dataset.reviewContentRow) : NaN;
    if (!Number.isInteger(rowIndex)) return null;

    const field = editor.closest(".review-content-before") ? "before" : "after";
    return { editor, rowIndex, field };
  }

  window.toggleGroupReviewSelectionBold = function() {
    if (!selectedSheetKey || !canEditSheet(selectedSheetKey)) return;

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return;

    const context = findReviewEditorContext(selection.anchorNode);
    if (!context) return;
    const { editor, rowIndex, field } = context;
    if (!editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return;

    document.execCommand("bold", false, null);
    window.updateGroupReviewRichText(rowIndex, field, editor);
  };

  let reviewSelectionSnapshot = null;

  // 글자크기 select는 네이티브 드롭다운이라 mousedown에서 preventDefault를 걸면 열리지 않으므로,
  // 포커스가 옮겨가기 전(mousedown 시점)에 현재 선택영역을 미리 저장해뒀다가 onchange에서 복원해 적용한다.
  window.captureGroupReviewSelection = function() {
    reviewSelectionSnapshot = null;

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const context = findReviewEditorContext(range.commonAncestorContainer);
    if (!context) return;

    reviewSelectionSnapshot = { ...context, range: range.cloneRange() };
  };

  window.applyGroupReviewSelectionSize = function(value) {
    const snapshot = reviewSelectionSnapshot;
    reviewSelectionSnapshot = null;
    if (!snapshot || !selectedSheetKey || !canEditSheet(selectedSheetKey)) return;
    if (!document.contains(snapshot.editor) || snapshot.range.collapsed) return;

    const size = normalizeReviewTextSize(value);
    const { editor, field, rowIndex, range } = snapshot;

    const span = document.createElement("span");
    span.className = `review-text-size-${size}`;
    span.appendChild(range.extractContents());
    range.insertNode(span);

    window.updateGroupReviewRichText(rowIndex, field, editor);
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

  async function persistGroupReviewChecksOnly({ silent = false } = {}) {
    if (!selectedSheetKey || !isAdminReviewingSheet(selectedSheetKey)) {
      throw new Error("관리자 검토 중인 시트가 없습니다.");
    }

    const project = ensureSelectedProject();
    if (!project) throw new Error("검토할 그룹리뷰 프로젝트가 없습니다.");

    const sheet = ensureLocalSheet(selectedSheetKey);
    const localRowsById = new Map(sheet.rows.map(row => [row.id, row]));
    let nextRows = [];

    await runTransaction(db, async transaction => {
      const ref = sheetRef(project.id, selectedSheetKey);
      const snap = await transaction.get(ref);
      const serverSheet = normalizeSheetDoc(selectedSheetKey, snap.data() || {});
      const sourceRows = serverSheet.rows.length ? serverSheet.rows : sheet.rows;

      nextRows = sourceRows.map((row, rowIndex) => {
        const localRow = localRowsById.get(row.id) || sheet.rows[rowIndex];
        return {
          ...row,
          checked: localRow ? Boolean(localRow.checked) : Boolean(row.checked)
        };
      });

      transaction.set(ref, removeUndefinedDeep({
        type: "member",
        memberName: selectedSheetKey,
        rows: nextRows,
        updatedAt: nowIso(),
        updatedBy: selectedSheetKey,
        updatedByEmail: getCurrentUser()?.email || ""
      }), { merge: true });
    });

    sheet.rows = nextRows;
    sheet.updatedAt = nowIso();
    sheet.updatedByEmail = getCurrentUser()?.email || "";
    dirtySheetKeys.delete(selectedSheetKey);
    if (!silent) alert(`${selectedSheetKey} 확인 상태가 저장되었습니다.`);
    return project;
  }

  window.saveGroupReviewSheet = async function() {
    try {
      if (isAdminReviewingSheet()) {
        await persistGroupReviewChecksOnly({ silent: false });
      } else {
        await persistGroupReviewSheet({ silent: false, keepLock: !isSheetCompleted(selectedSheetKey) });
      }
    } catch (error) {
      console.error("그룹리뷰 저장 실패:", error);
      alert("그룹리뷰 저장 실패: " + (error.message || error));
    }
  };

  window.moveGroupReviewAdminSheet = function(direction) {
    if (!isAdmin(getCurrentUser())) return alert("관리자만 사용할 수 있습니다.");
    ensureAdminSelectedSheet();

    const currentIndex = getSelectedSheetIndex();
    const nextIndex = Math.min(
      fixedMembers.length - 1,
      Math.max(0, currentIndex + Number(direction || 0))
    );

    selectedSheetKey = fixedMembers[nextIndex] || selectedSheetKey;
    selectedMember = "";
    renderGroupReviewUI();
  };

  window.saveGroupReviewSheetAndMove = async function(direction = 1) {
    try {
      if (!isAdmin(getCurrentUser())) return alert("관리자만 사용할 수 있습니다.");

      if (isAdminReviewingSheet()) {
        await persistGroupReviewChecksOnly({ silent: true });
      } else {
        await persistGroupReviewSheet({ silent: true, keepLock: !isSheetCompleted(selectedSheetKey) });
      }

      window.moveGroupReviewAdminSheet(direction);
    } catch (error) {
      console.error("그룹리뷰 확인 저장 후 이동 실패:", error);
      alert("그룹리뷰 확인 저장 후 이동 실패: " + (error.message || error));
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

  window.reopenGroupReviewUse = async function() {
    try {
      if (!activeMember) return alert("먼저 이름을 선택하고 사용 시작을 누르세요.");
      if (!isSheetCompleted(activeMember)) return alert("이미 수정 가능한 상태입니다.");

      selectedMember = activeMember;
      selectedSheetKey = activeMember;

      await lockSelectedMember(activeMember);

      const sheet = ensureLocalSheet(activeMember);
      sheet.completed = false;
      await persistGroupReviewSheet({ silent: true, keepLock: true, completed: false });

      renderGroupReviewUI();
      alert("재수정 모드로 전환되었습니다.");
    } catch (error) {
      console.error("그룹리뷰 재수정 실패:", error);
      alert("그룹리뷰 재수정 실패: " + (error.message || error));
    }
  };

  window.downloadGroupReviewExcel = function() {
    const project = getSelectedProject();
    if (!project) return alert("다운로드할 그룹리뷰 프로젝트가 없습니다.");
    if (typeof XLSX === "undefined") return alert("엑셀 다운로드 라이브러리를 불러오지 못했습니다.");

    const wb = XLSX.utils.book_new();

    fixedMembers.forEach(member => {
      const sheet = ensureLocalSheet(member);
      const rows = [["확인", "Collateral #", "Sheet", "Field no", "변경 전", "변경 후"]];
      sheet.rows.filter(rowHasValue).forEach(row => {
        rows.push([
          row.checked ? "확인" : "",
          row.collateralNo || "",
          row.sheet || "",
          row.fieldNo || "",
          row.changeBeforeText || "",
          row.changeAfterText || ""
        ]);
      });

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [
        { wch: 8 },
        { wch: 12 },
        { wch: 10 },
        { wch: 8 },
        { wch: 40 },
        { wch: 40 }
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
          <button class="action-btn" onclick="reopenGroupReviewUse()">재수정</button>
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
    const adminMode = isAdmin(getCurrentUser());
    const tabs = fixedMembers.map(member => {
        const active = selectedSheetKey === member;
        const editable = canEditSheet(member);
        const completed = isSheetCompleted(member);
        const suffix = adminMode
          ? (completed ? " · 완료" : "")
          : (completed ? " · 완료" : editable ? " · 입력" : "");
        const disabled = activeMember && !isSheetCompleted(activeMember) && member !== activeMember && !isAdmin(getCurrentUser());
        return `<button class="work-badge review-sheet-btn${active ? " active" : ""}${disabled ? " review-disabled" : ""}" onclick="selectGroupReviewSheet(${jsArg(member)})" ${disabled ? "disabled" : ""}>${escapeHtml(member + suffix)}</button>`;
      }).join("");

    return `<div class="work-badges review-sheet-tabs">${tabs}</div>`;
  }

  function renderAdminReviewControls() {
    const sheetKey = ensureAdminSelectedSheet();
    const currentIndex = getSelectedSheetIndex();
    const progress = getSheetProgress(sheetKey);
    const completed = isSheetCompleted(sheetKey);
    const dirty = dirtySheetKeys.has(sheetKey);
    const prevDisabled = currentIndex <= 0;
    const nextDisabled = currentIndex >= fixedMembers.length - 1;

    return `
      <div class="review-admin-controls">
        <div class="review-admin-summary">
          <strong>관리자 검토</strong>
          <span>${escapeHtml(sheetKey)}</span>
          <span>${currentIndex + 1} / ${fixedMembers.length}</span>
          <span>확인 ${progress.checked} / ${progress.total}</span>
          <span>${completed ? "입력완료" : "입력중"}</span>
          ${dirty ? `<span class="review-admin-dirty">저장 필요</span>` : ""}
        </div>
        <div class="review-admin-actions">
          <button class="action-btn" onclick="moveGroupReviewAdminSheet(-1)" ${prevDisabled ? "disabled" : ""}>이전 사용자</button>
          <button class="action-btn" onclick="moveGroupReviewAdminSheet(1)" ${nextDisabled ? "disabled" : ""}>다음 사용자</button>
          <button class="action-btn" onclick="saveGroupReviewSheet()">확인 저장</button>
          <button class="action-btn" onclick="saveGroupReviewSheetAndMove(1)" ${nextDisabled ? "disabled" : ""}>저장 후 다음</button>
        </div>
      </div>
    `;
  }

  function renderMemberSheet(sheetKey) {
    const sheet = ensureLocalSheet(sheetKey);
    const adminReviewing = isAdminReviewingSheet(sheetKey);
    const editable = canEditSheet(sheetKey) && !adminReviewing;
    const checkable = canCheckSheet(sheetKey);
    const completed = isSheetCompleted(sheetKey);
    const lock = getLockState(sheetKey);

    const buildReviewContentSub = (row, rowIndex, field, placeholder) => `
      <div class="review-content-sub review-content-${field}">
        <div class="review-rich-editor" contenteditable="${editable ? "true" : "false"}"
          role="textbox" aria-multiline="true" data-placeholder="${placeholder}"
          oninput="updateGroupReviewRichText(${rowIndex}, '${field}', this)"
          onpaste="handleGroupReviewTextPaste(event, ${rowIndex}, '${field}', this)">${getReviewTextHtml(row, field)}</div>
      </div>
    `;

    const rowsHtml = sheet.rows.map((row, rowIndex) => {
      return `
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
        <td class="review-content-cell" data-review-content-row="${rowIndex}">
          ${buildReviewContentSub(row, rowIndex, "before", "변경 전 입력")}
          ${buildReviewContentSub(row, rowIndex, "after", "변경 후 입력")}
        </td>
        <td>
          ${editable ? `<button class="small-btn danger" onclick="removeGroupReviewRow(${rowIndex})">삭제</button>` : ""}
        </td>
      </tr>
    `;
    }).join("");

    const lockText = lock.active
      ? lock.own
        ? "현재 내가 선택한 시트입니다."
        : "다른 사용자가 선택한 시트입니다."
      : "현재 사용 중 표시가 없습니다.";
    const statusText = completed
      ? "입력 완료 상태입니다. 입력칸은 잠겼고 확인 체크만 가능합니다."
      : adminReviewing
        ? "관리자 검토 모드입니다. 입력 내용은 읽기 전용이고 확인 체크만 저장됩니다."
        : lockText;
    const saveLabel = adminReviewing ? "관리자 확인 저장" : completed ? "확인 저장" : "임시저장";
    const canReopen = completed && !adminReviewing && checkable;
    const formatToolbar = editable ? `
      <div class="review-text-toolbar review-text-toolbar-inline">
        <span class="review-content-toolbar-hint">변경내용 글자 선택 후 적용</span>
        <select class="review-text-size-select" aria-label="선택한 글자 크기 변경" title="변경내용 칸에서 글자를 선택한 뒤 크기를 고르세요"
          onmousedown="captureGroupReviewSelection()"
          onchange="applyGroupReviewSelectionSize(this.value); this.selectedIndex = 0;">
          ${getReviewTextSizeOptions()}
        </select>
        <button type="button" class="review-format-btn" aria-label="선택한 글자 굵게" title="변경내용 칸에서 글자를 선택한 뒤 눌러 굵게"
          onmousedown="event.preventDefault(); toggleGroupReviewSelectionBold()">B</button>
      </div>
    ` : "";

    return `
      <div class="work-project-header">
        <div>
          <div class="work-project-title">${escapeHtml(sheetKey)}</div>
          <div class="note">${escapeHtml(statusText)} ${sheet.updatedAt ? "마지막 저장: " + escapeHtml(sheet.updatedAt) : ""}</div>
        </div>
      </div>

      <div class="work-header-actions">
        <button class="action-btn" onclick="addGroupReviewRow()" ${editable ? "" : "disabled"}>행 추가</button>
        <button class="action-btn" onclick="saveGroupReviewSheet()" ${checkable ? "" : "disabled"}>${saveLabel}</button>
        ${canReopen ? `<button class="action-btn" onclick="reopenGroupReviewUse()">재수정</button>` : ""}
        ${formatToolbar}
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
              <th>변경내용 전/후</th>
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

    if (isAdmin(getCurrentUser())) {
      ensureAdminSelectedSheet();

      const project = getDisplayProject();
      const projectNote = projectsError
        ? `프로젝트 목록을 불러오지 못했습니다. 저장 시 다시 시도합니다: ${projectsError}`
        : creatingDefaultProject
          ? "프로젝트를 생성하는 중입니다. 입력은 계속할 수 있습니다."
          : !projectsLoaded
            ? "프로젝트 목록을 불러오는 중입니다. 입력은 먼저 볼 수 있습니다."
            : !projects.length
              ? "아직 프로젝트가 없습니다. 리뷰 프로젝트를 먼저 생성하세요."
              : "관리자는 사용자별 입력 내용을 넘겨보며 확인 체크를 저장할 수 있습니다.";

      const sheetContent = renderMemberSheet(selectedSheetKey);

      body.innerHTML = `
        <div class="work-project-header">
          <div>
            <div class="work-project-title">${escapeHtml(project.name)}</div>
            <div class="note">${escapeHtml(projectNote)}</div>
          </div>
        </div>

        ${renderAdminReviewControls()}
        ${renderSheetTabs()}
        ${sheetContent}
      `;
      requestAnimationFrame(fitReviewTextareas);
      return;
    }

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
    requireMemberSelection,
    fitTextareas: fitReviewTextareas
  };
}
