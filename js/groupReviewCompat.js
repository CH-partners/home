import { getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
// 이 모듈은 더 이상 Firestore를 읽지 않는다. 상태는 groupReviewRuntime에서 받고 쓰기만 직접 한다.
import {
  doc,
  getFirestore,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const ADMIN_EMAILS = new Set([
  "admin@admin.com",
  "eastspring1979@gmail.com",
  "sora@jeju.com"
].map(value => value.toLowerCase()));

let db = null;
let auth = null;
let installed = false;
let uiObserverInstalled = false;
let patchFrame = 0;
let workflowUpdateCell = null;
let workflowSaveSheet = null;
let workflowSelectProject = null;
let workflowSelectSheet = null;
const pendingChecks = new Map();

function isAdminUser() {
  const email = (auth?.currentUser?.email || "").toLowerCase();
  return ADMIN_EMAILS.has(email);
}

function cleanSheetName(value) {
  return String(value || "")
    .replace(/\s*·\s*(완료|입력|리뷰완료)\s*$/u, "")
    .trim();
}

function currentSheetKey() {
  const activeTab = document.querySelector("#groupReviewBody .review-sheet-btn.active");
  return cleanSheetName(activeTab?.textContent || "")
    || sessionStorage.getItem("groupReviewActiveMember")
    || sessionStorage.getItem("groupReviewSelectedMember")
    || "";
}

// Original의 onSnapshot이 선택된 프로젝트를 이미 알고 있으므로 목록을 다시 조회하지 않는다.
function resolveProjectId() {
  return window.groupReviewRuntime?.getSelectedProjectId() || "";
}

function rowKey(sheetKey, rowId) {
  return `${sheetKey}::${rowId}`;
}

function getRowId(rowIndex) {
  const rows = Array.from(document.querySelectorAll("#groupReviewBody .review-member-table tbody tr"));
  return rows[Number(rowIndex)]?.dataset?.reviewRowId || "";
}

function rememberCheck(rowIndex, checked) {
  const sheetKey = currentSheetKey();
  const rowId = getRowId(rowIndex);
  if (!sheetKey || !rowId) return false;
  pendingChecks.set(rowKey(sheetKey, rowId), Boolean(checked));
  return true;
}

function applyPendingChecks() {
  if (!isAdminUser()) return;
  const sheetKey = currentSheetKey();
  if (!sheetKey) return;

  document.querySelectorAll("#groupReviewBody .review-member-table tbody tr[data-review-row-id]").forEach(tr => {
    const rowId = tr.dataset.reviewRowId || "";
    const key = rowKey(sheetKey, rowId);
    if (!pendingChecks.has(key)) return;
    const checkbox = tr.querySelector('input[type="checkbox"]');
    if (!checkbox) return;
    checkbox.checked = Boolean(pendingChecks.get(key));
    tr.classList.toggle("review-row-checked", checkbox.checked);
  });
}

// 값이 같아도 대입하면 textContent는 텍스트 노드를 갈아끼워 childList 변경을 만든다.
// 그 변경을 옵저버가 되받아 다시 패치하는 무한 루프가 있었으므로 반드시 비교 후 쓴다.
function setText(el, value) {
  if (el.textContent !== value) el.textContent = value;
}

function setStyle(el, prop, value) {
  if (el.style[prop] !== value) el.style[prop] = value;
}

function normalizeBadgeText(text) {
  return String(text || "")
    .replace(/^검토대기\s*·?\s*v(\d+)$/u, "대기 v$1")
    .replace(/^확인완료\s*·?\s*v(\d+)$/u, "완료 v$1")
    .replace(/^완료\s*·?\s*v(\d+)$/u, "완료 v$1")
    .replace(/^재수정요청\s*·?\s*v(\d+)$/u, "수정요청 v$1");
}

function addWorkerHint(body, viewingOther) {
  if (isAdminUser()) return;
  if (viewingOther) {
    body.querySelector(".review-worker-submit-hint")?.remove();
    return;
  }
  const notes = Array.from(body.querySelectorAll(".work-project-header .note"));
  const note = notes.find(item =>
    item.textContent.includes("현재 내가 선택한 시트입니다.") ||
    item.textContent.includes("마지막 저장:")
  );
  if (!note || note.previousElementSibling?.classList?.contains("review-worker-submit-hint")) return;

  const hint = document.createElement("div");
  hint.className = "note review-worker-submit-hint";
  hint.style.fontWeight = "700";
  hint.style.marginBottom = "4px";
  hint.textContent = "수정요청을 사용하면 저장되어 입력창이 잠깁니다.";
  note.parentNode?.insertBefore(hint, note);
}

function addAdminLowerControls(body) {
  if (!isAdminUser()) return;
  const actions = body.querySelector(".work-header-actions");
  if (!actions) return;

  actions.querySelectorAll('button[onclick="addGroupReviewRow()"], button[onclick="completeGroupReviewUse()"], button[onclick="reopenGroupReviewUse()"]')
    .forEach(button => setStyle(button, "display", "none"));

  const confirmButton = actions.querySelector('button[onclick="saveGroupReviewSheet()"]');
  if (confirmButton) {
    setStyle(confirmButton, "display", "");
    setText(confirmButton, "확인");
  }

  let refreshButton = actions.querySelector(".review-worker-refresh-action");
  if (!refreshButton) {
    refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.className = "action-btn review-worker-refresh-action";
    refreshButton.textContent = "새로고침";
    refreshButton.title = "현재 프로젝트와 작업자 위치를 유지한 채 최신 내용을 불러옵니다.";
    refreshButton.onclick = () => window.refreshGroupReviewWorkerView?.();
    if (confirmButton?.nextSibling) actions.insertBefore(refreshButton, confirmButton.nextSibling);
    else actions.appendChild(refreshButton);
  }

  const upperReviewButton = body.querySelector(".review-admin-actions .review-complete-action");
  const reviewLabel = upperReviewButton?.textContent === "리뷰 재개" ? "리뷰 재개" : "리뷰 완료";

  let reviewButton = actions.querySelector(".review-lower-complete-action");
  if (!reviewButton) {
    reviewButton = document.createElement("button");
    reviewButton.type = "button";
    reviewButton.className = "action-btn review-lower-complete-action";
    actions.appendChild(reviewButton);
  }
  setText(reviewButton, reviewLabel);
  reviewButton.onclick = reviewLabel === "리뷰 재개"
    ? () => window.reopenGroupReviewReview?.()
    : () => window.completeGroupReviewReview?.();
}

function patchWorkerControls(body) {
  if (isAdminUser()) return;

  // 다른 작업자 시트를 열람 중일 때는 입력/저장 버튼을 되살리지 않는다.
  // 활성 이름이 없으면 아직 이름 선택 단계이므로 열람 모드로 보지 않는다.
  const activeMember = sessionStorage.getItem("groupReviewActiveMember") || "";
  const viewingOther = Boolean(activeMember) && currentSheetKey() !== activeMember;

  body.querySelectorAll('button[onclick="saveGroupReviewSheet()"]')
    .forEach(button => {
      if (!button.disabled) setText(button, "수정요청");
    });

  body.querySelectorAll('button[onclick="completeGroupReviewUse()"]')
    .forEach(button => {
      if (!viewingOther) setStyle(button, "display", "");
      setText(button, "입력 완료");
    });

  addWorkerHint(body, viewingOther);
}

function patchVisibleUi() {
  const body = document.getElementById("groupReviewBody");
  if (!body) return;

  body.querySelectorAll(".review-workflow-badge").forEach(badge => {
    setText(badge, normalizeBadgeText(badge.textContent));
  });

  body.querySelectorAll(".review-workflow-revise").forEach(button => {
    setText(button, "수정요청");
  });

  if (isAdminUser()) {
    const upperActions = body.querySelector(".review-admin-actions");
    if (upperActions) setStyle(upperActions, "display", "none");
    addAdminLowerControls(body);
  } else {
    patchWorkerControls(body);
  }

  applyPendingChecks();
}

function scheduleUiPatch() {
  if (patchFrame) cancelAnimationFrame(patchFrame);
  patchFrame = requestAnimationFrame(() => {
    patchFrame = 0;
    patchVisibleUi();
  });
}

// MutationObserver는 자기가 만든 textContent 변경을 되받아 rAF마다 다시 도는 루프를 만들었다.
// Original의 렌더 통지만 구독한다. Workflow/FinalUi가 먼저 그린 뒤 마지막에 다듬는다.
function installUiObserver() {
  if (uiObserverInstalled) return;
  if (!window.groupReviewRuntime) return;
  window.groupReviewRuntime.subscribe(() => scheduleUiPatch());
  uiObserverInstalled = true;
  scheduleUiPatch();
}

async function persistAdminChecks() {
  const projectId = await resolveProjectId();
  const sheetKey = currentSheetKey();
  if (!projectId || !sheetKey) throw new Error("확인할 작업자 시트를 찾을 수 없습니다.");

  const decisions = new Map();
  for (const [key, value] of pendingChecks.entries()) {
    if (!key.startsWith(`${sheetKey}::`)) continue;
    decisions.set(key.slice(sheetKey.length + 2), Boolean(value));
  }
  if (!decisions.size) throw new Error("저장할 확인 변경이 없습니다.");

  const decisionTime = new Date().toISOString();
  const reviewer = auth?.currentUser?.email || "";

  await runTransaction(db, async transaction => {
    const ref = doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
    const snap = await transaction.get(ref);
    const data = snap.data() || {};
    if (data.reviewCompleted) throw new Error("리뷰 완료된 시트입니다. 리뷰 재개 후 확인하세요.");

    const rows = Array.isArray(data.rows) ? data.rows.map(row => {
      const rowId = String(row?.id || "");
      if (!decisions.has(rowId)) return row;
      const checked = decisions.get(rowId);
      return {
        ...row,
        checked,
        reviewStatus: checked ? "approved" : "submitted",
        reviewedAt: checked ? decisionTime : "",
        reviewedByEmail: checked ? reviewer : ""
      };
    }) : [];

    transaction.set(ref, {
      rows,
      updatedAt: decisionTime,
      updatedByEmail: reviewer
    }, { merge: true });
  });

  for (const rowId of decisions.keys()) {
    pendingChecks.delete(rowKey(sheetKey, rowId));
  }
  alert(`${sheetKey} 확인 상태가 저장되었습니다.`);
}

function captureRefreshScroll() {
  const tableWrap = document.querySelector("#groupReviewBody .work-table-wrap");
  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    tableTop: tableWrap?.scrollTop || 0,
    tableLeft: tableWrap?.scrollLeft || 0
  };
}

function restoreRefreshScroll(state) {
  if (!state) return;
  const apply = () => {
    const tableWrap = document.querySelector("#groupReviewBody .work-table-wrap");
    if (tableWrap) {
      tableWrap.scrollTop = state.tableTop;
      tableWrap.scrollLeft = state.tableLeft;
    }
    window.scrollTo(state.windowX, state.windowY);
  };
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
}

// 예전에는 프로젝트를 다시 선택해 sheets 리스너를 재구독했는데,
// 재구독은 시트 11개를 전부 다시 읽는다. 리스너가 이미 최신이므로 다시 그리기만 하면 된다.
async function refreshCurrentView() {
  const sheetKey = currentSheetKey();
  if (!sheetKey) throw new Error("새로고침할 현재 작업자 시트를 찾을 수 없습니다.");

  const scrollState = captureRefreshScroll();

  if (typeof workflowSelectSheet === "function") workflowSelectSheet(sheetKey);
  else window.groupReviewApi?.renderGroupReviewUI?.({ preserveScroll: true });

  scheduleUiPatch();
  restoreRefreshScroll(scrollState);
}

function transformWorkerAlert(message) {
  return String(message || "")
    .replace(/임시저장\(검토요청\)/g, "수정요청")
    .replace(/임시저장했습니다\./g, "수정요청했습니다.")
    .replace(/임시저장하세요\./g, "수정요청하세요.");
}

async function runWorkerSave() {
  if (typeof workflowSaveSheet !== "function") return;
  const originalAlert = window.alert;
  window.alert = message => originalAlert(transformWorkerAlert(message));
  try {
    await workflowSaveSheet();
  } finally {
    window.alert = originalAlert;
  }
}

function installFinalOverrides() {
  if (installed) return true;
  if (!window.groupReviewApi || typeof window.completeGroupReviewReview !== "function") return false;
  if (typeof window.updateGroupReviewCell !== "function" || typeof window.saveGroupReviewSheet !== "function") return false;

  workflowUpdateCell = window.updateGroupReviewCell;
  workflowSaveSheet = window.saveGroupReviewSheet;

  window.updateGroupReviewCell = function(rowIndex, field, value) {
    if (isAdminUser() && field === "checked") {
      rememberCheck(rowIndex, value);
      scheduleUiPatch();
      return;
    }
    return workflowUpdateCell.apply(this, arguments);
  };

  window.saveGroupReviewSheet = async function() {
    try {
      if (isAdminUser()) await persistAdminChecks();
      else await runWorkerSave();
    } catch (error) {
      console.error("그룹리뷰 확인/수정요청 실패:", error);
      alert("그룹리뷰 처리 실패: " + (error.message || error));
    }
  };

  // 프로젝트를 바꾸면 다른 프로젝트의 확인 대기값이 섞이므로 여기서만 비운다.
  // 화면 갱신은 runtime 구독이 처리하므로 따로 예약하지 않는다.
  workflowSelectProject = window.selectGroupReviewProject;
  if (typeof workflowSelectProject === "function") {
    window.selectGroupReviewProject = function() {
      pendingChecks.clear();
      return workflowSelectProject.apply(this, arguments);
    };
  }

  workflowSelectSheet = window.selectGroupReviewSheet;

  window.refreshGroupReviewWorkerView = async function() {
    try {
      await refreshCurrentView();
    } catch (error) {
      console.error("그룹리뷰 현재 화면 새로고침 실패:", error);
      alert("새로고침 실패: " + (error.message || error));
    }
  };

  installed = true;
  installUiObserver();
  scheduleUiPatch();
  return true;
}

function bootstrap() {
  const apps = getApps();
  if (apps.length && !db) {
    db = getFirestore(apps[0]);
    auth = getAuth(apps[0]);
  }

  installUiObserver();
  if (!installFinalOverrides()) setTimeout(bootstrap, 50);
}

bootstrap();
