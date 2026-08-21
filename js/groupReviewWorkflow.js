import { getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
// 이 모듈은 더 이상 Firestore를 읽지 않는다. 상태는 groupReviewRuntime에서 받고 쓰기만 직접 한다.
import {
  doc,
  getFirestore,
  runTransaction,
  writeBatch
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
  [STATUS.APPROVED]: "완료",
  [STATUS.REVISION_REQUESTED]: "재수정요청"
};

const ACTIVE_MEMBER_KEY = "groupReviewActiveMember";
const SELECTED_MEMBER_KEY = "groupReviewSelectedMember";

let db = null;
let auth = null;
let installed = false;
let currentProjectId = "";
let refreshTimer = null;
let suppressObserver = false;
let originalAddRow = null;
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
    reviewCompleted: Boolean(data.reviewCompleted),
    reviewCompletedAt: String(data.reviewCompletedAt ?? ""),
    reviewCompletedByEmail: String(data.reviewCompletedByEmail ?? ""),
    rows: Array.isArray(data.rows) ? data.rows.map(normalizeRawRow) : []
  };
}

function runtime() {
  return window.groupReviewRuntime || null;
}

// Original의 onSnapshot이 이미 프로젝트 목록을 들고 있으므로 여기서 다시 조회하지 않는다.
function resolveProjectId() {
  currentProjectId = runtime()?.getSelectedProjectId() || "";
  return currentProjectId;
}

function stripSheetSuffix(text) {
  return String(text || "")
    .replace(/\s*·\s*(완료|입력|리뷰완료)\s*$/, "")
    .trim();
}

function activeMemberKey() {
  return sessionStorage.getItem(ACTIVE_MEMBER_KEY) || "";
}

function resolveSheetKey() {
  const activeTab = document.querySelector("#groupReviewBody .review-sheet-btn.active");
  const fromTab = stripSheetSuffix(activeTab?.textContent || "");
  if (fromTab) return fromTab;

  return activeMemberKey()
    || sessionStorage.getItem(SELECTED_MEMBER_KEY)
    || "";
}

function isOwnSheet(sheetKey) {
  return Boolean(sheetKey) && sheetKey === activeMemberKey();
}

// 사용 시작 전에는 아직 점유한 시트가 없으므로 "다른 사람 시트 열람"이 아니라 이름 선택 단계다.
// 이때까지 열람 모드로 보면 사용 시작 버튼까지 숨겨진다.
function isViewingOtherSheet(sheetKey) {
  return Boolean(activeMemberKey()) && !isOwnSheet(sheetKey);
}

function contextKey(projectId, sheetKey) {
  return `${projectId}::${sheetKey}`;
}

// Firestore를 읽지 않고 Original이 onSnapshot으로 받아둔 시트를 그대로 쓴다.
// Firestore는 로컬 쓰기를 즉시 스냅샷으로 반영하므로 저장 직후에도 최신 상태다.
function fetchRawSheet(projectId, sheetKey) {
  if (!projectId || !sheetKey) return normalizeSheetData();
  return normalizeSheetData(runtime()?.getSheet(sheetKey) || {});
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

function captureScrollState() {
  const tableWrap = document.querySelector("#groupReviewBody .work-table-wrap");
  const sidebar = document.querySelector(".sidebar");
  const sidebarContent = document.querySelector(".sidebar-content");
  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    tableTop: tableWrap?.scrollTop || 0,
    tableLeft: tableWrap?.scrollLeft || 0,
    sidebarTop: sidebar?.scrollTop || 0,
    sidebarContentTop: sidebarContent?.scrollTop || 0
  };
}

function restoreScrollState(state) {
  if (!state) return;
  const apply = () => {
    const tableWrap = document.querySelector("#groupReviewBody .work-table-wrap");
    if (tableWrap) {
      tableWrap.scrollTop = state.tableTop;
      tableWrap.scrollLeft = state.tableLeft;
    }
    const sidebar = document.querySelector(".sidebar");
    if (sidebar) sidebar.scrollTop = state.sidebarTop;
    const sidebarContent = document.querySelector(".sidebar-content");
    if (sidebarContent) sidebarContent.scrollTop = state.sidebarContentTop;
    window.scrollTo(state.windowX, state.windowY);
  };
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
}

async function withScrollPreserved(action) {
  const state = captureScrollState();
  try {
    return await action();
  } finally {
    restoreScrollState(state);
  }
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
  const own = !admin && isOwnSheet(sheetKey);
  const { rows } = mapDomRowsToRaw(projectId, sheetKey, rawSheet);

  rows.forEach((tr, rowIndex) => {
    const rawRow = tr.__reviewRawRow;
    const status = rawRow ? getRowStatus(rawRow) : STATUS.DRAFT;

    if (admin && (!rawRow || status === STATUS.DRAFT)) {
      tr.style.display = "none";
      return;
    }
    tr.style.display = "";

    const workerEditable = own && !rawSheet.completed && !projectCompleted && (!rawRow || status === STATUS.DRAFT);
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
      const canAdminCheck = admin && rawRow && !projectCompleted && !rawSheet.reviewCompleted && [STATUS.SUBMITTED, STATUS.APPROVED].includes(status);
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

      const canRequestRevision = admin && rawRow && !projectCompleted && !rawSheet.reviewCompleted && [STATUS.SUBMITTED, STATUS.APPROVED].includes(status);
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

function applyViewOnlyNotice(body, viewingOther, sheetKey) {
  let notice = body.querySelector(".review-view-only-notice");
  if (!viewingOther) {
    notice?.remove();
    return;
  }

  const header = body.querySelector(".work-project-header");
  if (!header) return;

  if (!notice) {
    notice = document.createElement("div");
    notice.className = "note review-view-only-notice";
    notice.style.fontWeight = "700";
    notice.style.marginTop = "4px";
    header.appendChild(notice);
  }

  const text = `${sheetKey} 시트를 열람 중입니다. 다른 작업자의 시트는 읽기 전용입니다.`;
  if (notice.textContent !== text) notice.textContent = text;
}

function applyToolbarUi(sheetKey, rawSheet) {
  const admin = isAdminUser();
  const body = document.getElementById("groupReviewBody");
  if (!body) return;

  const viewingOther = !admin && isViewingOtherSheet(sheetKey);
  const workerLocked = viewingOther || Boolean(rawSheet.completed);

  body.querySelectorAll('button[onclick="completeGroupReviewUse()"]').forEach(button => {
    if (button.textContent !== "입력 완료") button.textContent = "입력 완료";
    button.disabled = admin ? Boolean(rawSheet.completed) : workerLocked;
    if (!admin && viewingOther) button.style.display = "none";
  });

  body.querySelectorAll(".review-admin-dirty").forEach(el => {
    el.style.display = "none";
  });

  // 작업자 라벨은 "수정요청"으로 통일한다. 레이어마다 다른 문구를 쓰면 전환할 때 옛 문구가 잠깐 스친다.
  const saveLabel = admin ? "확인 저장" : "수정요청";
  const sheetSaveButtons = body.querySelectorAll('.work-header-actions button[onclick="saveGroupReviewSheet()"]');
  sheetSaveButtons.forEach(button => {
    if (button.textContent !== saveLabel) button.textContent = saveLabel;
    button.disabled = admin ? Boolean(rawSheet.reviewCompleted) : workerLocked;
    if (!admin && viewingOther) button.style.display = "none";
  });

  if (!admin) {
    body.querySelectorAll('button[onclick="reopenGroupReviewUse()"]')
      .forEach(button => {
        button.style.display = "none";
      });

    body.querySelectorAll('button[onclick="addGroupReviewRow()"]').forEach(button => {
      button.disabled = workerLocked;
      button.style.display = viewingOther ? "none" : "";
    });

    // 사용 시작 전 화면의 유일한 버튼이 "사용 시작"이므로, 활성 이름이 있을 때만 정리한다.
    if (activeMemberKey() && (rawSheet.completed || viewingOther)) {
      body.querySelectorAll(".review-use-controls button").forEach(button => {
        // 재사용 요청 버튼은 입력 완료 상태에서만 노출되는 버튼이라 숨기지 않는다.
        if (button.classList.contains("review-worker-reuse-request")) return;
        button.style.display = "none";
      });
    }

    body.querySelectorAll(".review-use-controls span").forEach(span => {
      if (span.textContent.includes("완료를 눌러")) {
        span.innerHTML = span.innerHTML.replace("완료를 눌러", "입력 완료를 눌러");
      }
      // 입력 완료 상태 안내 문구는 재사용 요청 상태까지 아는 groupReviewFinalUi.js가 담당한다.
    });

    applyViewOnlyNotice(body, viewingOther, sheetKey);
  }

  const adminActions = body.querySelector(".review-admin-actions");
  if (admin && adminActions) {
    adminActions.querySelectorAll(".review-complete-action").forEach(el => el.remove());
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-btn review-complete-action";
    if (rawSheet.reviewCompleted) {
      button.textContent = "리뷰 재개";
      button.onclick = () => window.reopenGroupReviewReview();
    } else {
      button.textContent = "리뷰 완료";
      button.onclick = () => window.completeGroupReviewReview();
    }
    adminActions.appendChild(button);

    const saveButtons = adminActions.querySelectorAll('button[onclick="saveGroupReviewSheet()"], button[onclick="saveGroupReviewSheetAndMove(1)"]');
    saveButtons.forEach(btn => {
      if (rawSheet.reviewCompleted) btn.disabled = true;
    });

    const summary = body.querySelector(".review-admin-summary");
    if (summary) {
      let status = summary.querySelector(".review-complete-summary");
      if (!status) {
        status = document.createElement("span");
        status.className = "review-complete-summary";
        summary.appendChild(status);
      }
      status.textContent = rawSheet.reviewCompleted ? "리뷰완료" : "리뷰중";
    }
  }
}

// Firestore 조회가 사라져 동기 함수가 되었다. 렌더 직후 같은 태스크에서 패치를 끝낸다.
function refreshWorkflowUi() {
  if (!installed || !db) return;
  try {
    const projectId = resolveProjectId();
    const sheetKey = resolveSheetKey();
    if (!projectId || !sheetKey) return;
    const rawSheet = fetchRawSheet(projectId, sheetKey);
    suppressObserver = true;
    try {
      applyRowUi(projectId, sheetKey, rawSheet);
      applyToolbarUi(sheetKey, rawSheet);
    } finally {
      suppressObserver = false;
    }
  } catch (error) {
    console.warn("그룹리뷰 검토 잠금 UI 갱신 실패:", error);
  }
}

function scheduleWorkflowRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshWorkflowUi();
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
  const projectId = resolveProjectId();
  const sheetKey = resolveSheetKey();
  if (!projectId || !sheetKey) throw new Error("사용 중인 그룹리뷰 시트를 찾을 수 없습니다.");
  if (isAdminUser()) throw new Error("관리자 검토 화면에서는 작업자 임시저장을 사용할 수 없습니다.");

  const activeMember = activeMemberKey();
  if (!activeMember) throw new Error("이름을 선택하고 사용 시작 후 저장하세요.");
  if (activeMember !== sheetKey) {
    throw new Error(`${sheetKey} 시트는 열람 전용입니다. 본인(${activeMember}) 시트 탭에서 저장하세요.`);
  }

  const localRaw = fetchRawSheet(projectId, sheetKey);
  const deleted = deletedSetFor(projectId, sheetKey);
  const rows = getReviewTableRows();
  const serverById = new Map(localRaw.rows.map(row => [row.id, row]));
  const usedServerIds = new Set();
  const localCandidates = [];
  const submitTime = nowIso();
  let submittedCount = 0;

  rows.forEach(tr => {
    const rowId = tr.dataset.reviewRowId || "";
    const serverRow = rowId ? serverById.get(rowId) : null;
    if (serverRow) usedServerIds.add(serverRow.id);
    if (serverRow && deleted.has(serverRow.id)) return;

    const status = serverRow ? getRowStatus(serverRow) : STATUS.DRAFT;
    if (serverRow && status !== STATUS.DRAFT) {
      localCandidates.push(serverRow);
      return;
    }

    const draft = readDomRow(tr, serverRow);
    if (!rowReadyForSubmission(draft)) {
      if (serverRow) localCandidates.push({ ...draft, reviewStatus: STATUS.DRAFT, checked: false });
      return;
    }

    submittedCount += 1;
    localCandidates.push({
      ...draft,
      reviewStatus: STATUS.SUBMITTED,
      checked: false,
      submittedAt: submitTime,
      submittedBy: activeMember,
      reviewedAt: "",
      reviewedByEmail: "",
      revisionRequestedAt: "",
      revisionRequestedByEmail: ""
    });
  });

  localRaw.rows.forEach(serverRow => {
    if (usedServerIds.has(serverRow.id) || deleted.has(serverRow.id)) return;
    localCandidates.push(serverRow);
  });

  if (!submittedCount && !deleted.size) {
    throw new Error("검토 요청할 작성 내용이 없습니다.");
  }

  let committedSheet = null;
  await runTransaction(db, async transaction => {
    const sheetRef = doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
    const serverSnap = await transaction.get(sheetRef);
    const serverSheet = normalizeSheetData(serverSnap.data() || {});
    const latestById = new Map(serverSheet.rows.map(row => [row.id, row]));

    const protectedRows = localCandidates.map(row => {
      const latest = latestById.get(row.id);
      if (latest && getRowStatus(latest) !== STATUS.DRAFT) return latest;
      return row;
    });

    const protectedIds = new Set(protectedRows.map(row => row.id));
    serverSheet.rows.forEach(row => {
      if (!protectedIds.has(row.id) && !deleted.has(row.id)) protectedRows.push(row);
    });

    committedSheet = normalizeSheetData({
      ...serverSheet,
      type: "member",
      memberName: sheetKey,
      rows: protectedRows,
      completed: false,
      reviewCompleted: false,
      reviewCompletedAt: "",
      reviewCompletedByEmail: "",
      updatedAt: submitTime,
      updatedBy: activeMember,
      updatedByEmail: auth.currentUser?.email || "",
      lockSessionId: serverSheet.lockSessionId || "",
      lockedBy: serverSheet.lockedBy || activeMember,
      lockedAt: submitTime
    });

    transaction.set(sheetRef, committedSheet, { merge: true });
  });

  deleted.clear();
  window.groupReviewApi?.clearDirtySheet?.(sheetKey);
  suppressObserver = true;
  try {
    applyRowUi(projectId, sheetKey, committedSheet);
    applyToolbarUi(sheetKey, committedSheet);
  } finally {
    suppressObserver = false;
  }
  alert(`${submittedCount}건을 임시저장했습니다. 관리자 검토 대상으로 제출되어 해당 행은 잠깁니다.`);
}

async function persistAdminChecks() {
  if (!isAdminUser()) throw new Error("관리자만 확인 상태를 저장할 수 있습니다.");
  const projectId = resolveProjectId();
  const sheetKey = resolveSheetKey();
  if (!projectId || !sheetKey) throw new Error("검토 중인 시트를 찾을 수 없습니다.");

  const relevant = Array.from(pendingChecks.entries()).filter(([key]) => key.startsWith(`${projectId}::${sheetKey}::`));
  if (!relevant.length) throw new Error("저장할 확인 변경이 없습니다.");
  const decisionMap = new Map(relevant.map(([key, value]) => [key.split("::").pop(), Boolean(value)]));
  const decisionTime = nowIso();
  const reviewer = auth.currentUser?.email || "";
  let committedSheet = null;

  await runTransaction(db, async transaction => {
    const sheetRef = doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
    const sheetSnap = await transaction.get(sheetRef);
    const serverSheet = normalizeSheetData(sheetSnap.data() || {});
    if (serverSheet.reviewCompleted) throw new Error("리뷰 완료된 시트입니다. 리뷰 재개 후 수정하세요.");

    const nextRows = serverSheet.rows.map(row => {
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

    committedSheet = normalizeSheetData({
      ...serverSheet,
      rows: nextRows,
      updatedAt: decisionTime,
      updatedByEmail: reviewer
    });
    transaction.set(sheetRef, committedSheet, { merge: true });
  });

  relevant.forEach(([key]) => pendingChecks.delete(key));
  window.groupReviewApi?.clearDirtySheet?.(sheetKey);
  suppressObserver = true;
  try {
    applyRowUi(projectId, sheetKey, committedSheet);
    applyToolbarUi(sheetKey, committedSheet);
  } finally {
    suppressObserver = false;
  }
  alert(`${sheetKey} 관리자 확인 상태가 저장되었습니다.`);
}

// 관리자가 이미 확인 완료한 행은 잠근 채로 두고, 미확인 제출행만 작성중으로 되돌려
// 작업자가 다시 고칠 수 있게 한다.
function reopenRowsForWorker(rows) {
  if (!Array.isArray(rows)) return { rows: [], reopened: 0 };

  let reopened = 0;
  const next = rows.map(row => {
    const status = getRowStatus(row);
    if (status === STATUS.APPROVED || status === STATUS.REVISION_REQUESTED) return row;
    if (!rowHasWorkerValue(row)) return row;

    reopened += 1;
    return {
      ...row,
      checked: false,
      reviewStatus: STATUS.DRAFT,
      submittedAt: "",
      submittedBy: "",
      reviewedAt: "",
      reviewedByEmail: ""
    };
  });

  return { rows: next, reopened };
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
  if (isAdminUser()) throw new Error("관리자 검토 화면에서는 작업자 입력 완료를 사용할 수 없습니다.");
  const projectId = resolveProjectId();
  const sheetKey = resolveSheetKey();
  const activeMember = activeMemberKey();
  if (!projectId || !sheetKey || !activeMember) throw new Error("사용 중인 이름이 없습니다.");
  if (activeMember !== sheetKey) {
    throw new Error(`${sheetKey} 시트는 열람 전용입니다. 본인(${activeMember}) 시트 탭에서 입력 완료하세요.`);
  }

  const rawSheet = fetchRawSheet(projectId, sheetKey);
  const rawById = new Map(rawSheet.rows.map(row => [row.id, row]));
  const hasUnsavedDraft = getReviewTableRows().some(tr => {
    const rowId = tr.dataset.reviewRowId || "";
    const rawRow = rowId ? rawById.get(rowId) : null;
    if (rawRow && getRowStatus(rawRow) !== STATUS.DRAFT) return false;
    return rowReadyForSubmission(readDomRow(tr, rawRow));
  });

  if (hasUnsavedDraft) {
    throw new Error("작성 중인 내용이 있습니다. 먼저 임시저장(검토요청)한 뒤 입력 완료하세요.");
  }

  if (unresolvedRevisionRows(rawSheet.rows).length) {
    throw new Error("관리자가 재수정 요청한 항목이 남아 있습니다. 새 작성행에 다시 입력하고 임시저장하세요.");
  }

  const completedAt = nowIso();
  let committedSheet = null;
  await runTransaction(db, async transaction => {
    const sheetRef = doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
    const sheetSnap = await transaction.get(sheetRef);
    const latest = normalizeSheetData(sheetSnap.data() || {});
    if (unresolvedRevisionRows(latest.rows).length) {
      throw new Error("관리자가 재수정 요청한 항목이 남아 있습니다.");
    }

    committedSheet = normalizeSheetData({
      ...latest,
      completed: true,
      lockSessionId: "",
      lockedBy: "",
      lockedAt: "",
      updatedAt: completedAt,
      updatedBy: activeMember,
      updatedByEmail: auth.currentUser?.email || ""
    });
    transaction.set(sheetRef, committedSheet, { merge: true });
  });

  window.groupReviewApi?.clearDirtySheet?.(sheetKey);
  suppressObserver = true;
  try {
    applyRowUi(projectId, sheetKey, committedSheet);
    applyToolbarUi(sheetKey, committedSheet);
  } finally {
    suppressObserver = false;
  }
  alert("입력 완료되었습니다. 제출된 행은 잠금 상태로 유지되고 관리자가 검토합니다.");
}

async function requestRevision(rowId) {
  if (!isAdminUser()) throw new Error("관리자만 재수정 요청을 할 수 있습니다.");
  const projectId = resolveProjectId();
  const sheetKey = resolveSheetKey();
  if (!projectId || !sheetKey || !rowId) throw new Error("재수정 요청 대상을 찾을 수 없습니다.");

  const requestTime = nowIso();
  const reviewer = auth.currentUser?.email || "";
  let created = false;
  let committedSheet = null;

  await runTransaction(db, async transaction => {
    const sheetRef = doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
    const sheetSnap = await transaction.get(sheetRef);
    const serverSheet = normalizeSheetData(sheetSnap.data() || {});
    const index = serverSheet.rows.findIndex(row => row.id === rowId);
    if (index < 0) throw new Error("대상 행이 서버에 없습니다.");

    const target = serverSheet.rows[index];
    const status = getRowStatus(target);
    if (![STATUS.SUBMITTED, STATUS.APPROVED].includes(status)) {
      throw new Error("검토대기 또는 완료 행만 재수정 요청할 수 있습니다.");
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
        parentRevisionId: target.id
      }));
      created = true;
    }

    committedSheet = normalizeSheetData({
      ...serverSheet,
      rows: nextRows,
      completed: false,
      reviewCompleted: false,
      reviewCompletedAt: "",
      reviewCompletedByEmail: "",
      updatedAt: requestTime,
      updatedByEmail: reviewer
    });
    transaction.set(sheetRef, committedSheet, { merge: true });
  });

  window.groupReviewApi?.clearDirtySheet?.(sheetKey);
  suppressObserver = true;
  try {
    applyRowUi(projectId, sheetKey, committedSheet);
    applyToolbarUi(sheetKey, committedSheet);
  } finally {
    suppressObserver = false;
  }
  alert(created
    ? "재수정 요청했습니다. 기존 행은 잠긴 상태로 보존되고 작업자용 새 작성행이 생성되었습니다."
    : "이미 재수정용 작성행이 있어 재수정 요청 상태만 갱신했습니다.");
}

async function completeAdminReview() {
  if (!isAdminUser()) throw new Error("관리자만 리뷰 완료를 할 수 있습니다.");
  const projectId = resolveProjectId();
  const sheetKey = resolveSheetKey();
  if (!projectId || !sheetKey) throw new Error("리뷰 완료할 시트를 찾을 수 없습니다.");

  const completedAt = nowIso();
  const reviewer = auth.currentUser?.email || "";
  let committedSheet = null;

  await runTransaction(db, async transaction => {
    const sheetRef = doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
    const sheetSnap = await transaction.get(sheetRef);
    const serverSheet = normalizeSheetData(sheetSnap.data() || {});
    if (!serverSheet.completed) throw new Error("작업자가 아직 입력 완료하지 않았습니다.");

    const pending = serverSheet.rows.filter(row => getRowStatus(row) === STATUS.SUBMITTED);
    if (pending.length) throw new Error(`미확인 검토대기 행이 ${pending.length}건 남아 있습니다.`);

    const revisionPending = serverSheet.rows.filter(row => getRowStatus(row) === STATUS.REVISION_REQUESTED);
    if (revisionPending.length) throw new Error(`재수정 요청 처리 중인 행이 ${revisionPending.length}건 남아 있습니다.`);

    committedSheet = normalizeSheetData({
      ...serverSheet,
      reviewCompleted: true,
      reviewCompletedAt: completedAt,
      reviewCompletedByEmail: reviewer,
      updatedAt: completedAt,
      updatedByEmail: reviewer
    });
    transaction.set(sheetRef, committedSheet, { merge: true });
  });

  window.groupReviewApi?.clearDirtySheet?.(sheetKey);
  suppressObserver = true;
  try {
    applyRowUi(projectId, sheetKey, committedSheet);
    applyToolbarUi(sheetKey, committedSheet);
  } finally {
    suppressObserver = false;
  }
  alert(`${sheetKey} 리뷰 완료 처리되었습니다.`);
}

async function reopenAdminReview() {
  if (!isAdminUser()) throw new Error("관리자만 리뷰를 재개할 수 있습니다.");
  const projectId = resolveProjectId();
  const sheetKey = resolveSheetKey();
  if (!projectId || !sheetKey) throw new Error("리뷰 재개할 시트를 찾을 수 없습니다.");

  const reopenedAt = nowIso();
  let committedSheet = null;
  let reopenedCount = 0;
  await runTransaction(db, async transaction => {
    const sheetRef = doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
    const sheetSnap = await transaction.get(sheetRef);
    const serverSheet = normalizeSheetData(sheetSnap.data() || {});
    const { rows, reopened } = reopenRowsForWorker(serverSheet.rows);
    reopenedCount = reopened;

    // 리뷰 재개는 작업자가 다시 입력할 수 있어야 의미가 있으므로 시트 잠금까지 함께 푼다.
    committedSheet = normalizeSheetData({
      ...serverSheet,
      rows,
      completed: false,
      reviewCompleted: false,
      reviewCompletedAt: "",
      reviewCompletedByEmail: "",
      reuseRequested: false,
      reuseRequestedAt: "",
      reuseRequestedBy: "",
      reuseRequestedByEmail: "",
      updatedAt: reopenedAt,
      updatedByEmail: auth.currentUser?.email || ""
    });
    transaction.set(sheetRef, committedSheet, { merge: true });
  });

  window.groupReviewApi?.clearDirtySheet?.(sheetKey);
  suppressObserver = true;
  try {
    applyRowUi(projectId, sheetKey, committedSheet);
    applyToolbarUi(sheetKey, committedSheet);
  } finally {
    suppressObserver = false;
  }
  alert(`${sheetKey} 리뷰를 다시 진행할 수 있습니다. 확인 완료된 행은 잠긴 채로 두고 미확인 ${reopenedCount}건을 작업자가 다시 입력할 수 있습니다.`);
}

function isRelevantReviewSheet(sheet) {
  return sheet.completed || sheet.reviewCompleted || sheet.rows.some(row => rowHasWorkerValue(row));
}

async function completeProjectWithReviewCheck() {
  if (!isAdminUser()) return alert("관리자만 사용할 수 있습니다.");
  const projectId = resolveProjectId();
  if (!projectId) return alert("완료할 프로젝트를 먼저 선택하세요.");

  // 시트 전체는 onSnapshot으로 이미 받아둔 상태에 있으므로 getDocs로 다시 읽지 않는다.
  const sheets = runtime()?.getSheets() || {};
  const relevant = Object.keys(sheets).map(key => ({
    ref: doc(db, "groupReviewProjects", projectId, "sheets", key),
    key,
    data: normalizeSheetData(sheets[key] || {})
  })).filter(item => isRelevantReviewSheet(item.data));

  if (!relevant.length) return alert("리뷰 완료할 작업자 데이터가 없습니다.");
  const notDone = relevant.filter(item => !item.data.reviewCompleted);
  if (notDone.length) {
    return alert(`리뷰 완료되지 않은 작업자가 있습니다: ${notDone.map(item => item.key).join(", ")}`);
  }

  const projectName = runtime()?.getSelectedProject()?.name || "선택 프로젝트";
  const ok = confirm(`"${projectName}" 프로젝트를 완료할까요?\n완료 후에는 모든 사용자의 입력·확인·저장이 잠깁니다.`);
  if (!ok) return;

  const completedAt = nowIso();
  const completedByEmail = auth.currentUser?.email || "";
  const batch = writeBatch(db);
  batch.set(doc(db, "groupReviewProjects", projectId), {
    completed: true,
    completedAt,
    completedByEmail
  }, { merge: true });
  relevant.forEach(item => {
    batch.set(item.ref, {
      lockSessionId: "",
      lockedBy: "",
      lockedAt: ""
    }, { merge: true });
  });
  await batch.commit();
  alert("프로젝트가 완료되었습니다. 현재 프로젝트는 읽기 전용입니다.");
}

function installFunctionOverrides() {
  // selectGroupReviewProject / createGroupReviewProjectPrompt / selectGroupReviewSheet /
  // selectGroupReviewMember 는 모두 렌더로 끝나고, 렌더는 runtime.subscribe로 통지되므로
  // 갱신만 예약하던 래퍼를 두지 않는다.
  const originalStartUse = window.startGroupReviewUse;
  if (typeof originalStartUse === "function") {
    window.startGroupReviewUse = async function() {
      try {
        if (!isAdminUser()) {
          const projectId = resolveProjectId();
          const member = sessionStorage.getItem(SELECTED_MEMBER_KEY) || "";
          if (projectId && member) {
            const sheet = fetchRawSheet(projectId, member);
            // 입력 완료 시트도 열 수 있어야 재사용 요청과 다른 작업자 열람이 가능하다.
            if (sheet.completed) {
              alert(sheet.reuseRequested
                ? "입력 완료 상태입니다. 재사용 요청을 보냈고 관리자 승인을 기다리는 중입니다."
                : "입력 완료 상태입니다. 입력칸은 잠겨 있고, 다시 입력하려면 재사용 요청을 누르세요.");
            }
          }
        }
        return await originalStartUse.apply(this, arguments);
      } catch (error) {
        alert("그룹리뷰 사용 시작 실패: " + (error.message || error));
      }
    };
  }

  const originalUpdateCell = window.updateGroupReviewCell;
  if (typeof originalUpdateCell === "function") {
    window.updateGroupReviewCell = function(rowIndex, field, value) {
      const scrollState = captureScrollState();
      const tr = getReviewTableRows()[Number(rowIndex)];
      const rawRow = tr?.__reviewRawRow || null;
      const status = rawRow ? getRowStatus(rawRow) : STATUS.DRAFT;

      if (field === "checked") {
        if (!isAdminUser() || !rawRow || ![STATUS.SUBMITTED, STATUS.APPROVED].includes(status)) return;
        const projectId = resolveProjectId();
        const sheetKey = resolveSheetKey();
        if (!projectId || !sheetKey) return;
        pendingChecks.set(
          pendingCheckKey(projectId, sheetKey, rawRow.id),
          Boolean(value)
        );
        originalUpdateCell.call(this, rowIndex, field, value);
        restoreScrollState(scrollState);
        return;
      }

      if (isAdminUser() || (rawRow && status !== STATUS.DRAFT)) return;
      const result = originalUpdateCell.call(this, rowIndex, field, value);
      restoreScrollState(scrollState);
      return result;
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
      const projectId = resolveProjectId();
      if (rawRow?.id && projectId) {
        deletedSetFor(projectId, resolveSheetKey()).add(rawRow.id);
      }
      const result = originalRemoveRow.apply(this, arguments);
      scheduleWorkflowRefresh();
      return result;
    };
  }

  originalAddRow = window.addGroupReviewRow;
  if (typeof originalAddRow === "function") {
    window.addGroupReviewRow = function() {
      if (isAdminUser()) return alert("관리자는 작업자 작성행을 추가할 수 없습니다.");
      const result = originalAddRow.apply(this, arguments);
      scheduleWorkflowRefresh();
      return result;
    };
  }

  window.saveGroupReviewSheet = async function() {
    await withScrollPreserved(async () => {
      try {
        if (isAdminUser()) await persistAdminChecks();
        else await persistWorkerSubmission();
      } catch (error) {
        console.error("그룹리뷰 저장 실패:", error);
        alert("그룹리뷰 저장 실패: " + (error.message || error));
      }
    });
  };

  window.saveGroupReviewSheetAndMove = async function(direction = 1) {
    await withScrollPreserved(async () => {
      try {
        if (!isAdminUser()) return;
        await persistAdminChecks();
        window.moveGroupReviewAdminSheet?.(direction);
        scheduleWorkflowRefresh();
      } catch (error) {
        console.error("그룹리뷰 확인 저장 후 이동 실패:", error);
        alert("그룹리뷰 확인 저장 후 이동 실패: " + (error.message || error));
      }
    });
  };

  window.completeGroupReviewUse = async function() {
    await withScrollPreserved(async () => {
      try {
        await completeWorkerSheet();
      } catch (error) {
        console.error("그룹리뷰 입력 완료 실패:", error);
        alert("그룹리뷰 입력 완료 실패: " + (error.message || error));
      }
    });
  };

  window.reopenGroupReviewUse = function() {
    alert("재수정은 관리자가 해당 행에서 '재수정 요청'을 해야 합니다. 기존 제출행은 수정하지 않고 새 작성행에서 다시 입력합니다.");
  };

  window.requestGroupReviewRevision = async function(rowId) {
    await withScrollPreserved(async () => {
      try {
        await requestRevision(rowId);
      } catch (error) {
        console.error("그룹리뷰 재수정 요청 실패:", error);
        alert("그룹리뷰 재수정 요청 실패: " + (error.message || error));
      }
    });
  };

  window.completeGroupReviewReview = async function() {
    await withScrollPreserved(async () => {
      try {
        await completeAdminReview();
      } catch (error) {
        console.error("그룹리뷰 리뷰 완료 실패:", error);
        alert("그룹리뷰 리뷰 완료 실패: " + (error.message || error));
      }
    });
  };

  window.reopenGroupReviewReview = async function() {
    await withScrollPreserved(async () => {
      try {
        await reopenAdminReview();
      } catch (error) {
        console.error("그룹리뷰 리뷰 재개 실패:", error);
        alert("그룹리뷰 리뷰 재개 실패: " + (error.message || error));
      }
    });
  };

  window.completeGroupReviewProject = async function() {
    await withScrollPreserved(async () => {
      try {
        await completeProjectWithReviewCheck();
      } catch (error) {
        console.error("그룹리뷰 프로젝트 완료 실패:", error);
        alert("그룹리뷰 프로젝트 완료 실패: " + (error.message || error));
      }
    });
  };
}

// DOM 변경을 감시하는 대신 Original의 렌더 완료 신호를 직접 받는다.
// MutationObserver는 자기가 만든 변경까지 되받아 갱신 루프를 만들었다.
function installRuntimeSubscription() {
  runtime()?.subscribe(() => {
    if (suppressObserver) return;
    refreshWorkflowUi();
  });

  if (auth) {
    onAuthStateChanged(auth, () => {
      currentProjectId = "";
      pendingChecks.clear();
      scheduleWorkflowRefresh();
    });
  }
}

function tryInstall() {
  if (installed) return;
  const apps = getApps();
  if (!apps.length || !window.groupReviewApi || !window.groupReviewRuntime
    || typeof window.saveGroupReviewSheet !== "function") {
    setTimeout(tryInstall, 100);
    return;
  }

  db = getFirestore(apps[0]);
  auth = getAuth(apps[0]);
  installed = true;
  installFunctionOverrides();
  installRuntimeSubscription();
  scheduleWorkflowRefresh();
}

tryInstall();
