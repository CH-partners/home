import { getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
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
let currentProjectId = "";
let projectNameCache = new Map();
let projectCacheLoaded = false;
let workflowUpdateCell = null;
let workflowSaveSheet = null;
let workflowSelectProject = null;
let workflowSelectSheet = null;
const pendingChecks = new Map();

function isAdminUser() {
  const email = (auth?.currentUser?.email || "").toLowerCase();
  return ADMIN_EMAILS.has(email);
}

function cleanProjectName(value) {
  return String(value || "").replace(/\s*·\s*완료\s*$/u, "").trim();
}

function cleanSheetName(value) {
  return String(value || "")
    .replace(/\s*·\s*(완료|입력|리뷰완료)\s*$/u, "")
    .trim();
}

function currentProjectName() {
  const badge = document.querySelector("#groupReviewProjectBadges .work-badge.active");
  return cleanProjectName(badge?.textContent || "");
}

function currentSheetKey() {
  const activeTab = document.querySelector("#groupReviewBody .review-sheet-btn.active");
  return cleanSheetName(activeTab?.textContent || "")
    || sessionStorage.getItem("groupReviewActiveMember")
    || sessionStorage.getItem("groupReviewSelectedMember")
    || "";
}

async function ensureProjectCache() {
  if (projectCacheLoaded || !db) return;
  const snap = await getDocs(collection(db, "groupReviewProjects"));
  const next = new Map();
  snap.forEach(projectDoc => {
    const data = projectDoc.data() || {};
    next.set(String(data.name || projectDoc.id), projectDoc.id);
  });
  projectNameCache = next;
  projectCacheLoaded = true;
}

async function resolveProjectId() {
  if (currentProjectId) return currentProjectId;
  await ensureProjectCache();
  currentProjectId = projectNameCache.get(currentProjectName()) || "";
  return currentProjectId;
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

  actions.querySelectorAll('button[onclick="addGroupReviewRow()"]')
    .forEach(button => button.style.display = "none");
  actions.querySelectorAll('button[onclick="completeGroupReviewUse()"]')
    .forEach(button => button.style.display = "none");
  actions.querySelectorAll('button[onclick="reopenGroupReviewUse()"]')
    .forEach(button => button.style.display = "none");

  const confirmButton = actions.querySelector('button[onclick="saveGroupReviewSheet()"]');
  if (confirmButton) {
    confirmButton.style.display = "";
    confirmButton.textContent = "확인";
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
  reviewButton.textContent = reviewLabel;
  reviewButton.onclick = reviewLabel === "리뷰 재개"
    ? () => window.reopenGroupReviewReview?.()
    : () => window.completeGroupReviewReview?.();
}

function patchWorkerControls(body) {
  if (isAdminUser()) return;

  // 다른 작업자 시트를 열람 중일 때는 입력/저장 버튼을 되살리지 않는다.
  const viewingOther = currentSheetKey() !== (sessionStorage.getItem("groupReviewActiveMember") || "");

  body.querySelectorAll('button[onclick="saveGroupReviewSheet()"]')
    .forEach(button => {
      if (!button.disabled) button.textContent = "수정요청";
    });

  body.querySelectorAll('button[onclick="completeGroupReviewUse()"]')
    .forEach(button => {
      if (!viewingOther) button.style.display = "";
      button.textContent = "입력 완료";
    });

  addWorkerHint(body, viewingOther);
}

function patchVisibleUi() {
  const body = document.getElementById("groupReviewBody");
  if (!body) return;

  body.querySelectorAll(".review-workflow-badge").forEach(badge => {
    const next = normalizeBadgeText(badge.textContent);
    if (badge.textContent !== next) badge.textContent = next;
  });

  body.querySelectorAll(".review-workflow-revise").forEach(button => {
    if (button.textContent !== "수정요청") button.textContent = "수정요청";
  });

  if (isAdminUser()) {
    const upperActions = body.querySelector(".review-admin-actions");
    if (upperActions) upperActions.style.display = "none";
    addAdminLowerControls(body);
  } else {
    patchWorkerControls(body);
  }

  requestAnimationFrame(() => applyPendingChecks());
}

function scheduleUiPatch() {
  if (patchFrame) cancelAnimationFrame(patchFrame);
  patchFrame = requestAnimationFrame(() => {
    patchFrame = 0;
    patchVisibleUi();
    setTimeout(applyPendingChecks, 120);
  });
}

function installUiObserver() {
  if (uiObserverInstalled) return;
  const body = document.getElementById("groupReviewBody");
  if (!body) return;
  const observer = new MutationObserver(() => scheduleUiPatch());
  observer.observe(body, { childList: true, subtree: true });
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

async function refreshCurrentView() {
  const projectId = await resolveProjectId();
  const sheetKey = currentSheetKey();
  if (!projectId || !sheetKey) throw new Error("새로고침할 현재 작업자 시트를 찾을 수 없습니다.");
  if (typeof workflowSelectProject !== "function" || typeof workflowSelectSheet !== "function") {
    throw new Error("그룹리뷰 새로고침 기능을 준비하지 못했습니다.");
  }

  const scrollState = captureRefreshScroll();
  workflowSelectProject(projectId);

  let attempts = 0;
  await new Promise((resolve, reject) => {
    const restoreSheet = () => {
      attempts += 1;
      const targetButton = Array.from(document.querySelectorAll("#groupReviewBody .review-sheet-btn"))
        .find(button => cleanSheetName(button.textContent) === sheetKey);

      if (targetButton) {
        workflowSelectSheet(sheetKey);
        scheduleUiPatch();
        setTimeout(() => {
          applyPendingChecks();
          restoreRefreshScroll(scrollState);
        }, 80);
        resolve();
        return;
      }

      if (attempts >= 40) {
        reject(new Error("현재 작업자 시트를 다시 표시하지 못했습니다."));
        return;
      }
      setTimeout(restoreSheet, 50);
    };
    setTimeout(restoreSheet, 50);
  });
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

  workflowSelectProject = window.selectGroupReviewProject;
  if (typeof workflowSelectProject === "function") {
    window.selectGroupReviewProject = function(projectId) {
      currentProjectId = String(projectId || "");
      pendingChecks.clear();
      const result = workflowSelectProject.apply(this, arguments);
      scheduleUiPatch();
      return result;
    };
  }

  workflowSelectSheet = window.selectGroupReviewSheet;
  if (typeof workflowSelectSheet === "function") {
    window.selectGroupReviewSheet = function() {
      const result = workflowSelectSheet.apply(this, arguments);
      scheduleUiPatch();
      return result;
    };
  }

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
