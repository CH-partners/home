import { getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const ADMIN_EMAILS = new Set([
  "admin@admin.com",
  "eastspring1979@gmail.com",
  "sora@jeju.com"
].map(value => value.toLowerCase()));

const STATUS = Object.freeze({
  DRAFT: "draft",
  SUBMITTED: "submitted",
  APPROVED: "approved",
  REVISION_REQUESTED: "revision_requested"
});

const STATUS_SET = new Set(Object.values(STATUS));
const STATUS_LABEL = {
  [STATUS.DRAFT]: "작성중",
  [STATUS.SUBMITTED]: "검토대기",
  [STATUS.APPROVED]: "확인완료",
  [STATUS.REVISION_REQUESTED]: "재수정요청"
};

const ACTIVE_MEMBER_KEY = "groupReviewActiveMember";
const SELECTED_MEMBER_KEY = "groupReviewSelectedMember";

let db = null;
let auth = null;
let installed = false;
let currentProjectId = "";
let refreshTimer = null;
let lastContextKey = "";
let rawSheetCache = new Map();
let projectNameCache = new Map();
const pendingChecks = new Map();
const deletedRowIds = new Map();

function isAdminUser() {
  const email = (auth?.currentUser?.email || "").toLowerCase();
  return ADMIN_EMAILS.has(email);
}

function nowIso() {
  return new Date().toISOString();
}

function makeRowId() {
  return "row_" + Date.now() + "_" + Math.random().toString(36).slice(2);
}

function cleanText(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\n$/, "");
}

function rowHasWorkerValue(row) {
  return [
    row?.collateralNo,
    row?.sheet,
    row?.fieldNo,
    row?.changeBeforeText,
    row?.changeAfterText
  ].some(value => String(value || "").trim() !== "");
}

function rowReadyForSubmission(row) {
  if (String(row?.parentRevisionId || "").trim()) {
    return [row?.changeBeforeText, row?.changeAfterText].some(value => String(value || "").trim() !== "");
  }
  return rowHasWorkerValue(row);
}

function getRowStatus(row) {
  const explicit = String(row?.reviewStatus || "").trim();
  if (STATUS_SET.has(explicit)) return explicit;
  if (row?.checked) return STATUS.APPROVED;
  return rowHasWorkerValue(row) ? STATUS.SUBMITTED : STATUS.DRAFT;
}

function getRevisionNo(row) {
  const value = Number(row?.revisionNo);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function normalizeRawRow(row = {}) {
  const status = getRowStatus(row);
  return {
    ...row,
    id: String(row.id || makeRowId()),
    collateralNo: String(row.collateralNo ?? ""),
    sheet: String(row.sheet ?? ""),
    fieldNo: String(row.fieldNo ?? ""),
    checked: status === STATUS.APPROVED,
    changeBeforeText: String(row.changeBeforeText ?? ""),
    changeBeforeHtml: String(row.changeBeforeHtml ?? ""),
    changeAfterText: String(row.changeAfterText ?? row.changeText ?? ""),
    changeAfterHtml: String(row.changeAfterHtml ?? row.changeTextHtml ?? ""),
    reviewStatus: status,
    revisionNo: getRevisionNo(row),
    parentRevisionId: String(row.parentRevisionId ?? ""),
    submittedAt: String(row.submittedAt ?? ""),
    submittedBy: String(row.submittedBy ?? ""),
    reviewedAt: String(row.reviewedAt ?? ""),
    reviewedByEmail: String(row.reviewedByEmail ?? ""),
    revisionRequestedAt: String(row.revisionRequestedAt ?? ""),
    revisionRequestedByEmail: String(row.revisionRequestedByEmail ?? "")
  };
}

function normalizeSheetData(data = {}) {
  return {
    ...data,
    completed: Boolean(data.completed),
    rows: Array.isArray(data.rows) ? data.rows.map(normalizeRawRow) : []
  };
}

function projectNameFromBadge() {
  const active = document.querySelector("#groupReviewProjectBadges .work-badge.active");
  return (active?.textContent || "").replace(/\s*·\s*완료\s*$/, "").trim();
}

async function resolveProjectId(force = false) {
  if (currentProjectId && !force) return currentProjectId;

  const name = projectNameFromBadge();
  if (!name) return "";
  if (projectNameCache.has(name) && !force) {
    currentProjectId = projectNameCache.get(name) || "";
    return currentProjectId;
  }

  const snap = await getDocs(collection(db, "groupReviewProjects"));
  projectNameCache = new Map();
  snap.forEach(projectDoc => {
    const data = projectDoc.data() || {};
    projectNameCache.set(String(data.name || projectDoc.id), projectDoc.id);
  });

  currentProjectId = projectNameCache.get(name) || "";
  return currentProjectId;
}

function stripSheetSuffix(text) {
  return String(text || "")
    .replace(/\s*·\s*(완료|입력)\s*$/, "")
    .trim();
}

function resolveSheetKey() {
  if (!isAdminUser()) {
    return sessionStorage.getItem(ACTIVE_MEMBER_KEY) || "";
  }

  const activeTab = document.querySelector("#groupReviewBody .review-sheet-btn.active");
  const fromTab = stripSheetSuffix(activeTab?.textContent || "");
  if (fromTab) return fromTab;

  return sessionStorage.getItem(ACTIVE_MEMBER_KEY)
    || sessionStorage.getItem(SELECTED_MEMBER_KEY)
    || "";
}

function contextKey(projectId, sheetKey) {
  return `${projectId}::${sheetKey}`;
}

async function fetchRawSheet(projectId, sheetKey, force = false) {
  if (!projectId || !sheetKey) return normalizeSheetData();
  const key = contextKey(projectId, sheetKey);
  const cached = rawSheetCache.get(key);
  if (!force && cached && Date.now() - cached.loadedAt < 400) {
    return cached.data;
  }

  const snap = await getDoc(doc(db, "groupReviewProjects", projectId, "sheets", sheetKey));
  const data = normalizeSheetData(snap.data() || {});
  rawSheetCache.set(key, { data, loadedAt: Date.now() });
  return data;
}

function invalidateSheet(projectId, sheetKey) {
  rawSheetCache.delete(contextKey(projectId, sheetKey));
}

function deletedSetFor(projectId, sheetKey) {
  const key = contextKey(projectId, sheetKey);
  if (!deletedRowIds.has(key)) deletedRowIds.set(key, new Set());
  return deletedRowIds.get(key);
}

function pendingCheckKey(projectId, sheetKey, rowId) {
  return `${projectId}::${sheetKey}::${rowId}`;
}

function getReviewTableRows() {
  return Array.from(document.querySelectorAll("#groupReviewBody .review-member-table tbody tr"));
}

function mapDomRowsToRaw(projectId, sheetKey, rawSheet) {
  const rows = getReviewTableRows();
  const deleted = deletedSetFor(projectId, sheetKey);
  const available = rawSheet.rows.filter(row => !deleted.has(row.id));
  const rawById = new Map(available.map(row => [row.id, row]));
  const used = new Set();
  let cursor = 0;

  rows.forEach(tr => {
    let rowId = tr.dataset.reviewRowId || "";
    let rawRow = rowId ? rawById.get(rowId) : null;

    if (!rawRow) {
      while (cursor < available.length && used.has(available[cursor].id)) cursor += 1;
      rawRow = available[cursor] || null;
      if (rawRow) {
        rowId = rawRow.id;
        tr.dataset.reviewRowId = rowId;
        used.add(rowId);
        cursor += 1;
      } else {
        delete tr.dataset.reviewRowId;
      }
    } else {
      used.add(rowId);
    }

    tr.__reviewRawRow = rawRow || null;
  });

  return { rows, rawById, used };
}

function styleStateBadge(badge, status) {
  const palette = {
    [STATUS.DRAFT]: ["#f3f4f6", "#4b5563", "#d1d5db"],
    [STATUS.SUBMITTED]: ["#fff7ed", "#c2410c", "#fed7aa"],
    [STATUS.APPROVED]: ["#ecfdf5", "#047857", "#a7f3d0"],
    [STATUS.REVISION_REQUESTED]: ["#fef2f2", "#b91c1c", "#fecaca"]
  };
  const [bg, color, border] = palette[status] || palette[STATUS.DRAFT];
  Object.assign(badge.style, {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 7px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: "700",
    background: bg,
    color,
    border: `1px solid ${border}`,
    marginTop: "4px",
    whiteSpace: "nowrap"
  });
}

function applyRowUi(projectId, sheetKey, rawSheet) {
  const admin = isAdminUser();
  const projectCompleted = document.querySelector("#groupReviewProjectBadges .work-badge.active")?.textContent?.includes("· 완료");
  const { rows } = mapDomRowsToRaw(projectId, sheetKey, rawSheet);

  rows.forEach((tr, rowIndex) => {
    const rawRow = tr.__reviewRawRow;
    const status = rawRow ? getRowStatus(rawRow) : STATUS.DRAFT;

    if (admin && (!rawRow || status === STATUS.DRAFT)) {
      tr.style.display = "none";
      return;
    }
    tr.style.display = "";

    const workerEditable = !admin && !rawSheet.completed && !projectCompleted && (!rawRow || status === STATUS.DRAFT);
    tr.dataset.reviewWorkflowStatus = status;

    tr.querySelectorAll('input[type="text"]').forEach(input => {
      input.readOnly = !workerEditable;
    });

    tr.querySelectorAll(".review-rich-editor").forEach(editor => {
      editor.contentEditable = workerEditable ? "true" : "false";
      editor.setAttribute("aria-readonly", workerEditable ? "false" : "true");
    });

    const checkbox = tr.querySelector('input[type="checkbox"]');
    if (checkbox) {
      const pendingKey = rawRow ? pendingCheckKey(projectId, sheetKey, rawRow.id) : "";
      const pending = pendingKey ? pendingChecks.get(pendingKey) : undefined;
      const canAdminCheck = admin && rawRow && !projectCompleted && [STATUS.SUBMITTED, STATUS.APPROVED].includes(status);
      checkbox.disabled = !canAdminCheck;
      checkbox.checked = pending !== undefined ? Boolean(pending) : status === STATUS.APPROVED;
      tr.classList.toggle("review-row-checked", checkbox.checked);
    }

    const manageCell = tr.lastElementChild;
    if (manageCell) {
      manageCell.querySelectorAll("button").forEach(button => {
        if (button.getAttribute("onclick")?.includes("removeGroupReviewRow")) {
          button.style.display = workerEditable ? "" : "none";
        }
      });

      let stateWrap = manageCell.querySelector(".review-workflow-state");
      if (!stateWrap) {
        stateWrap = document.createElement("div");
        stateWrap.className = "review-workflow-state";
        stateWrap.style.display = "flex";
        stateWrap.style.flexDirection = "column";
        stateWrap.style.alignItems = "flex-start";
        stateWrap.style.gap = "4px";
        manageCell.appendChild(stateWrap);
      }

      let badge = stateWrap.querySelector(".review-workflow-badge");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "review-workflow-badge";
        stateWrap.appendChild(badge);
      }
      const badgeText = rawRow ? `${STATUS_LABEL[status]} · v${getRevisionNo(rawRow)}` : "작성중";
      if (badge.textContent !== badgeText) badge.textContent = badgeText;
      styleStateBadge(badge, status);

      const canRequestRevision = admin && rawRow && !projectCompleted && [STATUS.SUBMITTED, STATUS.APPROVED].includes(status);
      let reviseButton = stateWrap.querySelector(".review-workflow-revise");
      if (canRequestRevision && !reviseButton) {
        reviseButton = document.createElement("button");
        reviseButton.type = "button";
        reviseButton.className = "small-btn danger review-workflow-revise";
        reviseButton.textContent = "재수정 요청";
        stateWrap.appendChild(reviseButton);
      }
      if (reviseButton) {
        if (canRequestRevision) {
          reviseButton.style.display = "";
          reviseButton.onclick = () => window.requestGroupReviewRevision(rawRow.id);
        } else {
          reviseButton.style.display = "none";
          reviseButton.onclick = null;
        }
      }
    }

    tr.dataset.reviewRowIndex = String(rowIndex);
  });
}

function applyToolbarUi(rawSheet) {
  const admin = isAdminUser();
  const topSave = document.querySelector('.sheet-panel[data-index="13"] .work-toolbar button[onclick="saveGroupReviewSheet()"]');
  if (topSave) {
    const label = admin ? "확인 저장" : "임시저장(검토요청)";
    if (topSave.textContent !== label) topSave.textContent = label;
  }

  const body = document.getElementById("groupReviewBody");
  if (!body) return;

  body.querySelectorAll(".review-admin-dirty").forEach(el => {
    el.style.display = "none";
  });

  if (!admin) {
    body.querySelectorAll('button[onclick="reopenGroupReviewUse()"]').forEach(button => {
      button.style.display = "none";
    });

    const sheetSave = body.querySelector('.review-member-table')
      ?.closest(".work-table-wrap")
      ?.previousElementSibling
      ?.querySelector('button[onclick="saveGroupReviewSheet()"]');
    if (sheetSave) {
      const label = rawSheet.completed ? "관리자 검토 대기" : "임시저장(검토요청)";
      if (sheetSave.textContent !== label) sheetSave.textContent = label;
      sheetSave.disabled = Boolean(rawSheet.completed);
    }

    if (rawSheet.completed) {
      body.querySelectorAll(".review-use-controls button").forEach(button => {
        button.style.display = "none";
      });
    }
  }
}

async function refreshWorkflowUi(force = false) {
  if (!installed || !db) return;
  try {
    const projectId = await resolveProjectId(force);
    const sheetKey = resolveSheetKey();
    if (!projectId || !sheetKey) return;
    const key = contextKey(projectId, sheetKey);
    lastContextKey = key;
    const rawSheet = await fetchRawSheet(projectId, sheetKey, force);
    if (lastContextKey !== key) return;
    applyRowUi(projectId, sheetKey, rawSheet);
    applyToolbarUi(rawSheet);
  } catch (error) {
    console.warn("그룹리뷰 검토 잠금 UI 갱신 실패:", error);
  }
}

function scheduleWorkflowRefresh(force = false) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshWorkflowUi(force);
  }, 80);
}

function readDomRow(tr, rawRow = null) {
  const textInputs = Array.from(tr.querySelectorAll('input[type="text"]'));
  const beforeEditor = tr.querySelector(".review-content-before .review-rich-editor");
  const afterEditor = tr.querySelector(".review-content-after .review-rich-editor");

  const beforeText = cleanText(beforeEditor?.innerText || beforeEditor?.textContent || "");
  const afterText = cleanText(afterEditor?.innerText || afterEditor?.textContent || "");

  return normalizeRawRow({
    ...(rawRow || {}),
    id: tr.dataset.reviewRowId || rawRow?.id || makeRowId(),
    collateralNo: textInputs[0]?.value || "",
    sheet: textInputs[1]?.value || "",
    fieldNo: textInputs[2]?.value || "",
    changeBeforeText: beforeText,
    changeBeforeHtml: beforeEditor?.innerHTML || "",
    changeAfterText: afterText,
    changeAfterHtml: afterEditor?.innerHTML || "",
    reviewStatus: rawRow ? getRowStatus(rawRow) : STATUS.DRAFT,
    checked: rawRow ? getRowStatus(rawRow) === STATUS.APPROVED : false
  });
}

async function persistWorkerSubmission() {
  const projectId = await resolveProjectId(true);
  const sheetKey = resolveSheetKey();
  if (!projectId || !sheetKey) throw new Error("사용 중인 그룹리뷰 시트를 찾을 수 없습니다.");
  if (isAdminUser()) throw new Error("관리자 검토 화면에서는 작업자 임시저장을 사용할 수 없습니다.");

  const activeMember = sessionStorage.getItem(ACTIVE_MEMBER_KEY) || "";
  if (!activeMember || activeMember !== sheetKey) {
    throw new Error("이름을 선택하고 사용 시작 후 임시저장하세요.");
  }

  const localRaw = await fetchRawSheet(projectId, sheetKey, true);
  const deleted = deletedSetFor(projectId, sheetKey);
  const rows = getReviewTableRows();
  const serverById = new Map(localRaw.rows.map(row => [row.id, row]));
  const usedServerIds = new Set();
  const nextRows = [];
  const submitTime = nowIso();
  const submitter = activeMember;
  let submittedCount = 0;

  rows.forEach(tr => {
    const rowId = tr.dataset.reviewRowId || "";
    const serverRow = rowId ? serverById.get(rowId) : null;
    if (serverRow) usedServerIds.add(serverRow.id);
    if (serverRow && deleted.has(serverRow.id)) return;

    const status = serverRow ? getRowStatus(serverRow) : STATUS.DRAFT;
    if (serverRow && status !== STATUS.DRAFT) {
      nextRows.push(serverRow);
      return;
    }

    const draft = readDomRow(tr, serverRow);
    if (!rowReadyForSubmission(draft)) {
      if (serverRow) nextRows.push({ ...draft, reviewStatus: STATUS.DRAFT, checked: false });
      return;
    }

    submittedCount += 1;
    nextRows.push({
      ...draft,
      reviewStatus: STATUS.SUBMITTED,
      checked: false,
      submittedAt: submitTime,
      submittedBy: submitter,
      reviewedAt: "",
      reviewedByEmail: "",
      revisionRequestedAt: "",
      revisionRequestedByEmail: ""
    });
  });

  localRaw.rows.forEach(serverRow => {
    if (usedServerIds.has(serverRow.id) || deleted.has(serverRow.id)) return;
    nextRows.push(serverRow);
  });

  if (!submittedCount && !deleted.size) {
    throw new Error("검토 요청할 작성 내용이 없습니다.");
  }

  await runTransaction(db, async transaction => {
    const projectRef = doc(db, "groupReviewProjects", projectId);
    const sheetRef = doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
    const projectSnap = await transaction.get(projectRef);
    if (projectSnap.data()?.completed) throw new Error("프로젝트 완료 상태입니다.");

    const serverSnap = await transaction.get(sheetRef);
    const serverSheet = normalizeSheetData(serverSnap.data() || {});
    const latestById = new Map(serverSheet.rows.map(row => [row.id, row]));

    const protectedRows = nextRows.map(row => {
      const latest = latestById.get(row.id);
      if (latest && getRowStatus(latest) !== STATUS.DRAFT) return latest;
      return row;
    });

    const protectedIds = new Set(protectedRows.map(row => row.id));
    serverSheet.rows.forEach(row => {
      if (!protectedIds.has(row.id) && !deleted.has(row.id)) protectedRows.push(row);
    });

    transaction.set(sheetRef, {
      type: "member",
      memberName: sheetKey,
      rows: protectedRows,
      completed: false,
      updatedAt: submitTime,
      updatedBy: submitter,
      updatedByEmail: auth.currentUser?.email || "",
      lockSessionId: localRaw.lockSessionId || "",
      lockedBy: localRaw.lockedBy || submitter,
      lockedAt: submitTime
    }, { merge: true });
  });

  deleted.clear();
  invalidateSheet(projectId, sheetKey);
  await refreshWorkflowUi(true);
  alert(`${submittedCount}건을 임시저장했습니다. 관리자 검토 대상으로 제출되어 해당 행은 잠깁니다.`);
}

async function persistAdminChecks() {
  if (!isAdminUser()) throw new Error("관리자만 확인 상태를 저장할 수 있습니다.");
  const projectId = await resolveProjectId(true);
  const sheetKey = resolveSheetKey();
  if (!projectId || !sheetKey) throw new Error("검토 중인 시트를 찾을 수 없습니다.");

  const relevant = Array.from(pendingChecks.entries()).filter(([key]) => key.startsWith(`${projectId}::${sheetKey}::`));
  if (!relevant.length) throw new Error("저장할 확인 변경이 없습니다.");
  const decisionMap = new Map(relevant.map(([key, value]) => [key.split("::").pop(), Boolean(value)]));
  const decisionTime = nowIso();
  const reviewer = auth.currentUser?.email || "";
  let nextRows = [];

  await runTransaction(db, async transaction => {
    const projectRef = doc(db, "groupReviewProjects", projectId);
    const sheetRef = doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
    const projectSnap = await transaction.get(projectRef);
    if (projectSnap.data()?.completed) throw new Error("프로젝트 완료 상태입니다.");

    const sheetSnap = await transaction.get(sheetRef);
    const serverSheet = normalizeSheetData(sheetSnap.data() || {});

    nextRows = serverSheet.rows.map(row => {
      const status = getRowStatus(row);
      if (![STATUS.SUBMITTED, STATUS.APPROVED].includes(status) || !decisionMap.has(row.id)) return row;
      const checked = decisionMap.get(row.id);
      return {
        ...row,
        checked,
        reviewStatus: checked ? STATUS.APPROVED : STATUS.SUBMITTED,
        reviewedAt: checked ? decisionTime : "",
        reviewedByEmail: checked ? reviewer : ""
      };
    });

    transaction.set(sheetRef, {
      rows: nextRows,
      updatedAt: decisionTime,
      updatedByEmail: reviewer
    }, { merge: true });
  });

  relevant.forEach(([key]) => pendingChecks.delete(key));
  invalidateSheet(projectId, sheetKey);
  await refreshWorkflowUi(true);
  alert(`${sheetKey} 관리자 확인 상태가 저장되었습니다.`);
}

function unresolvedRevisionRows(rows) {
  return rows.filter(row => {
    if (getRowStatus(row) !== STATUS.REVISION_REQUESTED) return false;
    return !rows.some(child =>
      child.parentRevisionId === row.id && getRowStatus(child) !== STATUS.DRAFT
    );
  });
}

async function completeWorkerSheet() {
  if (isAdminUser()) throw new Error("관리자 검토 화면에서는 작업자 완료를 사용할 수 없습니다.");
  const projectId = await resolveProjectId(true);
  const sheetKey = resolveSheetKey();
  const activeMember = sessionStorage.getItem(ACTIVE_MEMBER_KEY) || "";
  if (!projectId || !sheetKey || !activeMember || activeMember !== sheetKey) {
    throw new Error("사용 중인 이름이 없습니다.");
  }

  const rawSheet = await fetchRawSheet(projectId, sheetKey, true);
  const rawById = new Map(rawSheet.rows.map(row => [row.id, row]));
  const hasUnsavedDraft = getReviewTableRows().some(tr => {
    const rowId = tr.dataset.reviewRowId || "";
    const rawRow = rowId ? rawById.get(rowId) : null;
    if (rawRow && getRowStatus(rawRow) !== STATUS.DRAFT) return false;
    return rowReadyForSubmission(readDomRow(tr, rawRow));
  });

  if (hasUnsavedDraft) {
    throw new Error("작성 중인 내용이 있습니다. 먼저 임시저장(검토요청)한 뒤 완료하세요.");
  }

  if (unresolvedRevisionRows(rawSheet.rows).length) {
    throw new Error("관리자가 재수정 요청한 항목이 남아 있습니다. 새 작성행에 다시 입력하고 임시저장하세요.");
  }

  const completedAt = nowIso();
  await runTransaction(db, async transaction => {
    const projectRef = doc(db, "groupReviewProjects", projectId);
    const sheetRef = doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
    const projectSnap = await transaction.get(projectRef);
    if (projectSnap.data()?.completed) throw new Error("프로젝트 완료 상태입니다.");

    const sheetSnap = await transaction.get(sheetRef);
    const latest = normalizeSheetData(sheetSnap.data() || {});
    if (unresolvedRevisionRows(latest.rows).length) {
      throw new Error("관리자가 재수정 요청한 항목이 남아 있습니다.");
    }

    transaction.set(sheetRef, {
      completed: true,
      lockSessionId: "",
      lockedBy: "",
      lockedAt: "",
      updatedAt: completedAt,
      updatedBy: activeMember,
      updatedByEmail: auth.currentUser?.email || ""
    }, { merge: true });
  });

  invalidateSheet(projectId, sheetKey);
  await refreshWorkflowUi(true);
  alert("입력 완료되었습니다. 제출된 행은 그대로 잠기며 관리자가 검토합니다.");
}

async function requestRevision(rowId) {
  if (!isAdminUser()) throw new Error("관리자만 재수정 요청을 할 수 있습니다.");
  const projectId = await resolveProjectId(true);
  const sheetKey = resolveSheetKey();
  if (!projectId || !sheetKey || !rowId) throw new Error("재수정 요청 대상을 찾을 수 없습니다.");

  const requestTime = nowIso();
  const reviewer = auth.currentUser?.email || "";
  let created = false;

  await runTransaction(db, async transaction => {
    const projectRef = doc(db, "groupReviewProjects", projectId);
    const sheetRef = doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
    const projectSnap = await transaction.get(projectRef);
    if (projectSnap.data()?.completed) throw new Error("프로젝트 완료 상태입니다. 먼저 프로젝트 재수정으로 전환하세요.");

    const sheetSnap = await transaction.get(sheetRef);
    const serverSheet = normalizeSheetData(sheetSnap.data() || {});
    const index = serverSheet.rows.findIndex(row => row.id === rowId);
    if (index < 0) throw new Error("대상 행이 서버에 없습니다.");

    const target = serverSheet.rows[index];
    const status = getRowStatus(target);
    if (![STATUS.SUBMITTED, STATUS.APPROVED].includes(status)) {
      throw new Error("검토대기 또는 확인완료 행만 재수정 요청할 수 있습니다.");
    }

    const nextRows = [...serverSheet.rows];
    nextRows[index] = {
      ...target,
      checked: false,
      reviewStatus: STATUS.REVISION_REQUESTED,
      revisionRequestedAt: requestTime,
      revisionRequestedByEmail: reviewer
    };

    const existingDraft = nextRows.find(row =>
      row.parentRevisionId === target.id && getRowStatus(row) === STATUS.DRAFT
    );

    if (!existingDraft) {
      nextRows.push(normalizeRawRow({
        id: makeRowId(),
        collateralNo: target.collateralNo || "",
        sheet: target.sheet || "",
        fieldNo: target.fieldNo || "",
        checked: false,
        changeBeforeText: "",
        changeBeforeHtml: "",
        changeAfterText: "",
        changeAfterHtml: "",
        reviewStatus: STATUS.DRAFT,
        revisionNo: getRevisionNo(target) + 1,
        parentRevisionId: target.id,
        submittedAt: "",
        submittedBy: "",
        reviewedAt: "",
        reviewedByEmail: "",
        revisionRequestedAt: "",
        revisionRequestedByEmail: ""
      }));
      created = true;
    }

    transaction.set(sheetRef, {
      rows: nextRows,
      completed: false,
      updatedAt: requestTime,
      updatedByEmail: reviewer
    }, { merge: true });
  });

  invalidateSheet(projectId, sheetKey);
  await refreshWorkflowUi(true);
  alert(created
    ? "재수정 요청했습니다. 기존 행은 잠긴 상태로 보존되고 작업자용 새 작성행이 생성되었습니다."
    : "이미 재수정용 작성행이 있어 재수정 요청 상태만 갱신했습니다.");
}

function installFunctionOverrides() {
  const originalSelectProject = window.selectGroupReviewProject;
  if (typeof originalSelectProject === "function") {
    window.selectGroupReviewProject = function(projectId) {
      currentProjectId = String(projectId || "");
      const result = originalSelectProject.apply(this, arguments);
      scheduleWorkflowRefresh(true);
      return result;
    };
  }

  const originalSelectSheet = window.selectGroupReviewSheet;
  if (typeof originalSelectSheet === "function") {
    window.selectGroupReviewSheet = function() {
      const result = originalSelectSheet.apply(this, arguments);
      scheduleWorkflowRefresh(true);
      return result;
    };
  }

  const originalSelectMember = window.selectGroupReviewMember;
  if (typeof originalSelectMember === "function") {
    window.selectGroupReviewMember = async function() {
      const result = await originalSelectMember.apply(this, arguments);
      scheduleWorkflowRefresh(true);
      return result;
    };
  }

  const originalStartUse = window.startGroupReviewUse;
  if (typeof originalStartUse === "function") {
    window.startGroupReviewUse = async function() {
      try {
        if (!isAdminUser()) {
          const projectId = await resolveProjectId(true);
          const member = sessionStorage.getItem(SELECTED_MEMBER_KEY) || "";
          if (projectId && member) {
            const sheet = await fetchRawSheet(projectId, member, true);
            if (sheet.completed) {
              alert("관리자 검토 중입니다. 관리자가 재수정 요청하기 전에는 다시 입력할 수 없습니다.");
              return;
            }
          }
        }
        const result = await originalStartUse.apply(this, arguments);
        scheduleWorkflowRefresh(true);
        return result;
      } catch (error) {
        alert("그룹리뷰 사용 시작 실패: " + (error.message || error));
      }
    };
  }

  const originalUpdateCell = window.updateGroupReviewCell;
  if (typeof originalUpdateCell === "function") {
    window.updateGroupReviewCell = function(rowIndex, field, value) {
      const tr = getReviewTableRows()[Number(rowIndex)];
      const rawRow = tr?.__reviewRawRow || null;
      const status = rawRow ? getRowStatus(rawRow) : STATUS.DRAFT;

      if (field === "checked") {
        if (!isAdminUser() || !rawRow || ![STATUS.SUBMITTED, STATUS.APPROVED].includes(status)) return;
        pendingChecks.set(
          pendingCheckKey(currentProjectId, resolveSheetKey(), rawRow.id),
          Boolean(value)
        );
        return originalUpdateCell.call(this, rowIndex, field, value);
      }

      if (isAdminUser() || (rawRow && status !== STATUS.DRAFT)) return;
      return originalUpdateCell.call(this, rowIndex, field, value);
    };
  }

  const originalUpdateRich = window.updateGroupReviewRichText;
  if (typeof originalUpdateRich === "function") {
    window.updateGroupReviewRichText = function(rowIndex) {
      const tr = getReviewTableRows()[Number(rowIndex)];
      const rawRow = tr?.__reviewRawRow || null;
      if (isAdminUser() || (rawRow && getRowStatus(rawRow) !== STATUS.DRAFT)) return;
      return originalUpdateRich.apply(this, arguments);
    };
  }

  const originalPaste = window.handleGroupReviewTextPaste;
  if (typeof originalPaste === "function") {
    window.handleGroupReviewTextPaste = function(event, rowIndex) {
      const tr = getReviewTableRows()[Number(rowIndex)];
      const rawRow = tr?.__reviewRawRow || null;
      if (isAdminUser() || (rawRow && getRowStatus(rawRow) !== STATUS.DRAFT)) {
        event?.preventDefault?.();
        return;
      }
      return originalPaste.apply(this, arguments);
    };
  }

  const originalRemoveRow = window.removeGroupReviewRow;
  if (typeof originalRemoveRow === "function") {
    window.removeGroupReviewRow = function(rowIndex) {
      const tr = getReviewTableRows()[Number(rowIndex)];
      const rawRow = tr?.__reviewRawRow || null;
      if (isAdminUser() || (rawRow && getRowStatus(rawRow) !== STATUS.DRAFT)) {
        alert("임시저장된 행은 삭제할 수 없습니다.");
        return;
      }
      if (rawRow?.id && currentProjectId) {
        deletedSetFor(currentProjectId, resolveSheetKey()).add(rawRow.id);
      }
      const result = originalRemoveRow.apply(this, arguments);
      scheduleWorkflowRefresh();
      return result;
    };
  }

  const originalAddRow = window.addGroupReviewRow;
  if (typeof originalAddRow === "function") {
    window.addGroupReviewRow = function() {
      if (isAdminUser()) return alert("관리자는 작업자 작성행을 추가할 수 없습니다.");
      const result = originalAddRow.apply(this, arguments);
      scheduleWorkflowRefresh();
      return result;
    };
  }

  window.saveGroupReviewSheet = async function() {
    try {
      if (isAdminUser()) await persistAdminChecks();
      else await persistWorkerSubmission();
    } catch (error) {
      console.error("그룹리뷰 저장 실패:", error);
      alert("그룹리뷰 저장 실패: " + (error.message || error));
    }
  };

  window.saveGroupReviewSheetAndMove = async function(direction = 1) {
    try {
      if (!isAdminUser()) return;
      await persistAdminChecks();
      window.moveGroupReviewAdminSheet?.(direction);
      scheduleWorkflowRefresh(true);
    } catch (error) {
      console.error("그룹리뷰 확인 저장 후 이동 실패:", error);
      alert("그룹리뷰 확인 저장 후 이동 실패: " + (error.message || error));
    }
  };

  window.completeGroupReviewUse = async function() {
    try {
      await completeWorkerSheet();
    } catch (error) {
      console.error("그룹리뷰 완료 실패:", error);
      alert("그룹리뷰 완료 실패: " + (error.message || error));
    }
  };

  window.reopenGroupReviewUse = function() {
    alert("재수정은 관리자가 해당 행에서 '재수정 요청'을 해야 합니다. 기존 제출행은 수정하지 않고 새 작성행에서 다시 입력합니다.");
  };

  window.requestGroupReviewRevision = async function(rowId) {
    try {
      await requestRevision(rowId);
    } catch (error) {
      console.error("그룹리뷰 재수정 요청 실패:", error);
      alert("그룹리뷰 재수정 요청 실패: " + (error.message || error));
    }
  };
}

function installObservers() {
  const body = document.getElementById("groupReviewBody");
  const badges = document.getElementById("groupReviewProjectBadges");
  const observer = new MutationObserver(() => scheduleWorkflowRefresh());
  if (body) observer.observe(body, { childList: true, subtree: true });
  if (badges) observer.observe(badges, { childList: true, subtree: true });

  if (auth) {
    onAuthStateChanged(auth, () => {
      currentProjectId = "";
      projectNameCache.clear();
      rawSheetCache.clear();
      pendingChecks.clear();
      scheduleWorkflowRefresh(true);
    });
  }
}

function tryInstall() {
  if (installed) return;
  const apps = getApps();
  if (!apps.length || !window.groupReviewApi || typeof window.saveGroupReviewSheet !== "function") {
    setTimeout(tryInstall, 100);
    return;
  }

  db = getFirestore(apps[0]);
  auth = getAuth(apps[0]);
  installed = true;
  installFunctionOverrides();
  installObservers();
  scheduleWorkflowRefresh(true);
}

tryInstall();
