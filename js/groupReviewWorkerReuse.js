import { getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getDoc,
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
const SESSION_KEY = "groupReviewSessionId";

let db = null;
let auth = null;
let installed = false;
let observerInstalled = false;
let refreshTimer = null;
let stateCache = null;
let stateCacheAt = 0;
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

async function resolveProjectId() {
  const activeBadge = document.querySelector("#groupReviewProjectBadges .work-badge.active");
  const onclick = activeBadge?.getAttribute("onclick") || "";
  const directMatch = onclick.match(/selectGroupReviewProject\((['\"])(.*?)\1\)/);
  if (directMatch?.[2]) return directMatch[2];

  const name = currentProjectName();
  if (!name) return "";

  const projectsSnap = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js")
    .then(({ collection, getDocs }) => getDocs(collection(db, "groupReviewProjects")));
  let found = "";
  projectsSnap.forEach(projectDoc => {
    if (found) return;
    const data = projectDoc.data() || {};
    if (String(data.name || projectDoc.id) === name) found = projectDoc.id;
  });
  return found;
}

async function readCurrentState(force = false) {
  if (!db || isAdminUser()) return null;
  const now = Date.now();
  if (!force && stateCache && now - stateCacheAt < 1000) return stateCache;

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
    reviewCompleted: Boolean(sheet.reviewCompleted)
  };
  stateCacheAt = now;
  return stateCache;
}

function findWorkerCompleteButtons() {
  const body = document.getElementById("groupReviewBody");
  if (!body) return [];
  return Array.from(body.querySelectorAll('button[onclick="completeGroupReviewUse()"], button.review-worker-reuse-action'));
}

async function applyWorkerReuseUi(force = false) {
  if (!installed || isAdminUser()) return;
  const state = await readCurrentState(force);
  if (!state) return;

  findWorkerCompleteButtons().forEach(button => {
    if (state.completed && !state.reviewCompleted && !state.projectCompleted) {
      button.style.display = "";
      button.disabled = false;
      button.textContent = "재사용";
      button.classList.add("review-worker-reuse-action");
      button.removeAttribute("onclick");
      button.onclick = () => window.reuseGroupReviewUse?.();
      return;
    }

    button.classList.remove("review-worker-reuse-action");
    button.onclick = null;
    button.setAttribute("onclick", "completeGroupReviewUse()");
    if (!state.completed) {
      button.style.display = "";
      button.disabled = false;
      button.textContent = "입력 완료";
    }
  });
}

function scheduleUiRefresh(force = false) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void applyWorkerReuseUi(force).catch(error =>
      console.warn("그룹리뷰 재사용 UI 갱신 실패:", error)
    );
  }, 120);
}

async function reuseWorkerSheet() {
  if (isAdminUser()) throw new Error("작업자만 재사용할 수 있습니다.");

  const projectId = await resolveProjectId();
  const sheetKey = currentSheetKey();
  if (!projectId || !sheetKey) throw new Error("재사용할 작업자 시트를 찾을 수 없습니다.");

  const activeMember = sessionStorage.getItem(ACTIVE_MEMBER_KEY) || sheetKey;
  const sessionId = localStorage.getItem(SESSION_KEY) || "";
  const reopenedAt = new Date().toISOString();

  await runTransaction(db, async transaction => {
    const projectRef = doc(db, "groupReviewProjects", projectId);
    const sheetRef = doc(db, "groupReviewProjects", projectId, "sheets", sheetKey);
    const [projectSnap, sheetSnap] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(sheetRef)
    ]);

    const project = projectSnap.data() || {};
    const sheet = sheetSnap.data() || {};

    if (project.completed) throw new Error("프로젝트 완료 상태에서는 재사용할 수 없습니다.");
    if (sheet.reviewCompleted) throw new Error("관리자 리뷰 완료 후에는 재사용할 수 없습니다. 관리자 리뷰 재개가 필요합니다.");
    if (!sheet.completed) throw new Error("현재 시트는 이미 작업 가능한 상태입니다.");

    transaction.set(sheetRef, {
      completed: false,
      lockSessionId: sessionId,
      lockedBy: activeMember,
      lockedAt: reopenedAt,
      updatedAt: reopenedAt,
      updatedBy: activeMember,
      updatedByEmail: auth?.currentUser?.email || ""
    }, { merge: true });
  });

  sessionStorage.setItem(ACTIVE_MEMBER_KEY, sheetKey);
  sessionStorage.setItem(SELECTED_MEMBER_KEY, sheetKey);
  stateCache = null;
  stateCacheAt = 0;

  if (typeof window.refreshGroupReviewWorkerView === "function") {
    await window.refreshGroupReviewWorkerView();
  }
  scheduleUiRefresh(true);
  alert("재사용 상태로 전환되었습니다. 기존 제출행은 잠긴 상태로 유지되고 새 행을 추가해 작업할 수 있습니다.");
}

function installObserver() {
  if (observerInstalled) return;
  const body = document.getElementById("groupReviewBody");
  const badges = document.getElementById("groupReviewProjectBadges");
  if (!body && !badges) return;

  const observer = new MutationObserver(mutations => {
    const structural = mutations.some(mutation => mutation.type === "childList");
    if (structural) scheduleUiRefresh(true);
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
    stateCache = null;
    stateCacheAt = 0;
    scheduleUiRefresh(true);
  };

  window.reuseGroupReviewUse = async function() {
    try {
      await reuseWorkerSheet();
    } catch (error) {
      console.error("그룹리뷰 재사용 실패:", error);
      alert("재사용 실패: " + (error.message || error));
    }
  };

  installed = true;
  installObserver();
  scheduleUiRefresh(true);
}

install();
