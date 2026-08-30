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
let menuData = [];
let noticeData = {
  title: "공지 제목",
  date: "",
  html: "<li>공지 내용이 없습니다.</li>"
};
let navGroupState = {};
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

function isQnaMenu(menu) {
  const title = (menu.title || "").trim();
  if (title === "경매참고비고" || title === "감정평가비고") return false;
  const qnaPanelIndexes = [4, 5, 6, 7, 8, 9];
  return qnaPanelIndexes.includes(Number(menu.panelIndex));
}

function getMenuGroup(menu) {
  if (menu.group) return menu.group;
  if (isQnaMenu(menu)) return "qna";
  return "";
}

const dashboardGroups = [
  {
    key: "notice",
    title: "공지사항",
    icon: "📢",
    desc: "공지 및 주요 안내사항"
  },
  {
    key: "tool",
    title: "업무도구",
    icon: "🛠",
    desc: "분배표, 스케줄, 조회·계산 도구"
  },
  {
    key: "qna",
    title: "Q&A",
    icon: "❓",
    desc: "권리분석 관련 질의응답"
  },
  {
    key: "work",
    title: "법정선순위",
    icon: "⚖",
    desc: "임차, 임금, 조세 관련 문구"
  },
  {
    key: "search",
    title: "비고문구",
    icon: "📝",
    desc: "경매, 감정평가, 기타 비고"
  },
  {
    key: "reference",
    title: "공유자료",
    icon: "📚",
    desc: "공유사항, 검토코드, 참고자료"
  }
];

function getDashboardGroupTitle(groupKey) {
  const found = dashboardGroups.find(group => group.key === groupKey);
  return found ? `${found.icon} ${found.title}` : groupKey;
}

function isToolDashboardMenu(menu) {
  const title = (menu.title || "").trim();
  return (
    Number(menu.panelIndex) === 11 ||
    Number(menu.panelIndex) === 12 ||
    Number(menu.panelIndex) === 13 ||
    title === "소액조회" ||
    title.includes("전월세") ||
    title.includes("최우선") ||
    menu.group === "tool"
  );
}

function getMenusByDashboardGroup(groupKey) {
  if (groupKey === "tool") {
    return menuData.filter(isToolDashboardMenu);
  }

  if (groupKey === "work") {
    return menuData.filter(menu => {
      const menuGroup = getMenuGroup(menu);
      return menuGroup === "work" || (
        !menuGroup && [1, 2, 3].includes(Number(menu.panelIndex))
      );
    });
  }

  return menuData.filter(menu => getMenuGroup(menu) === groupKey);
}

function ensureDashboardPanel(groupKey) {
  const main = document.querySelector(".main");
  let panel = document.querySelector(`.sheet-panel[data-dashboard="${groupKey}"]`);

  if (!panel) {
    panel = document.createElement("div");
    panel.className = "sheet-panel dashboard-panel";
    panel.setAttribute("data-dashboard", groupKey);
    panel.innerHTML = `
      <header class="sheet-header">
        <h1>${escapeHtml(getDashboardGroupTitle(groupKey))}</h1>
      </header>
      <section class="dashboard-card-grid" id="dashboardGrid-${groupKey}"></section>
    `;
    main?.appendChild(panel);
  }

  return panel;
}

function showDashboardGroup(groupKey) {
  document.querySelectorAll(".sheet-panel").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));

  const panel = ensureDashboardPanel(groupKey);
  const grid = panel?.querySelector(`#dashboardGrid-${groupKey}`);
  const menus = getMenusByDashboardGroup(groupKey);
  if (!grid) return;

  grid.innerHTML = "";
  if (!menus.length) {
    grid.innerHTML = '<div class="dashboard-empty">등록된 메뉴가 없습니다.</div>';
  } else {
    menus.forEach(menu => grid.appendChild(createDashboardCard(menu)));
  }

  panel?.classList.add("active");
  document.querySelector(`[data-dashboard-nav="${groupKey}"]`)?.classList.add("active");
}

function getMenuIcon(title) {
  title = title || "";
  if (title.includes("분배표")) return "📊";
  if (title.includes("스케줄")) return "📅";
  if (title.includes("그룹리뷰") || title.includes("Group Review")) return "📝";
  if (title.includes("소액")) return "🏠";
  if (title.includes("전월세")) return "🏢";
  if (title.includes("최우선")) return "💰";
  if (title.includes("임대차") || title.includes("임차")) return "💬";
  if (title.includes("보증")) return "📜";
  if (title.includes("채권") || title.includes("피담보")) return "📋";
  if (title.includes("매각")) return "🏷️";
  if (title.includes("임금")) return "⚖️";
  if (title.includes("조세") || title.includes("당해세")) return "🏛️";
  if (title.includes("경매")) return "✒️";
  if (title.includes("감정")) return "📝";
  if (title.includes("공유")) return "🔥";
  if (title.includes("검토코드")) return "📌";
  if (title.includes("참고")) return "🚨";
  return "📁";
}

function stripLeadingMenuIcon(title) {
  return String(title || "")
    .replace(/^(?:\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\uFE0F?)+\s*/u, "")
    .trim();
}

function createDashboardCard(menu) {
  const card = document.createElement("button");
  card.className = "dashboard-menu-card";

  const title = menu.title || "메뉴";
  const groupKey = getMenuGroup(menu) || "tool";
  const icon = menu.icon || getMenuIcon(title);
  card.innerHTML = `
    <div class="dashboard-card-top ${groupKey}"></div>
    <div class="dashboard-card-body">
      <div class="dashboard-icon">${icon}</div>
      <div class="dashboard-card-title">${escapeHtml(title)}</div>
      <div class="dashboard-card-desc">클릭하여 이동</div>
    </div>
  `;

  card.onclick = () => {
    if (menu.kind === "iframe" && menu.url) {
      const panelIndex = Number(menu.panelIndex || 10);
      let panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);
      if (!panel) {
        panel = document.createElement("div");
        panel.className = "sheet-panel";
        panel.setAttribute("data-index", String(panelIndex));
        panel.innerHTML = `
          <header class="sheet-header"><h1>${escapeHtml(menu.title || "외부페이지")}</h1></header>
          <section class="major-card iframe-card"><iframe class="tool-frame" src="${escapeHtml(menu.url)}"></iframe></section>
        `;
        document.querySelector(".main")?.appendChild(panel);
      } else {
        const frame = panel.querySelector("iframe");
        if (frame) frame.src = menu.url;
      }
    }

    if (Number(menu.panelIndex) === 11) {
      window.allocationApi?.renderAllocationUI();
    }
    showSheet(Number(menu.panelIndex || 0), menu.title);
  };

  return card;
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

function getMenuTitle(menu) {
  return (menu?.title || "").trim();
}

function compactKoreanLabel(value) {
  return String(value || "").replace(/\s+/g, "");
}

function isWorkAllocationTitle(title) {
  const compactTitle = compactKoreanLabel(title);
  return compactTitle === "Project분배표" || compactTitle === "분배표";
}

function isScheduleTitle(title) {
  return compactKoreanLabel(title) === "스케줄";
}

function isGroupReviewTitle(title) {
  const compactTitle = compactKoreanLabel(title);
  return compactTitle === "그룹리뷰" || compactTitle === "GroupReview";
}

function getFixedMenuKind(menu) {
  const title = getMenuTitle(menu);
  const panelIndex = Number(menu?.panelIndex);
  if (isWorkAllocationTitle(title) || (panelIndex === 11 && title === "")) return "work";
  if (isScheduleTitle(title)) return "schedule";
  if (isGroupReviewTitle(title)) return "review";
  return "";
}

function ensureFixedMenus() {
  const fixedWorkMenu = {
    title: "분배표",
    panelIndex: 11,
    location: "bottom",
    kind: "panel",
    theme: "purple"
  };
  const fixedScheduleMenu = {
    title: "스케줄",
    panelIndex: 12,
    location: "bottom",
    kind: "panel",
    theme: "purple"
  };
  const fixedReviewMenu = {
    title: "그룹리뷰",
    panelIndex: 13,
    location: "bottom",
    kind: "panel",
    theme: "blue"
  };

  menuData = menuData.filter(menu => {
    const fixedKind = getFixedMenuKind(menu);
    if (fixedKind === "work" && Number(menu.panelIndex) !== 11) return false;
    if (fixedKind === "schedule" && Number(menu.panelIndex) !== 12) return false;
    if (fixedKind === "review" && Number(menu.panelIndex) !== 13) return false;
    return true;
  });

  const hasWorkMenu = menuData.some(menu => Number(menu.panelIndex) === 11 || getFixedMenuKind(menu) === "work");
  const hasScheduleMenu = menuData.some(menu => Number(menu.panelIndex) === 12 || getFixedMenuKind(menu) === "schedule");
  const hasReviewMenu = menuData.some(menu => Number(menu.panelIndex) === 13 || getFixedMenuKind(menu) === "review");

  if (!hasWorkMenu) {
    menuData.push(fixedWorkMenu);
  } else {
    menuData = menuData.map(menu => Number(menu.panelIndex) === 11 || getFixedMenuKind(menu) === "work" ? fixedWorkMenu : menu);
  }

  if (!hasScheduleMenu) {
    menuData.push(fixedScheduleMenu);
  } else {
    menuData = menuData.map(menu => Number(menu.panelIndex) === 12 || getFixedMenuKind(menu) === "schedule" ? fixedScheduleMenu : menu);
  }

  if (!hasReviewMenu) {
    menuData.push(fixedReviewMenu);
  } else {
    menuData = menuData.map(menu => Number(menu.panelIndex) === 13 || getFixedMenuKind(menu) === "review" ? fixedReviewMenu : menu);
  }
}

function createMenuButton(menu, isChild = false) {
  const btn = document.createElement("button");
  btn.className = "nav-item";
  const fixedKind = getFixedMenuKind(menu);
  const isTopToolMenu = !isChild && isToolDashboardMenu(menu);

  if (isChild) btn.classList.add("nav-sub-item");

  if (menu.location === "bottom") {
    if (menu.theme === "purple") btn.classList.add("nav-item-purple");
    else if (menu.theme === "pink") btn.classList.add("nav-item-pink");
    else if (menu.theme === "blue") btn.classList.add("nav-item-blue");
    else btn.classList.add("nav-item-green");
  }

  if (isTopToolMenu) {
    btn.style.justifyContent = "center";
    btn.style.textAlign = "center";
    btn.style.fontWeight = "700";
  }

  if (Number(menu.panelIndex) === 0) {
    btn.classList.add("nav-item-notice");
    btn.textContent = "📢 " + (menu.title || "공지사항");
  } else if (fixedKind === "work") {
    btn.classList.add("nav-item-highlight");
    btn.textContent = "분배표";
  } else if (fixedKind === "schedule") {
    btn.classList.add("nav-item-schedule");
    btn.textContent = "스케줄";
  } else if (fixedKind === "review") {
    btn.classList.add("nav-item-blue", "nav-item-review");
    btn.textContent = "그룹리뷰";
  } else {
    const title = menu.title || "메뉴";
    btn.textContent = isTopToolMenu ? (stripLeadingMenuIcon(title) || "메뉴") : title;
  }

  btn.addEventListener("click", () => {
    if (menu.kind === "iframe" && menu.url) {
      const panelIndex = Number(menu.panelIndex || 10);
      let panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);
      if (!panel) {
        panel = document.createElement("div");
        panel.className = "sheet-panel";
        panel.setAttribute("data-index", String(panelIndex));
        panel.innerHTML = `
          <header class="sheet-header"><h1>${escapeHtml(menu.title || "외부페이지")}</h1></header>
          <section class="major-card iframe-card"><iframe class="tool-frame" src="${escapeHtml(menu.url)}"></iframe></section>
        `;
        document.querySelector(".main")?.appendChild(panel);
      } else {
        const frame = panel.querySelector("iframe");
        if (frame) frame.src = menu.url;
      }
    }
    if (fixedKind === "work") window.allocationApi?.renderAllocationUI();
    if (fixedKind === "review") window.groupReviewApi?.renderGroupReviewUI();
    showSheet(Number(menu.panelIndex || 0), menu.title);
  });

  return btn;
}

window.toggleNavGroup = function(groupKey) {
  navGroupState[groupKey] = !navGroupState[groupKey];
  renderMenus();
};

function renderMenus() {
  ensureFixedMenus();

  const topNav = document.getElementById("topNav");
  const bottomNav = document.getElementById("bottomNav");
  if (!topNav || !bottomNav) return;

  topNav.innerHTML = "";
  bottomNav.innerHTML = "";

  const renderedMenus = new Set();
  const noticeMenu = menuData.find(menu => Number(menu.panelIndex) === 0);

  if (noticeMenu) {
    topNav.appendChild(createMenuButton(noticeMenu));
    renderedMenus.add(noticeMenu);
  }

  const divider1 = document.createElement("div");
  divider1.className = "nav-divider";
  topNav.appendChild(divider1);

  const toolMenus = getMenusByDashboardGroup("tool").filter(menu => !renderedMenus.has(menu));
  toolMenus.forEach(menu => {
    topNav.appendChild(createMenuButton(menu));
    renderedMenus.add(menu);
  });

  dashboardGroups
    .filter(group => group.key !== "notice" && group.key !== "tool")
    .forEach(group => {
      const menus = getMenusByDashboardGroup(group.key).filter(menu => !renderedMenus.has(menu));
      if (!menus.length) return;

      const isExpanded = !!navGroupState[group.key];
      const groupId = `nav-group-${group.key}`;
      const groupToggle = document.createElement("button");
      groupToggle.type = "button";
      groupToggle.className = "nav-group-toggle" + (isExpanded ? " expanded" : "");
      groupToggle.setAttribute("aria-expanded", String(isExpanded));
      groupToggle.setAttribute("aria-controls", groupId);
      groupToggle.innerHTML = `
        <span class="nav-group-label">
          <span aria-hidden="true">${group.icon}</span>
          <span>${escapeHtml(group.title)}</span>
        </span>
        <span class="nav-group-arrow" aria-hidden="true">▶</span>
      `;
      groupToggle.addEventListener("click", () => window.toggleNavGroup(group.key));
      topNav.appendChild(groupToggle);

      const groupWrap = document.createElement("div");
      groupWrap.id = groupId;
      groupWrap.className = "nav-sub-group" + (isExpanded ? "" : " collapsed");
      groupWrap.hidden = !isExpanded;

      menus.forEach(menu => {
        groupWrap.appendChild(createMenuButton(menu, true));
        renderedMenus.add(menu);
      });
      topNav.appendChild(groupWrap);
    });

  const ungroupedMenus = menuData.filter(menu => !renderedMenus.has(menu));
  if (ungroupedMenus.length) {
    const extraDivider = document.createElement("div");
    extraDivider.className = "nav-divider";
    topNav.appendChild(extraDivider);
    ungroupedMenus.forEach(menu => topNav.appendChild(createMenuButton(menu)));
  }
}

function renderNotice() {
  document.getElementById("noticeTitle").textContent = noticeData.title || "공지 제목";
  document.getElementById("noticeDate").textContent = "기준일: " + (noticeData.date || "-");

  const wrap = document.getElementById("noticeItems");
  if (!wrap) return;
  const html = (noticeData.html || "").trim();
  if (!html) {
    wrap.innerHTML = "<li>공지 내용이 없습니다.</li>";
    return;
  }
  const hasBlockTags = /<(li|ul|ol|p|div|h[1-6]|blockquote)/i.test(html);
  wrap.innerHTML = hasBlockTags ? html : `<li>${html}</li>`;
}

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

renderMenus();
renderNotice();
window.scheduleApi.initCalendar();
window.scheduleApi.subscribeSchedules();
showSheet(0, "청현 공지사항");