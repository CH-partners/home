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
let pendingReuseCache = { projectId: "", keys: new Set(), loadedAt: 0 };

const PENDING_REUSE_TTL_MS = 10000;

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

function activeMemberKey() {
  return sessionStorage.getItem(ACTIVE_MEMBER_KEY) || "";
}

function currentSheetKey() {
  const activeTab = document.querySelector("#groupReviewBody .review-sheet-btn.active");
  return cleanSheetName(activeTab?.textContent || "")
    || activeMemberKey()
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

async function readPendingReuseSheets(projectId, force = false) {
  if (!projectId) return new Set();
  if (!force
    && pendingReuseCache.projectId === projectId
    && Date.now() - pendingReuseCache.loadedAt < PENDING_REUSE_TTL_MS) {
    return pendingReuseCache.keys;
  }

  const snap = await getDocs(collection(db, "groupReviewProjects", projectId, "sheets"));
  const keys = new Set();
  snap.forEach(sheetDoc => {
    const data = sheetDoc.data() || {};
    if (data.reuseRequested && data.completed) keys.add(sheetDoc.id);
  });

  pendingReuseCache = { projectId, keys, loadedAt: Date.now() };
  return keys;
}

function invalidatePendingReuseCache() {
  pendingReuseCache = { projectId: "", keys: new Set(), loadedAt: 0 };
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

  // 재사용 요청은 열람 중인 시트가 아니라 본인 시트를 대상으로 하므로 따로 읽는다.
  const ownKey = activeMemberKey();
  const ownSheet = sheetKey === ownKey;
  let own = sheet;
  if (!ownSheet && ownKey) {
    const ownSnap = await getDoc(doc(db, "groupReviewProjects", projectId, "sheets", ownKey));
    own = ownSnap.data() || {};
  }

  return {
    projectId,
    sheetKey,
    ownSheet,
    ownKey,
    projectCompleted: Boolean(project.completed),
    completed: Boolean(sheet.completed),
    reviewCompleted: Boolean(sheet.reviewCompleted),
    reuseRequested: Boolean(sheet.reuseRequested),
    ownCompleted: Boolean(ownKey && own.completed),
    ownReuseRequested: Boolean(ownKey && own.reuseRequested)
  };
}

// 아래 setter들은 값이 바뀔 때만 DOM을 건드린다.
// MutationObserver가 style/disabled 변경을 감시하므로 무조건 대입하면 갱신 루프가 생긴다.
function setStyle(el, prop, value) {
  if (el.style[prop] !== value) el.style[prop] = value;
}

function setDisabled(el, value) {
  if (el.disabled !== value) el.disabled = value;
}

function setText(el, value) {
  if (el.textContent !== value) el.textContent = value;
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

  const viewingOther = !state.ownSheet;
  const locked = viewingOther || Boolean(state.completed || state.projectCompleted);

  body.querySelectorAll('button[onclick="reopenGroupReviewUse()"]')
    .forEach(button => {
      setStyle(button, "display", "none");
      setDisabled(button, true);
    });

  allWorkerSaveButtons(body).forEach(button => {
    setText(button, "수정요청");
    setDisabled(button, locked);
    if (button.closest("#groupReviewBody")) {
      setStyle(button, "display", viewingOther ? "none" : "");
    }
  });

  body.querySelectorAll('button[onclick="completeGroupReviewUse()"]')
    .forEach(button => {
      setText(button, "입력 완료");
      setDisabled(button, locked);
      setStyle(button, "display", locked ? "none" : "");
    });

  body.querySelectorAll('button[onclick="addGroupReviewRow()"]')
    .forEach(button => {
      setDisabled(button, locked);
      setStyle(button, "display", viewingOther ? "none" : "");
    });

  // 재사용 요청 버튼은 열람 중인 시트가 아니라 본인 시트 상태를 따른다.
  let reuseButton = body.querySelector(".review-worker-reuse-request");
  if (!state.ownCompleted || state.projectCompleted) {
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

  setStyle(reuseButton, "display", "");
  setDisabled(reuseButton, state.ownReuseRequested);
  setText(reuseButton, state.ownReuseRequested ? "재사용 요청중" : "재사용 요청");
  reuseButton.title = state.ownReuseRequested
    ? "관리자가 승인하면 입력칸이 다시 열립니다."
    : `${state.ownKey} 시트를 다시 입력할 수 있도록 관리자에게 요청합니다.`;
  reuseButton.onclick = state.ownReuseRequested ? null : () => window.requestGroupReviewReuse?.();

  body.querySelectorAll(".review-use-controls span").forEach(span => {
    if (!span.textContent.includes("입력 완료 상태")) return;
    const nextTail = state.ownReuseRequested
      ? "재사용 요청을 보냈고 관리자 승인을 기다리는 중입니다."
      : "다시 입력하려면 재사용 요청을 누르세요.";
    span.innerHTML = span.innerHTML.replace("확인 체크만 가능합니다.", nextTail);
  });
}

// 탭 라벨 텍스트는 시트키 판별에 쓰이므로 건드리지 않고 테두리와 title로만 표시한다.
function markPendingReuseTabs(body, pendingKeys) {
  body.querySelectorAll(".review-sheet-btn").forEach(tab => {
    const pending = pendingKeys.has(cleanSheetName(tab.textContent || ""));
    if (tab.classList.contains("review-reuse-pending") === pending) return;

    tab.classList.toggle("review-reuse-pending", pending);
    setStyle(tab, "boxShadow", pending ? "inset 0 0 0 2px #f97316" : "");
    if (pending) tab.title = "재사용 요청 대기 중";
    else tab.removeAttribute("title");
  });
}

function renderPendingReuseSummary(body, pendingKeys) {
  const tabs = body.querySelector(".review-sheet-tabs");
  let summary = body.querySelector(".review-reuse-pending-summary");

  if (!tabs || !pendingKeys.size) {
    summary?.remove();
    return;
  }

  if (!summary) {
    summary = document.createElement("div");
    summary.className = "note review-reuse-pending-summary";
    summary.style.fontWeight = "700";
    summary.style.margin = "4px 0";
    tabs.parentNode?.insertBefore(summary, tabs);
  }

  setText(summary, `재사용 요청 대기: ${[...pendingKeys].join(", ")} (해당 탭에서 승인하세요)`);
}

function patchAdminUi(state, pendingKeys) {
  const body = document.getElementById("groupReviewBody");
  if (!body) return;

  const upper = body.querySelector(".review-admin-actions");
  if (upper) setStyle(upper, "display", "none");

  body.querySelectorAll('button[onclick="addGroupReviewRow()"], button[onclick="completeGroupReviewUse()"], button[onclick="reopenGroupReviewUse()"]')
    .forEach(button => setStyle(button, "display", "none"));

  markPendingReuseTabs(body, pendingKeys);
  renderPendingReuseSummary(body, pendingKeys);

  const actions = body.querySelector(".work-header-actions");
  if (!actions) return;

  // 매번 지웠다 다시 붙이면 MutationObserver가 계속 재갱신을 돌리므로 한 번만 만들고 값만 고친다.
  const showReuseActions = Boolean(state.completed && state.reuseRequested && !state.projectCompleted);
  const existing = actions.querySelectorAll(".review-admin-reuse-action, .review-admin-reuse-note");

  if (!showReuseActions) {
    existing.forEach(node => node.remove());
    return;
  }

  if (!existing.length) {
    const note = document.createElement("span");
    note.className = "note review-admin-reuse-note";
    note.style.fontWeight = "700";

    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "action-btn review-admin-reuse-action";
    approve.textContent = "재사용 승인";
    approve.title = "승인하면 작업자의 입력칸이 다시 열립니다.";
    approve.onclick = () => window.approveGroupReviewReuse?.();

    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "action-btn danger review-admin-reuse-action";
    reject.textContent = "요청 거절";
    reject.onclick = () => window.rejectGroupReviewReuse?.();

    actions.appendChild(note);
    actions.appendChild(approve);
    actions.appendChild(reject);
  }

  const note = actions.querySelector(".review-admin-reuse-note");
  if (note) setText(note, `${state.sheetKey} 재사용 요청 대기 중`);
}

async function applyFinalUi() {
  if (!installed || !db || patching) return;
  patching = true;
  try {
    const state = await readCurrentState();
    if (!state) return;
    if (isAdminUser()) {
      const pendingKeys = await readPendingReuseSheets(state.projectId);
      patchAdminUi(state, pendingKeys);
    } else {
      patchWorkerUi(state);
    }
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
  // 다른 작업자 시트를 열람 중이어도 요청 대상은 항상 본인 시트다.
  const sheetKey = activeMemberKey();
  if (!projectId || !sheetKey) throw new Error("재사용 요청할 본인 시트를 찾을 수 없습니다.");

  const requestedAt = new Date().toISOString();
  const requestedBy = sheetKey;

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

// 재사용 승인은 관리자가 이미 확인 완료한 행은 잠근 채로 두고,
// 아직 확인되지 않은 제출행만 작성중으로 되돌려 작업자가 다시 고칠 수 있게 한다.
function reopenRowsForWorker(rows) {
  if (!Array.isArray(rows)) return { rows: [], reopened: 0 };

  let reopened = 0;
  const next = rows.map(row => {
    const status = String(row?.reviewStatus || "").trim();
    const approved = status === "approved" || (!status && row?.checked);
    if (approved || status === "revision_requested") return row;

    const hasValue = [
      row?.collateralNo,
      row?.sheet,
      row?.fieldNo,
      row?.changeBeforeText,
      row?.changeAfterText,
      row?.changeText
    ].some(value => String(value || "").trim() !== "");
    if (!hasValue) return row;

    reopened += 1;
    return {
      ...row,
      checked: false,
      reviewStatus: "draft",
      submittedAt: "",
      submittedBy: "",
      reviewedAt: "",
      reviewedByEmail: ""
    };
  });

  return { rows: next, reopened };
}

async function approveReuse() {
  if (!isAdminUser()) throw new Error("관리자만 재사용 요청을 승인할 수 있습니다.");

  const projectId = await resolveProjectId();
  const sheetKey = currentSheetKey();
  if (!projectId || !sheetKey) throw new Error("재사용 승인할 작업자 시트를 찾을 수 없습니다.");

  const approvedAt = new Date().toISOString();
  const reviewer = auth?.currentUser?.email || "";
  let reopenedCount = 0;

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

    const { rows, reopened } = reopenRowsForWorker(sheet.rows);
    reopenedCount = reopened;

    transaction.set(sheetRef, {
      rows,
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

  invalidatePendingReuseCache();
  if (typeof window.refreshGroupReviewWorkerView === "function") {
    await window.refreshGroupReviewWorkerView();
  }
  stabilizeUi();
  alert(`${sheetKey} 재사용 요청을 승인했습니다. 확인 완료된 행은 잠긴 채로 두고 미확인 ${reopenedCount}건을 다시 입력할 수 있게 열었습니다.`);
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

  invalidatePendingReuseCache();
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
    invalidatePendingReuseCache();
    stabilizeUi();
  });

  stabilizeUi();
}

install();
