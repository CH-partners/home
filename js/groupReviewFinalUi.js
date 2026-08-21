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

const ACTIVE_MEMBER_KEY = "groupReviewActiveMember";
const SELECTED_MEMBER_KEY = "groupReviewSelectedMember";

let db = null;
let auth = null;
let installed = false;
let observerInstalled = false;
let refreshTimer = null;
let projectCache = new Map();
let projectCacheLoaded = false;

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
  const badge = document.querySelector("#groupReviewProjectBadges .work-badge.active");
  const onclick = badge?.getAttribute("onclick") || "";
  const match = onclick.match(/selectGroupReviewProject\((['\"])(.*?)\1\)/);
  if (match?.[2]) return match[2];

  await ensureProjectCache();
  return projectCache.get(currentProjectName()) || "";
}

async function readCurrentState() {
  const projectId = await resolveProjectId();
  const sheetKey = currentSheetKey();
  if (!projectId || !sheetKey) return null;

  const [projectSnap, sheetSnap] = await Promise.all([
    getDoc(doc(db, "groupReviewProjects", projectId)),
    getDoc(doc(db, "groupReviewProjects", projectId, "sheets", sheetKey))
  ]);

  const project = projectSnap.data() || {};
  const sheet = sheetSnap.data() || {};
  return {
    projectId,
    sheetKey,
    projectCompleted: Boolean(project.completed),
    completed: Boolean(sheet.completed),
    reviewCompleted: Boolean(sheet.reviewCompleted),
    reuseRequested: Boolean(sheet.reuseRequested)
  };
}

function removeLegacyWorkerControls(body) {
  body.querySelectorAll('button[onclick="reopenGroupReviewUse()"]')
    .forEach(button => button.style.display = "none");
}

function patchWorkerUi(state) {
  const body = document.getElementById("groupReviewBody");
  if (!body) return;

  removeLegacyWorkerControls(body);

  body.querySelectorAll('button[onclick="saveGroupReviewSheet()"]')
    .forEach(button => {
      button.textContent = "수정요청";
      button.disabled = Boolean(state.completed || state.projectCompleted);
    });

  const topSave = document.querySelector('.sheet-panel[data-index="13"] .work-toolbar button[onclick="saveGroupReviewSheet()"]');
  if (topSave) {
    topSave.textContent = "수정요청";
    topSave.disabled = Boolean(state.completed || state.projectCompleted);
  }

  body.querySelectorAll('button[onclick="completeGroupReviewUse()"]')
    .forEach(button => {
      button.textContent = "입력 완료";
      button.style.display = state.completed || state.projectCompleted ? "none" : "";
      button.disabled = Boolean(state.completed || state.projectCompleted);
    });

  let reuseButton = body.querySelector(".review-worker-reuse-request");
  if (!state.completed || state.projectCompleted) {
    reuseButton?.remove();
    return;
  }

  let host = body.querySelector(".work-header-actions");
  if (!host) {
    const saveButton = body.querySelector('button[onclick="saveGroupReviewSheet()"]');
    host = saveButton?.parentElement || null;
  }
  if (!host) return;

  if (!reuseButton) {
    reuseButton = document.createElement("button");
    reuseButton.type = "button";
    reuseButton.className = "action-btn review-worker-reuse-request";
    host.appendChild(reuseButton);
  }

  reuseButton.style.display = "";
  reuseButton.disabled = Boolean(state.reuseRequested);
  reuseButton.textContent = state.reuseRequested ? "재사용 요청중" : "재사용 요청";
  reuseButton.onclick = state.reuseRequested ? null : () => window.requestGroupReviewReuse?.();
}

function removeLegacyAdminUi(body) {
  const upper = body.querySelector(".review-admin-actions");
  if (upper) upper.style.display = "none";

  body.querySelectorAll('button[onclick="addGroupReviewRow()"], button[onclick="completeGroupReviewUse()"], button[onclick="reopenGroupReviewUse()"]')
    .forEach(button => button.style.display = "none");
}

function patchAdminUi(state) {
  const body = document.getElementById("groupReviewBody");
  if (!body) return;

  removeLegacyAdminUi(body);

  const actions = body.querySelector(".work-header-actions");
  if (!actions) return;

  actions.querySelectorAll(".review-admin-reuse-action").forEach(button => button.remove());
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

async function applyFinalUi() {
  if (!installed || !db) return;
  const state = await readCurrentState();
  if (!state) return;
  if (isAdminUser()) patchAdminUi(state);
  else patchWorkerUi(state);
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void applyFinalUi().catch(error =>
      console.warn("그룹리뷰 최종 UI 갱신 실패:", error)
    );
  }, 160);
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

  await applyFinalUi();
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

  if (typeof window.refreshGroupReviewWorkerView === "function") {
    await window.refreshGroupReviewWorkerView();
  }
  scheduleRefresh();
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

  if (typeof window.refreshGroupReviewWorkerView === "function") {
    await window.refreshGroupReviewWorkerView();
  }
  scheduleRefresh();
  alert(`${sheetKey} 재사용 요청을 거절했습니다.`);
}

function installActions() {
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
}

function installObserver() {
  if (observerInstalled) return;
  const body = document.getElementById("groupReviewBody");
  const badges = document.getElementById("groupReviewProjectBadges");
  if (!body && !badges) {
    setTimeout(installObserver, 100);
    return;
  }

  const observer = new MutationObserver(() => scheduleRefresh());
  if (body) observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "disabled"] });
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
  installed = true;
  installActions();
  installObserver();

  onAuthStateChanged(auth, () => {
    projectCacheLoaded = false;
    projectCache.clear();
    scheduleRefresh();
  });

  scheduleRefresh();
}

install();
