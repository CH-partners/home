import { getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
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

const ACTIVE_MEMBER_KEY = "groupReviewActiveMember";
const SELECTED_MEMBER_KEY = "groupReviewSelectedMember";

let db = null;
let auth = null;
let installed = false;
let observerInstalled = false;
let refreshTimer = null;
let stateCache = null;
let stateCacheAt = 0;
let currentProjectId = "";
let projectCache = new Map();
let projectCacheLoaded = false;
let originalComplete = null;

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
    || sessionStorage.getItem(ACTIVE_MEMBER_KEY)
    || sessionStorage.getItem(SELECTED_MEMBER_KEY)
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
  projectCache = next;
  projectCacheLoaded = true;
}

async function resolveProjectId() {
  if (currentProjectId) return currentProjectId;
  await ensureProjectCache();
  currentProjectId = projectCache.get(currentProjectName()) || "";
  return currentProjectId;
}

function invalidateState() {
  stateCache = null;
  stateCacheAt = 0;
}

async function readCurrentState(force = false) {
  if (!db) return null;
  const now = Date.now();
  if (!force && stateCache && now - stateCacheAt < 800) return stateCache;

  const projectId = await resolveProjectId();
  const sheetKey = currentSheetKey();
  if (!projectId || !sheetKey) return null;

  const [projectSnap, sheetSnap] = await Promise.all([
    getDoc(doc(db, "groupReviewProjects", projectId)),
    getDoc(doc(db, "groupReviewProjects", projectId, "sheets", sheetKey))
  ]);

  const project = projectSnap.data() || {};
  const sheet = sheetSnap.data() || {};
  stateCache = {
    projectId,
    sheetKey,
    projectCompleted: Boolean(project.completed),
    completed: Boolean(sheet.completed),
    reviewCompleted: Boolean(sheet.reviewCompleted),
    reuseRequested: Boolean(sheet.reuseRequested),
    reuseRequestedAt: String(sheet.reuseRequestedAt || ""),
    reuseRequestedBy: String(sheet.reuseRequestedBy || "")
  };
  stateCacheAt = now;
  return stateCache;
}

function findWorkerCompletedControl() {
  const body = document.getElementById("groupReviewBody");
  if (!body) return null;
  return body.querySelector('.review-use-controls.completed button[onclick="reopenGroupReviewUse()"], .review-use-controls.completed .review-worker-reuse-request');
}

function patchWorkerUi(state) {
  const button = findWorkerCompletedControl();
  if (!button) return;

  if (!state.completed || state.projectCompleted) return;

  button.classList.add("review-worker-reuse-request");
  button.removeAttribute("onclick");
  button.style.display = "";
  button.disabled = Boolean(state.reuseRequested);
  button.textContent = state.reuseRequested ? "재사용 요청중" : "재사용 요청";
  button.onclick = state.reuseRequested ? null : () => window.requestGroupReviewReuse?.();
}

function removeAdminReuseActions(actions) {
  actions?.querySelectorAll(".review-admin-reuse-action").forEach(button => button.remove());
}

function patchAdminUi(state) {
  const body = document.getElementById("groupReviewBody");
  const actions = body?.querySelector(".work-header-actions");
  if (!actions) return;

  removeAdminReuseActions(actions);
  if (!state.completed || !state.reuseRequested || state.projectCompleted) return;

  const approve = document.createElement("button");
  approve.type = "button";
  approve.className = "action-btn review-admin-reuse-action";
  approve.textContent = "재사용 승인";
  approve.onclick = () => window.approveGroupReviewReuse?.();

  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "action-btn danger review-admin-reuse-action";
  reject.textContent = "요청 거절";
  reject.onclick = () => window.rejectGroupReviewReuse?.();

  actions.appendChild(approve);
  actions.appendChild(reject);
}

async function applyReuseUi(force = false) {
  if (!installed) return;
  const state = await readCurrentState(force);
  if (!state) return;
  if (isAdminUser()) patchAdminUi(state);
  else patchWorkerUi(state);
}

function scheduleUiRefresh(force = false) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void applyReuseUi(force).catch(error =>
      console.warn("그룹리뷰 재사용 요청 UI 갱신 실패:", error)
    );
  }, 100);
}

async function requestWorkerReuse() {
  if (isAdminUser()) throw new Error("작업자만 재사용 요청을 할 수 있습니다.");

  const projectId = await resolveProjectId();
  const sheetKey = currentSheetKey();
  if (!projectId || !sheetKey) throw new Error("재사용 요청할 작업자 시트를 찾을 수 없습니다.");

  const requestedAt = new Date().toISOString();
  const requestedBy = sessionStorage.getItem(ACTIVE_MEMBER_KEY) || sheetKey;

  await runTransaction(db, async transaction => {
    const projectRef = doc(db, "groupReviewProjects", projectId);
    const sheetRef = doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
    const projectSnap = await transaction.get(projectRef);
    const sheetSnap = await transaction.get(sheetRef);
    const project = projectSnap.data() || {};
    const sheet = sheetSnap.data() || {};

    if (project.completed) throw new Error("프로젝트 완료 상태에서는 재사용 요청을 할 수 없습니다.");
    if (!sheet.completed) throw new Error("현재 시트는 이미 작업 가능한 상태입니다.");
    if (sheet.reuseRequested) throw new Error("이미 재사용 요청 중입니다.");

    transaction.set(sheetRef, {
      reuseRequested: true,
      reuseRequestedAt: requestedAt,
      reuseRequestedBy: requestedBy,
      reuseRequestedByEmail: auth?.currentUser?.email || "",
      reuseRequestRejectedAt: "",
      reuseRequestRejectedByEmail: "",
      updatedAt: requestedAt,
      updatedBy: requestedBy,
      updatedByEmail: auth?.currentUser?.email || ""
    }, { merge: true });
  });

  invalidateState();
  scheduleUiRefresh(true);
  alert("재사용 요청을 보냈습니다. 관리자 승인 전까지 입력은 계속 잠긴 상태입니다.");
}

async function approveReuse() {
  if (!isAdminUser()) throw new Error("관리자만 재사용 요청을 승인할 수 있습니다.");

  const projectId = await resolveProjectId();
  const sheetKey = currentSheetKey();
  if (!projectId || !sheetKey) throw new Error("재사용 승인할 작업자 시트를 찾을 수 없습니다.");

  const approvedAt = new Date().toISOString();
  const reviewer = auth?.currentUser?.email || "";

  await runTransaction(db, async transaction => {
    const projectRef = doc(db, "groupReviewProjects", projectId);
    const sheetRef = doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
    const projectSnap = await transaction.get(projectRef);
    const sheetSnap = await transaction.get(sheetRef);
    const project = projectSnap.data() || {};
    const sheet = sheetSnap.data() || {};

    if (project.completed) throw new Error("프로젝트 완료 상태에서는 재사용 승인할 수 없습니다.");
    if (!sheet.completed) throw new Error("현재 시트는 이미 작업 가능한 상태입니다.");
    if (!sheet.reuseRequested) throw new Error("대기 중인 재사용 요청이 없습니다.");

    transaction.set(sheetRef, {
      completed: false,
      reviewCompleted: false,
      reviewCompletedAt: "",
      reviewCompletedByEmail: "",
      reuseRequested: false,
      reuseRequestedAt: "",
      reuseRequestedBy: "",
      reuseRequestedByEmail: "",
      reuseApprovedAt: approvedAt,
      reuseApprovedByEmail: reviewer,
      lockSessionId: "",
      lockedBy: "",
      lockedAt: "",
      updatedAt: approvedAt,
      updatedByEmail: reviewer
    }, { merge: true });
  });

  invalidateState();
  if (typeof window.refreshGroupReviewWorkerView === "function") {
    await window.refreshGroupReviewWorkerView();
  }
  scheduleUiRefresh(true);
  alert(`${sheetKey} 재사용 요청을 승인했습니다. 작업자가 다시 입력할 수 있습니다.`);
}

async function rejectReuse() {
  if (!isAdminUser()) throw new Error("관리자만 재사용 요청을 거절할 수 있습니다.");

  const projectId = await resolveProjectId();
  const sheetKey = currentSheetKey();
  if (!projectId || !sheetKey) throw new Error("재사용 요청 시트를 찾을 수 없습니다.");

  const rejectedAt = new Date().toISOString();
  const reviewer = auth?.currentUser?.email || "";

  await runTransaction(db, async transaction => {
    const sheetRef = doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
    const sheetSnap = await transaction.get(sheetRef);
    const sheet = sheetSnap.data() || {};
    if (!sheet.reuseRequested) throw new Error("대기 중인 재사용 요청이 없습니다.");

    transaction.set(sheetRef, {
      reuseRequested: false,
      reuseRequestedAt: "",
      reuseRequestedBy: "",
      reuseRequestedByEmail: "",
      reuseRequestRejectedAt: rejectedAt,
      reuseRequestRejectedByEmail: reviewer,
      updatedAt: rejectedAt,
      updatedByEmail: reviewer
    }, { merge: true });
  });

  invalidateState();
  if (typeof window.refreshGroupReviewWorkerView === "function") {
    await window.refreshGroupReviewWorkerView();
  }
  scheduleUiRefresh(true);
  alert(`${sheetKey} 재사용 요청을 거절했습니다.`);
}

function installObserver() {
  if (observerInstalled) return;
  const body = document.getElementById("groupReviewBody");
  const badges = document.getElementById("groupReviewProjectBadges");
  if (!body && !badges) return;

  const observer = new MutationObserver(mutations => {
    const structural = mutations.some(mutation => mutation.type === "childList");
    if (structural) {
      invalidateState();
      scheduleUiRefresh(true);
    }
  });
  if (body) observer.observe(body, { childList: true, subtree: true });
  if (badges) observer.observe(badges, { childList: true, subtree: true });
  observerInstalled = true;
}

function install() {
  if (installed) return;
  const apps = getApps();
  if (!apps.length || typeof window.completeGroupReviewUse !== "function") {
    setTimeout(install, 100);
    return;
  }

  db = getFirestore(apps[0]);
  auth = getAuth(apps[0]);
  originalComplete = window.completeGroupReviewUse;

  window.completeGroupReviewUse = async function() {
    await originalComplete.apply(this, arguments);
    invalidateState();
    scheduleUiRefresh(true);
  };

  window.requestGroupReviewReuse = async function() {
    try {
      await requestWorkerReuse();
    } catch (error) {
      console.error("그룹리뷰 재사용 요청 실패:", error);
      alert("재사용 요청 실패: " + (error.message || error));
    }
  };

  window.approveGroupReviewReuse = async function() {
    try {
      await approveReuse();
    } catch (error) {
      console.error("그룹리뷰 재사용 승인 실패:", error);
      alert("재사용 승인 실패: " + (error.message || error));
    }
  };

  window.rejectGroupReviewReuse = async function() {
    try {
      await rejectReuse();
    } catch (error) {
      console.error("그룹리뷰 재사용 거절 실패:", error);
      alert("재사용 거절 실패: " + (error.message || error));
    }
  };

  installed = true;
  installObserver();
  scheduleUiRefresh(true);
}

install();
