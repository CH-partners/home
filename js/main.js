import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection, addDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { initAllocation } from "./allocation.js";
import { initSchedule } from "./schedule.js";
import { initGroupReview } from "./groupReview.js";

const firebaseConfig = {
  apiKey: "AIzaSyDr_SfWtjfRPqfguJ6yvwBo-e3r8bGAs_M",
  authDomain: "ch-partners-71452.firebaseapp.com",
  projectId: "ch-partners-71452",
  storageBucket: "ch-partners-71452.firebasestorage.app",
  messagingSenderId: "837806797750",
  appId: "1:837806797750:web:133c57b81342bdba8b8717",
  measurementId: "G-DFL4DRH7L6"
};

const ADMIN_EMAILS = [
  "admin@admin.com",
  "eastspring1979@gmail.com",
  "sora@jeju.com"
].map(v => v.toLowerCase());

const REVIEW_EMAILS = [
  "review@ch.com"
].map(v => v.toLowerCase());

const fixedMembers = [
  "남기범", "김학년", "이중근", "이동훈", "임기철",
  "우창균", "정동춘", "김현경", "김소라", "손성민", "심아영"
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const allocationRef = doc(db, "sharedPages", "workAllocation");
const editLogsColRef = collection(db, "editLogs");

let currentUser = null;
let workspaceFullscreen = false;

function removeUndefinedDeep(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefinedDeep);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, removeUndefinedDeep(v)])
    );
  }
  return value;
}

function isAdmin(user) {
  return !!(user && ADMIN_EMAILS.includes((user.email || "").toLowerCase()));
}

function isReviewUser(user) {
  return !!(user && REVIEW_EMAILS.includes((user.email || "").toLowerCase()));
}

function canUseGroupReview(user) {
  return isAdmin(user) || isReviewUser(user);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function addEditLog(type, target, action) {
  try {
    await addDoc(editLogsColRef, {
      type,
      target,
      action,
      user: currentUser?.email || "unknown",
      time: new Date().toISOString()
    });
  } catch (error) {
    console.error("수정로그 저장 실패:", error);
  }
}

function updateAdminUI() {
  const admin = isAdmin(currentUser);
  const review = isReviewUser(currentUser);
  document.getElementById("adminStatus").textContent = admin
    ? `관리자 로그인됨: ${currentUser.email}`
    : review
      ? `리뷰 로그인됨: ${currentUser.email}`
      : "로그인 전";
  document.getElementById("loginBtn").classList.toggle("hidden", !!currentUser);
  document.getElementById("logoutBtn").classList.toggle("hidden", !currentUser);
  document.getElementById("menuEditBtn").classList.toggle("hidden", !admin);
  document.getElementById("logBtn")?.classList.toggle("hidden", !admin);
  document.getElementById("noticeEditBtn").classList.toggle("hidden", !admin);
  window.groupReviewApi?.renderGroupReviewUI();
}

function updateWorkspaceFullscreenUI() {
  document.body.classList.toggle("workspace-fullscreen", workspaceFullscreen);
  const btn = document.getElementById("workspaceFullscreenBtn");
  if (btn) {
    btn.textContent = workspaceFullscreen ? "원래 화면" : "오른쪽 창 전체화면";
    btn.classList.toggle("active", workspaceFullscreen);
  }
  requestAnimationFrame(() => {
    window.groupReviewApi?.fitTextareas?.();
    window.scheduleApi?.updateSize?.();
  });
}

window.toggleWorkspaceFullscreen = function() {
  workspaceFullscreen = !workspaceFullscreen;
  updateWorkspaceFullscreenUI();
};

window.addEventListener("keydown", event => {
  if (event.key === "Escape" && workspaceFullscreen) {
    workspaceFullscreen = false;
    updateWorkspaceFullscreenUI();
  }
});

function showSheet(index, title = "") {
  document.querySelectorAll(".sheet-panel").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  const panel = document.querySelector('.sheet-panel[data-index="' + index + '"]');
  if (panel) panel.classList.add("active");
  const matchedButton = Array.from(document.querySelectorAll(".nav-item"))
    .find(btn => btn.textContent.trim() === title || btn.textContent.trim().includes(title));
  if (matchedButton) matchedButton.classList.add("active");
  if (Number(index) === 12 && window.scheduleApi) {
    requestAnimationFrame(() => window.scheduleApi.updateSize());
  }
  if (Number(index) === 13) {
    window.groupReviewApi?.requireMemberSelection?.();
  }
}
window.showSheet = showSheet;

function openModal(id) { document.getElementById(id)?.classList.add("show"); }
function closeModal(id) { document.getElementById(id)?.classList.remove("show"); }
let logUnsubscribe = null;

window.openLogModal = function() {
  if (!isAdmin(currentUser)) return alert("관리자만 볼 수 있습니다.");

  openModal("logModal");
  const logList = document.getElementById("logList");
  if (!logList) return;
  logList.innerHTML = "로그를 불러오는 중입니다.";

  if (logUnsubscribe) logUnsubscribe();
  const qRef = query(editLogsColRef, orderBy("time", "desc"));

  logUnsubscribe = onSnapshot(qRef, snap => {
    if (snap.empty) {
      logList.innerHTML = "수정로그가 없습니다.";
      return;
    }

    logList.innerHTML = snap.docs.map(docSnap => {
      const log = docSnap.data() || {};
      const date = log.time ? new Date(log.time).toLocaleString("ko-KR") : "-";
      return `
        <div style="padding:10px 0; border-bottom:1px solid #e5e7eb;">
          <div><strong>${escapeHtml(log.type || "-")}</strong> / ${escapeHtml(log.target || "-")}</div>
          <div>작업: ${escapeHtml(log.action || "-")}</div>
          <div>사용자: ${escapeHtml(log.user || "-")}</div>
          <div>시간: ${escapeHtml(date)}</div>
        </div>
      `;
    }).join("");
  }, error => {
    console.error("수정로그 불러오기 실패:", error);
    logList.innerHTML = "수정로그 불러오기 실패: " + escapeHtml(error.message || error);
  });
};

window.closeLogModal = function() {
  if (logUnsubscribe) {
    logUnsubscribe();
    logUnsubscribe = null;
  }
  closeModal("logModal");
};

window.openLoginModal = () => openModal("loginModal");
window.closeLoginModal = () => closeModal("loginModal");

window.loginAdmin = async function() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (!isAdmin(cred.user) && !isReviewUser(cred.user)) {
      await signOut(auth);
      alert("등록된 관리자 또는 리뷰 계정이 아닙니다.");
      return;
    }
    closeModal("loginModal");
    document.getElementById("loginPassword").value = "";
  } catch (e) {
    alert("로그인 실패: " + (e.message || e));
  }
};

window.logoutAdmin = async function() {
  await signOut(auth);
};

async function ensureInitialData() {
  try {
    const allocationSnap = await getDoc(allocationRef);
    if (!allocationSnap.exists()) {
      await setDoc(allocationRef, removeUndefinedDeep({ members: fixedMembers, projects: [] }));
    }
  } catch (error) {
    console.error("Project 분배표 초기 데이터 생성 실패:", error);
  }
}

onAuthStateChanged(auth, async user => {
  currentUser = user;
  updateAdminUI();
  if (isAdmin(user)) {
    await ensureInitialData();
  } else {
    window.allocationApi?.renderAllocationUI();
  }
  window.groupReviewApi?.renderGroupReviewUI();
});

window.allocationApi = initAllocation({
  allocationRef,
  fixedMembers,
  isAdmin,
  escapeHtml,
  removeUndefinedDeep,
  getCurrentUser: () => currentUser
});

window.scheduleApi = initSchedule({
  db,
  isAdmin,
  escapeHtml,
  removeUndefinedDeep,
  addEditLog,
  openModal,
  closeModal,
  getCurrentUser: () => currentUser
});

window.groupReviewApi = initGroupReview({
  db,
  fixedMembers,
  isAdmin,
  canUseGroupReview,
  escapeHtml,
  removeUndefinedDeep,
  getCurrentUser: () => currentUser
});

window.scheduleApi.initCalendar();
window.scheduleApi.subscribeSchedules();
showSheet(0, "청현 공지사항");