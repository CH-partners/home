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
let patching = false;
let projectCache = new Map();
let projectCacheLoaded = false;

function isAdminUser() {
  return ADMIN_EMAILS.has((auth?.currentUser?.email || "").toLowerCase());
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
  if (!isAdminUser()) {
    return sessionStorage.getItem(ACTIVE_MEMBER_KEY)
      || sessionStorage.getItem(SELECTED_MEMBER_KEY)
      || "";
  }

  const activeTab = document.querySelector("#groupReviewBody .review-sheet-btn.active");
  return cleanSheetName(activeTab?.textContent || "")
    || sessionStorage.getItem(ACTIVE_MEMBER_KEY)
    || sessionStorage.getItem(SELECTED_MEMBER_KEY)
    || "";
}

async function ensureProjectCache(force = false) {
  if (!db) return;
  if (!force && projectCacheLoaded) return;
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
  await ensureProjectCache();
  return projectCache.get(currentProjectName()) || "";
}

async function readCurrentState() {
  if (!db) return null;
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

function allWorkerSaveButtons(body) {
  const buttons = Array.from(body.querySelectorAll('button[onclick="saveGroupReviewSheet()"]'));
  const top = document.querySelector('.sheet-panel[data-index="13"] .work-toolbar button[onclick="saveGroupReviewSheet()"]');
  if (top && !buttons.includes(top)) buttons.push(top);
  return buttons;
}

function findReuseHost(body) {
  return body.querySelector(".review-use-controls.completed")
    || body.querySelector(".work-header-actions")
    || body.querySelector('button[onclick="saveGroupReviewSheet()"]')?.parentElement
    || null;
}

function patchWorkerUi(state) {
  const body = document.getElementById("groupReviewBody");
  if (!body) return;

  body.querySelectorAll('button[onclick="reopenGroupReviewUse()"]')
    .forEach(button => {
      button.style.display = "none";
      button.disabled = true;
    });

  allWorkerSaveButtons(body).forEach(button => {
    button.textContent = "수정요청";
    button.disabled = Boolean(state.completed || state.projectCompleted);
  });

  body.querySelectorAll('button[onclick="completeGroupReviewUse()"]')
    .forEach(button => {
      button.textContent = "입력 완료";
      button.disabled = Boolean(state.completed || state.projectCompleted);
      button.style.display = state.completed || state.projectCompleted ? "none" : "";
    });

  let reuseButton = body.querySelector(".review-worker-reuse-request");
  if (!state.completed || state.projectCompleted) {
    reuseButton?.remove();
    return;
  }

  const host = findReuseHost(body);
  if (!host) return;

  if (!reuseButton || reuseButton.parentElement !== host) {
    reuseButton?.remove();
    reuseButton = document.createElement("button");
    reuseButton.type = "button";
    reuseButton.className = "action-btn review-worker-reuse-request";
    host.appendChild(reuseButton);
  }

  reuseButton.style.display = "";
  reuseButton.disabled = Boolean(state.reuseRequested);
  reuseButton.textContent = state.reuseRequested ? "재사용 요청중" : "재사용 요청";
  reuseButton.onclick = state.reuseRequested ? null : () => window.requestGroupReviewReuse?.();

  body.querySelectorAll(".review-use-controls span").forEach(span => {
    if (state.completed && span.textContent.includes("입력 완료 상태")) {
      span.innerHTML = span.innerHTML.replace("확인 체크만 가능합니다.", "관리자 검토 대기 상태입니다.");
    }
  });
}

function patchAdminUi(state) {
  const body = document.getElementById("groupReviewBody");
  if (!body) return;

  const upper = body.querySelector(".review-admin-actions");
  if (upper) upper.style.display = "none";

  body.querySelectorAll('button[onclick="addGroupReviewRow()"], button[onclick="completeGroupReviewUse()"], button[onclick="reopenGroupReviewUse()"]')
    .forEach(button => button.style.display = "none");

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
  if (!installed || !db || patching) return;
  patching = true;
  try {
    const state = await readCurrentState();
    if (!state) return;
    if (isAdminUser()) patchAdminUi(state);
    else patchWorkerUi(state);
  } finally {
    patching = false;
  }
}

function scheduleRefresh(delay = 80) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void applyFinalUi().catch(error =>
      console.warn("그룹리뷰 최종 UI 갱신 실패:", error)
    );
  }, delay);
}

function stabilizeUi() {
  scheduleRefresh(0);
  setTimeout(() => scheduleRefresh(0), 120);
  setTimeout(() => scheduleRefresh(0), 350);
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

  stabilizeUi();
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
  stabilizeUi();
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
  stabilizeUi();
  alert(`${sheetKey} 재사용 요청을 거절했습니다.`);
}

function wrapUiTransition(name) {
  const original = window[name];
  if (typeof original !== "function" || original.__stableGroupReviewWrapped) return;

  const wrapped = async function() {
    try {
      return await original.apply(this, arguments);
    } finally {
      stabilizeUi();
    }
  };
  wrapped.__stableGroupReviewWrapped = true;
  window[name] = wrapped;
}

function installActionsAndWrappers() {
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

  [
    "saveGroupReviewSheet",
    "completeGroupReviewUse",
    "selectGroupReviewProject",
    "selectGroupReviewSheet",
    "selectGroupReviewMember",
    "startGroupReviewUse",
    "completeGroupReviewReview",
    "reopenGroupReviewReview",
    "refreshGroupReviewWorkerView"
  ].forEach(wrapUiTransition);
}

function installObserver() {
  if (observerInstalled) return;
  const body = document.getElementById("groupReviewBody");
  const badges = document.getElementById("groupReviewProjectBadges");
  if (!body && !badges) {
    setTimeout(installObserver, 100);
    return;
  }

  const observer = new MutationObserver(mutations => {
    if (patching) return;
    const relevant = mutations.some(mutation =>
      mutation.type === "childList" ||
      (mutation.type === "attributes" && ["style", "disabled"].includes(mutation.attributeName))
    );
    if (relevant) scheduleRefresh();
  });

  if (body) observer.observe(body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "disabled"]
  });
  if (badges) observer.observe(badges, { childList: true, subtree: true });
  observerInstalled = true;
}

function install() {
  if (installed) return;
  const apps = getApps();
  const compatReady = typeof window.refreshGroupReviewWorkerView === "function";
  const workflowReady = typeof window.completeGroupReviewUse === "function"
    && typeof window.completeGroupReviewReview === "function"
    && typeof window.saveGroupReviewSheet === "function";

  if (!apps.length || !compatReady || !workflowReady) {
    setTimeout(install, 100);
    return;
  }

  db = getFirestore(apps[0]);
  auth = getAuth(apps[0]);
  installed = true;
  installActionsAndWrappers();
  installObserver();

  onAuthStateChanged(auth, () => {
    projectCacheLoaded = false;
    projectCache.clear();
    stabilizeUi();
  });

  stabilizeUi();
}

install();
