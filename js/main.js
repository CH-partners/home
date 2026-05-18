import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection, addDoc, updateDoc, deleteDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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
  "eastspring1979@gmail.com"
].map(v => v.toLowerCase());

const fixedMembers = [
  "남기범", "김학년", "이중근", "이동훈", "임기철",
  "우창균", "정동춘", "김현경", "김소라", "손성민", "심아영"
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const settingsRef = doc(db, "sharedPages", "mainSettings");
const allocationRef = doc(db, "sharedPages", "workAllocation");
const schedulesColRef = collection(db, "schedules");
const editLogsColRef = collection(db, "editLogs");

let currentUser = null;
let currentContentPanelKey = null;
let noticeEditor = null;
let contentEditor = null;
let calendar = null;
let scheduleUnsubscribe = null;
let currentScheduleEventId = null;
let currentContentTableData = {
  enabled: false,
  rows: []
};
let menuData = [];
let noticeData = {
  title: "공지 제목",
  date: "",
  html: "<li>공지 내용이 없습니다.</li>"
};
let allocationData = {
  members: [...fixedMembers],
  projects: []
};
let selectedProjectId = null;
let navGroupState = { qna: false };
let scheduleEvents = [];

const defaultMenus = [
  { title: "청현 공지사항", panelIndex: 0, location: "top", kind: "panel" },
  { title: "임대차", panelIndex: 1, location: "top", kind: "panel" },
  { title: "임금", panelIndex: 2, location: "top", kind: "panel" },
  { title: "조세", panelIndex: 3, location: "top", kind: "panel" },
  { title: "선순위임차인Q&A", panelIndex: 4, location: "top", kind: "panel" },
  { title: "보증서Q&A", panelIndex: 5, location: "top", kind: "panel" },
  { title: "피담보채무Q&A", panelIndex: 6, location: "top", kind: "panel" },
  { title: "매각대상여부Q&A", panelIndex: 7, location: "top", kind: "panel" },
  { title: "열람자료Q&A", panelIndex: 8, location: "top", kind: "panel" },
  { title: "기계기구Q&A", panelIndex: 9, location: "top", kind: "panel" },
  { title: "소액조회", panelIndex: 10, location: "bottom", kind: "iframe", url: "주택상가 소액.html" },
  { title: "", panelIndex: 11, location: "bottom", kind: "panel", theme: "purple" },
  { title: "스케줄", panelIndex: 12, location: "bottom", kind: "panel", theme: "purple" }
];

const defaultPageContents = {
  rent: {
    majorTitle: "임대차",
    bodyHtml: `
      <div class="status-card">
        <div class="badge gray">미진행</div>
        <p class="lead-line">1~2. 소액,임차: 담보물 서울특별시 서대문구 창천동 소재 아파트이며, 경매미진행건으로</p>
        <ul class="clean-list">
          <li>등본 상 소유자 거주로 추정되어 미반영 / (상가) - 임대차 관련자료 없어 미반영</li>
          <li>전입세대확인서 상 전입인 소유자로 미반영 / (상가) - 상가건물임대차현황서 상 등록내역 없어 미반영</li>
        </ul>
      </div>
    `,
    tableData: { enabled: false, rows: [] },
    html: `
      <div class="status-card">
        <div class="badge gray">미진행</div>
        <p class="lead-line">1~2. 소액,임차: 담보물 서울특별시 서대문구 창천동 소재 아파트이며, 경매미진행건으로</p>
        <ul class="clean-list">
          <li>등본 상 소유자 거주로 추정되어 미반영 / (상가) - 임대차 관련자료 없어 미반영</li>
          <li>전입세대확인서 상 전입인 소유자로 미반영 / (상가) - 상가건물임대차현황서 상 등록내역 없어 미반영</li>
        </ul>
      </div>
    `
  },
  wage: {
    majorTitle: "임금",
    bodyHtml: `
      <div class="group-title">개인</div>
      <div class="sub-title">- 종기 내</div>
      <p class="body-line">소유자 개인이며, 임금채권자로 추정되는 가압류권자 없어 미반영</p>
    `,
    tableData: { enabled: false, rows: [] },
    html: `
      <div class="group-title">개인</div>
      <div class="sub-title">- 종기 내</div>
      <p class="body-line">소유자 개인이며, 임금채권자로 추정되는 가압류권자 없어 미반영</p>
    `
  },
  tax: {
    majorTitle: "조세",
    bodyHtml: `<p class="body-line">경매열람시 교부청구 순서대로 기입(재산세, 종부세 등 선순위 반영 분 먼저 기재)</p>`,
    tableData: { enabled: false, rows: [] },
    html: `<p class="body-line">경매열람시 교부청구 순서대로 기입(재산세, 종부세 등 선순위 반영 분 먼저 기재)</p>`
  },
  tenantqa: {
    majorTitle: "선순위임차인Q&A",
    bodyHtml: `<p class="body-line">전입세대확인서 상 선순위 전입인 존재하는 바, 현재 유효한 임차인 여부 및 취급 시 임대차 관련자료 송부 부탁 드립니다.</p>`,
    tableData: { enabled: false, rows: [] },
    html: `<p class="body-line">전입세대확인서 상 선순위 전입인 존재하는 바, 현재 유효한 임차인 여부 및 취급 시 임대차 관련자료 송부 부탁 드립니다.</p>`
  },
  guaranteeqa: {
    majorTitle: "보증서Q&A",
    bodyHtml: `<p class="body-line">담보로 제시한 보증서 관련 자료 송부 부탁 드립니다.</p>`,
    tableData: { enabled: false, rows: [] },
    html: `<p class="body-line">담보로 제시한 보증서 관련 자료 송부 부탁 드립니다.</p>`
  },
  securedqa: {
    majorTitle: "피담보채무Q&A",
    bodyHtml: `<p class="body-line">피담보채무범위 확인 부탁 드립니다.</p>`,
    tableData: { enabled: false, rows: [] },
    html: `<p class="body-line">피담보채무범위 확인 부탁 드립니다.</p>`
  },
  saleqa: {
    majorTitle: "매각대상여부Q&A",
    bodyHtml: `<p class="body-line">매각대상 여부 확인 부탁 드립니다.</p>`,
    tableData: { enabled: false, rows: [] },
    html: `<p class="body-line">매각대상 여부 확인 부탁 드립니다.</p>`
  },
  browseqa: {
    majorTitle: "열람자료Q&A",
    bodyHtml: `<p class="body-line">경매열람자료 송부 부탁 드립니다.</p>`,
    tableData: { enabled: false, rows: [] },
    html: `<p class="body-line">경매열람자료 송부 부탁 드립니다.</p>`
  },
  machineqa: {
    majorTitle: "기계기구Q&A",
    bodyHtml: `<p class="body-line">기계기구 수량 재검토 부탁 드립니다.</p>`,
    tableData: { enabled: false, rows: [] },
    html: `<p class="body-line">기계기구 수량 재검토 부탁 드립니다.</p>`
  }
};

let pageContents = structuredClone(defaultPageContents);

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

function updateAdminUI() {
  const admin = isAdmin(currentUser);
  document.getElementById("adminStatus").textContent = admin
    ? `관리자 로그인됨: ${currentUser.email}`
    : "관리자 로그인 전";
  document.getElementById("loginBtn").classList.toggle("hidden", admin);
  document.getElementById("logoutBtn").classList.toggle("hidden", !admin);
  document.getElementById("menuEditBtn").classList.toggle("hidden", !admin);
  document.getElementById("logBtn")?.classList.toggle("hidden", !admin);
  document.getElementById("noticeEditBtn").classList.toggle("hidden", !admin);
  document.querySelectorAll(".panel-edit-btn").forEach(btn => btn.classList.toggle("hidden", !admin));
}

function showSheet(index, title = "") {
  document.querySelectorAll(".sheet-panel").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  const panel = document.querySelector('.sheet-panel[data-index="' + index + '"]');
  if (panel) panel.classList.add("active");
  const matchedButton = Array.from(document.querySelectorAll(".nav-item")).find(btn => btn.textContent.trim() === title || btn.textContent.trim().includes(title));
  if (matchedButton) matchedButton.classList.add("active");
  if (Number(index) === 12 && calendar) {
    requestAnimationFrame(() => calendar.updateSize());
  }
}
window.showSheet = showSheet;

function getDynamicPanelKey(menu) {
  return `panel_${Number(menu.panelIndex)}`;
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

  menuData = menuData.filter(menu => {
    const title = (menu.title || "").trim();
    if ((title === "Project 분배표" || title === "Project분배표" || title === "분배표") && Number(menu.panelIndex) !== 11) return false;
    if (title === "스케줄" && Number(menu.panelIndex) !== 12) return false;
    return true;
  });

  const hasWorkMenu = menuData.some(menu =>
    Number(menu.panelIndex) === 11 ||
    (menu.title || "").trim() === "Project 분배표" ||
    (menu.title || "").trim() === "Project분배표" ||
    (menu.title || "").trim() === "분배표"
  );

  const hasScheduleMenu = menuData.some(menu =>
    Number(menu.panelIndex) === 12 ||
    (menu.title || "").trim() === "스케줄"
  );

  if (!hasWorkMenu) {
    menuData.push(fixedWorkMenu);
  } else {
    menuData = menuData.map(menu => {
      const title = (menu.title || "").trim();
      if (
        Number(menu.panelIndex) === 11 ||
        title === "Project 분배표" ||
        title === "Project분배표" ||
        title === "분배표"
      ) return fixedWorkMenu;
      return menu;
    });
  }

  if (!hasScheduleMenu) {
    menuData.push(fixedScheduleMenu);
  } else {
    menuData = menuData.map(menu => {
      const title = (menu.title || "").trim();
      if (Number(menu.panelIndex) === 12 || title === "스케줄") return fixedScheduleMenu;
      return menu;
    });
  }
}
function createMenuButton(menu, isChild = false) {
  const btn = document.createElement("button");
  btn.className = "nav-item";

  if (isChild) btn.classList.add("nav-sub-item");

  if (menu.location === "bottom") {
    if (menu.theme === "purple") btn.classList.add("nav-item-purple");
    else btn.classList.add("nav-item-green");
  }

  if (Number(menu.panelIndex) === 0) {
    btn.classList.add("nav-item-notice");
    btn.textContent = "📢 " + (menu.title || "공지사항");
  } else if (Number(menu.panelIndex) === 11) {
    btn.classList.add("nav-item-highlight");
    btn.textContent = "📊 분배표";
  } else if (Number(menu.panelIndex) === 12) {
    btn.classList.add("nav-item-schedule");
    btn.textContent = "📅 스케줄";
  } else {
    btn.textContent = menu.title || "메뉴";
  }

  btn.addEventListener("click", () => {
    if (menu.kind === "iframe" && menu.url) {
      const frame = document.querySelector('.sheet-panel[data-index="10"] iframe');
      if (frame) frame.src = menu.url;
    }
    renderAllContents();
    if (Number(menu.panelIndex) === 11) renderAllocationUI();
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

  topNav.innerHTML = "";
  bottomNav.innerHTML = "";

  const topMenus = menuData.filter(menu => menu.location !== "bottom");
  const bottomMenus = menuData.filter(menu => menu.location === "bottom");

  const qnaMenus = topMenus.filter(menu => isQnaMenu(menu));
  const normalMenus = topMenus.filter(menu => !isQnaMenu(menu));

  const noticeMenu = normalMenus.find(m => Number(m.panelIndex) === 0);
  if (noticeMenu) {
    topNav.appendChild(createMenuButton(noticeMenu));
  }

  const divider = document.createElement("div");
  divider.style.height = "1px";
  divider.style.background = "#e5e7eb";
  divider.style.margin = "10px 0";
  topNav.appendChild(divider);

  const orderedBottomMenus = [...bottomMenus].sort((a, b) => {
    const order = {
      "분배표": 0,
      "스케줄": 1,
      "소액조회": 2
    };
    const av = order[a.title] ?? 99;
    const bv = order[b.title] ?? 99;
    return av - bv;
  });

  const badgeWrap = document.createElement("div");
  badgeWrap.style.display = "flex";
  badgeWrap.style.gap = "6px";
  badgeWrap.style.flexWrap = "nowrap";       // 🔥 변경
  badgeWrap.style.overflowX = "auto";        // 🔥 추가
  badgeWrap.style.justifyContent = "flex-start";
  badgeWrap.style.marginBottom = "4px";

  orderedBottomMenus.forEach(menu => {
    badgeWrap.appendChild(createMenuButton(menu));
  });
  topNav.appendChild(badgeWrap);

  if (qnaMenus.length) {
    const isExpanded = !!navGroupState.qna;

    const groupToggle = document.createElement("button");
    groupToggle.className = "nav-group-toggle" + (isExpanded ? " expanded" : "");
    groupToggle.innerHTML = `
      <span class="nav-group-label"><span>Q&A 모음</span></span>
      <span class="nav-group-arrow">▶</span>
    `;
    groupToggle.onclick = () => window.toggleNavGroup("qna");

    topNav.appendChild(groupToggle);

    const groupWrap = document.createElement("div");
    groupWrap.className = "nav-sub-group" + (isExpanded ? "" : " collapsed");

    qnaMenus.forEach(menu => {
      groupWrap.appendChild(createMenuButton(menu, true));
    });

    topNav.appendChild(groupWrap);
  }

  normalMenus
    .filter(m => Number(m.panelIndex) !== 0)
    .forEach(menu => {
      topNav.appendChild(createMenuButton(menu));
    });

  renderAllContents();
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
  if (hasBlockTags) {
    wrap.innerHTML = html;
  } else {
    wrap.innerHTML = `<li>${html}</li>`;
  }
}

function ensureDynamicPanels() {
  const main = document.querySelector(".main");
  if (!main) return;

  const fixedPanelIndexes = new Set([0,1,2,3,4,5,6,7,8,9,10,11,12]);

  menuData.forEach(menu => {
    const panelIndex = Number(menu.panelIndex);
    if (fixedPanelIndexes.has(panelIndex)) return;
    if (menu.kind === "iframe") return;

    let panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);

    if (!panel) {
      panel = document.createElement("div");
      panel.className = "sheet-panel";
      panel.setAttribute("data-index", String(panelIndex));

      panel.innerHTML = `
        <header class="sheet-header">
          <h1>${escapeHtml(menu.title || "메뉴")}</h1>
          <div class="sheet-tools">
            <button class="action-btn hidden panel-edit-btn dynamic-panel-edit-btn" data-dynamic-key="${getDynamicPanelKey(menu)}">내용 수정</button>
          </div>
        </header>
        <section class="major-card"></section>
      `;

      main.appendChild(panel);
    } else {
      const h1 = panel.querySelector("h1");
      if (h1) h1.textContent = menu.title || "메뉴";

      let editBtn = panel.querySelector(".dynamic-panel-edit-btn");
      if (!editBtn) {
        const tools = panel.querySelector(".sheet-tools");
        if (tools) {
          editBtn = document.createElement("button");
          editBtn.className = "action-btn hidden panel-edit-btn dynamic-panel-edit-btn";
          editBtn.textContent = "내용 수정";
          tools.appendChild(editBtn);
        }
      }
      if (editBtn) {
        editBtn.setAttribute("data-dynamic-key", getDynamicPanelKey(menu));
      }
    }

    const panelKey = getDynamicPanelKey(menu);
    if (!pageContents[panelKey]) {
  pageContents[panelKey] = {
    majorTitle: menu.title || "메뉴",
    bodyHtml: `<p>내용을 입력하세요.</p>`,
    tableData: {
      enabled: false,
      rows: []
    },
    html: `<p>내용을 입력하세요.</p>`
  };
}
  });

  document.querySelectorAll(".dynamic-panel-edit-btn").forEach(btn => {
    btn.onclick = () => {
      const key = btn.getAttribute("data-dynamic-key");
      window.openContentEditor(key);
    };
  });
}
  function renderAllContents() {
  const renderMap = {
    rent: "content-rent",
    wage: "content-wage",
    tax: "content-tax",
    tenantqa: "content-tenantqa",
    guaranteeqa: "content-guaranteeqa",
    securedqa: "content-securedqa",
    saleqa: "content-saleqa",
    browseqa: "content-browseqa",
    machineqa: "content-machineqa"
  };

  Object.entries(renderMap).forEach(([key, targetId]) => {
    const el = document.getElementById(targetId);
    const config = pageContents[key];
    if (!el || !config) return;
    el.innerHTML = `
      <div class="major-title">${escapeHtml(config.majorTitle || "")}</div>
      <div class="rich-preview">${config.html || ""}</div>
    `;
  });

  ensureDynamicPanels();

  const fixedPanelIndexes = new Set([0,1,2,3,4,5,6,7,8,9,10,11,12]);

  menuData.forEach(menu => {
    const panelIndex = Number(menu.panelIndex);
    if (fixedPanelIndexes.has(panelIndex)) return;
    if (menu.kind === "iframe") return;

    const panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);
    if (!panel) return;

    const section = panel.querySelector("section.major-card");
    if (!section) return;

    const panelKey = getDynamicPanelKey(menu);
    const config = pageContents[panelKey] || {
      majorTitle: menu.title || "메뉴",
      html: `<p>내용을 입력하세요.</p>`
    };

    section.innerHTML = `
      <div class="major-title">${escapeHtml(config.majorTitle || "")}</div>
      <div class="rich-preview">${config.html || ""}</div>
    `;

    const h1 = panel.querySelector("h1");
    if (h1) h1.textContent = menu.title || "메뉴";
  });

  updateAdminUI();
  renderAllocationUI();
}

function initEditors() {
  const fullToolbar = [
    [{ size: ["small", false, "large", "huge"] }],
    ["bold", "italic", "underline"],
    [{ color: [] }, { background: [] }],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ align: [] }],
    ["link", "clean"]
  ];

  noticeEditor = new Quill("#noticeEditor", {
    theme: "snow",
    modules: { toolbar: fullToolbar }
  });

  contentEditor = new Quill("#contentEditor", {
    theme: "snow",
    modules: { toolbar: fullToolbar }
  });
}

function openModal(id) { document.getElementById(id).classList.add("show"); }
function closeModal(id) { document.getElementById(id).classList.remove("show"); }
let logUnsubscribe = null;

window.openLogModal = function() {
  if (!isAdmin(currentUser)) return alert("관리자만 볼 수 있습니다.");

  openModal("logModal");

  const logList = document.getElementById("logList");
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
      const date = log.time
        ? new Date(log.time).toLocaleString("ko-KR")
        : "-";

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
    logList.innerHTML =
      "수정로그 불러오기 실패: " +
      escapeHtml(error.message || error);
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

window.openNoticeEditor = function() {
  if (!isAdmin(currentUser)) return alert("관리자만 수정할 수 있습니다.");
  document.getElementById("noticeFormTitle").value = noticeData.title || "";
  document.getElementById("noticeFormDate").value = noticeData.date || "";
  noticeEditor.root.innerHTML = noticeData.html || "";
  openModal("noticeModal");
};
window.closeNoticeEditor = function() { closeModal("noticeModal"); };

window.openMenuEditor = function() {
  if (!isAdmin(currentUser)) return alert("관리자만 수정할 수 있습니다.");
  renderMenuTable();
  openModal("menuModal");
};
window.closeMenuEditor = function() { closeModal("menuModal"); };

function renderMenuTable() {
  const tbody = document.getElementById("menuTableBody");
  tbody.innerHTML = "";
  ensureFixedMenus();

  const orderedMenus = [
    ...menuData.filter(menu => (menu.location || "top") !== "bottom"),
    ...menuData.filter(menu => (menu.location || "top") === "bottom")
  ];

  orderedMenus.forEach(menu => {
    const realIndex = menuData.findIndex(item => item === menu);
    const tr = document.createElement("tr");
    const titleTrim = (menu.title || "").trim();
     const isWork =
    Number(menu.panelIndex) === 11 ||
    titleTrim === "Project 분배표" ||
    titleTrim === "Project분배표" ||
    titleTrim === "분배표";
    const isSchedule = Number(menu.panelIndex) === 12 || titleTrim === "스케줄";
    const isFixedMenu = isWork || isSchedule;

    tr.innerHTML = `
      <td>
        <input data-field="location" data-index="${realIndex}" value="${escapeHtml(isFixedMenu ? "bottom" : (menu.location || "top"))}" ${isFixedMenu ? "readonly" : ""}>
      </td>
     <td>
      <input data-field="title" data-index="${realIndex}"
        value="${escapeHtml(
          isWork ? "분배표" :
          isSchedule ? "스케줄" :
          (menu.title || "").includes("소액") ? "소액조회" :
          (menu.title || "")
        )}"
        ${isFixedMenu ? "readonly" : ""}
      >
    </td>
      <td>
        <input data-field="panelIndex" data-index="${realIndex}" value="${escapeHtml(String(isWork ? 11 : isSchedule ? 12 : (menu.panelIndex ?? "")))}" ${isFixedMenu ? "readonly" : ""}>
      </td>
      <td>
        <input data-field="url" data-index="${realIndex}" value="${escapeHtml(isFixedMenu ? "" : (menu.url || ""))}" ${isFixedMenu ? "readonly" : ""}>
      </td>
      <td>
        <div class="menu-row-actions">
          ${
            isFixedMenu
              ? '<span class="note">고정메뉴</span>'
              : (menu.location || "top") === "top"
                ? `
                  <button class="small-btn" onclick="moveMenuUp(${realIndex})">위</button>
                  <button class="small-btn" onclick="moveMenuDown(${realIndex})">아래</button>
                  <button class="small-btn danger" onclick="removeMenuRow(${realIndex})">삭제</button>
                `
                : `
                  <span class="note">하단메뉴</span>
                  <button class="small-btn danger" onclick="removeMenuRow(${realIndex})">삭제</button>
                `
          }
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.addMenuRow = function(location) {
  menuData.push({ title: "", panelIndex: 0, location: location || "top", kind: location === "bottom" ? "iframe" : "panel", url: "" });
  renderMenuTable();
};

window.removeMenuRow = function(index) {
  const target = menuData[index];
  if (!target) return;
  const titleTrim = (target.title || "").trim();
  if (Number(target.panelIndex) === 11 || titleTrim === "Project 분배표") {
    alert("Project 분배표 메뉴는 삭제할 수 없습니다.");
    return;
  }
  if (Number(target.panelIndex) === 12 || titleTrim === "스케줄") {
    alert("스케줄 메뉴는 삭제할 수 없습니다.");
    return;
  }
  menuData.splice(index, 1);
  renderMenuTable();
};

window.moveMenuUp = function(index) {
  const current = menuData[index];
  if (!current || (current.location || "top") !== "top") return;
  for (let i = index - 1; i >= 0; i--) {
    if ((menuData[i].location || "top") === "top") {
      [menuData[i], menuData[index]] = [menuData[index], menuData[i]];
      renderMenuTable();
      return;
    }
  }
};

window.moveMenuDown = function(index) {
  const current = menuData[index];
  if (!current || (current.location || "top") !== "top") return;
  for (let i = index + 1; i < menuData.length; i++) {
    if ((menuData[i].location || "top") === "top") {
      [menuData[i], menuData[index]] = [menuData[index], menuData[i]];
      renderMenuTable();
      return;
    }
  }
};

function syncMenuDataFromTable() {
  const rows = Array.from(document.querySelectorAll("#menuTableBody tr"));
  const previousMenus = [...menuData];

  menuData = rows.map((row) => {
    const firstInput = row.querySelector("[data-index]");
    const realIndex = Number(firstInput?.getAttribute("data-index"));
    const prev = previousMenus[realIndex] || {};

    const getVal = (field) => {
      return row.querySelector(`[data-field="${field}"][data-index="${realIndex}"]`)?.value?.trim() || "";
    };

    const rawTitle = getVal("title");
    const rawPanelIndex = getVal("panelIndex");
    const rawLocation = getVal("location");
    const rawUrl = getVal("url");

    const prevTitle = (prev.title || "").trim();

    const isWorkAllocation =
      rawTitle === "Project 분배표" ||
      rawTitle === "Project분배표" ||
      rawTitle === "분배표" ||
      Number(rawPanelIndex) === 11 ||
      prevTitle === "Project 분배표" ||
      prevTitle === "Project분배표" ||
      prevTitle === "분배표";

    const isSchedule =
      rawTitle === "스케줄" ||
      Number(rawPanelIndex) === 12 ||
      prevTitle === "스케줄";

    const title = isWorkAllocation
      ? "분배표"
      : isSchedule
        ? "스케줄"
        : (rawTitle || prev.title || "");

    const panelIndex = isWorkAllocation
      ? 11
      : isSchedule
        ? 12
        : (rawPanelIndex === "" ? Number(prev.panelIndex || 0) : Number(rawPanelIndex));

    const location = (isWorkAllocation || isSchedule)
      ? "bottom"
      : (rawLocation || prev.location || "top");

    const item = {
      title,
      panelIndex,
      location,
      kind: rawUrl
        ? "iframe"
        : ((isWorkAllocation || isSchedule) ? "panel" : (location === "bottom" ? "iframe" : "panel"))
    };

    if (rawUrl && !(isWorkAllocation || isSchedule)) {
      item.url = rawUrl;
    } else if (!rawUrl && prev.url && item.kind === "iframe") {
      item.url = prev.url;
    }

    if (isWorkAllocation || isSchedule) item.theme = "purple";
    else if (prev.theme) item.theme = prev.theme;

    return item;
  }).filter(menu => (menu.title || "").trim() !== "");

  ensureFixedMenus();
}

window.saveMenusToFirebase = async function() {
  if (!isAdmin(currentUser)) return alert("관리자만 저장할 수 있습니다.");
  syncMenuDataFromTable();
  await setDoc(settingsRef, removeUndefinedDeep({ menus: menuData, notice: noticeData, pageContents }), { merge: true });
  await addEditLog("메뉴", "메뉴 설정", "수정");
  renderMenus();
  
  closeModal("menuModal");
  alert("메뉴가 저장되었습니다.");
};

function getPanelTitleByKey(panelKey) {
  const map = {
    rent: "임대차",
    wage: "임금",
    tax: "조세",
    tenantqa: "선순위임차인Q&A",
    guaranteeqa: "보증서Q&A",
    securedqa: "피담보채무Q&A",
    saleqa: "매각대상여부Q&A",
    browseqa: "열람자료Q&A",
    machineqa: "기계기구Q&A"
  };

  if (map[panelKey]) return map[panelKey];

  if (panelKey.startsWith("panel_")) {
    const idx = Number(panelKey.replace("panel_", ""));
    const found = menuData.find(menu => Number(menu.panelIndex) === idx);
    if (found?.title) return found.title;
  }

  return "내용";
}

window.openContentEditor = function(panelKey) {
  if (!isAdmin(currentUser)) return alert("관리자만 수정할 수 있습니다.");
  currentContentPanelKey = panelKey;

  if (!pageContents[panelKey]) {
    pageContents[panelKey] = {
      majorTitle: getPanelTitleByKey(panelKey),
      html: `<p>내용을 입력하세요.</p>`,
      bodyHtml: `<p>내용을 입력하세요.</p>`,
      tableData: {
        enabled: false,
        rows: []
      }
    };
  }

  const config = pageContents[panelKey];

  if (!config.bodyHtml) {
    config.bodyHtml = config.html || `<p>내용을 입력하세요.</p>`;
  }

  if (!config.tableData) {
    config.tableData = {
      enabled: false,
      rows: []
    };
  }

  document.getElementById("contentModalTitle").textContent = `${getPanelTitleByKey(panelKey)} 내용 수정`;
  document.getElementById("contentMajorTitle").value = config.majorTitle || "";
  contentEditor.root.innerHTML = config.bodyHtml || config.html || "";

  currentContentTableData = deserializeTableData(config.tableData);
  renderContentTableEditor();

  openModal("contentModal");
};
  
window.closeContentEditor = function() { closeModal("contentModal"); };

function syncContentFromEditor() {
  const config = pageContents[currentContentPanelKey];

  config.majorTitle =
    document.getElementById("contentMajorTitle").value.trim() ||
    getPanelTitleByKey(currentContentPanelKey);

  const bodyHtml = contentEditor.root.innerHTML;
  const tableData = serializeTableData(currentContentTableData);
  const tableHtml = buildContentTableHtml(currentContentTableData);

  config.bodyHtml = bodyHtml;
  config.tableData = tableData;
  config.html = bodyHtml + tableHtml;
}

window.saveContentToFirebase = async function() {
  try {
    if (!isAdmin(currentUser)) return alert("관리자만 수정할 수 있습니다.");
    syncContentFromEditor();
    await setDoc(settingsRef, removeUndefinedDeep({ pageContents, menus: menuData, notice: noticeData }), { merge: true });
    await addEditLog("본문", getPanelTitleByKey(currentContentPanelKey), "수정");
    renderAllContents();
    closeModal("contentModal");
    alert("내용이 저장되었습니다.");
  } catch (error) {
    console.error("내용 저장 실패:", error);
    alert("내용 저장 실패: " + (error.message || error));
  }
};

window.saveNoticeToFirebase = async function() {
  try {
    if (!isAdmin(currentUser)) return alert("관리자만 수정할 수 있습니다.");
    noticeData = {
      title: document.getElementById("noticeFormTitle").value.trim() || "공지 제목",
      date: document.getElementById("noticeFormDate").value || "",
      html: noticeEditor.root.innerHTML
    };
    await setDoc(settingsRef, removeUndefinedDeep({ notice: noticeData, menus: menuData, pageContents }), { merge: true });
    await addEditLog("공지사항", noticeData.title, "수정");
    renderNotice();
    closeModal("noticeModal");
    alert("공지사항이 저장되었습니다.");
  } catch (error) {
    console.error("공지 저장 실패:", error);
    alert("공지 저장 실패: " + (error.message || error));
  }
};

window.loginAdmin = async function() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (!isAdmin(cred.user)) {
      await signOut(auth);
      alert("등록된 관리자 계정이 아닙니다.");
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
    const snap = await getDoc(settingsRef);
    if (!snap.exists()) {
      await setDoc(settingsRef, removeUndefinedDeep({
        menus: defaultMenus,
        notice: { title: "공지 제목", date: "", html: "<li>공지 내용이 없습니다.</li>" },
        pageContents: defaultPageContents
      }));
    }
  } catch (error) {
    console.error("초기 데이터 생성 실패:", error);
  }

  try {
    const allocationSnap = await getDoc(allocationRef);
    if (!allocationSnap.exists()) {
      await setDoc(allocationRef, removeUndefinedDeep({ members: fixedMembers, projects: [] }));
    }
  } catch (error) {
    console.error("Project 분배표 초기 데이터 생성 실패:", error);
  }
}

function getSelectedProject() {
  return allocationData.projects.find(p => p.id === selectedProjectId) || null;
}

function createEmptyProject(name) {
  return {
    id: "project_" + Date.now(),
    name,
    columns: [],
    rows: fixedMembers.map(member => ({
      name: member,
      active: true,
      values: {}
    }))
  };
}

window.createProjectPrompt = function() {
  if (!isAdmin(currentUser)) return alert("관리자만 수정할 수 있습니다.");
  const name = prompt("프로젝트 이름을 입력하세요.");
  if (!name || !name.trim()) return;

  const trimmed = name.trim();
  if (allocationData.projects.some(p => p.name === trimmed)) {
    alert("같은 프로젝트명이 이미 있습니다.");
    return;
  }

  const newProject = createEmptyProject(trimmed);
  allocationData.projects.push(newProject);
  selectedProjectId = newProject.id;
  renderAllocationUI();
};

window.addColumnPrompt = function() {
  if (!isAdmin(currentUser)) return alert("관리자만 수정할 수 있습니다.");
  const project = getSelectedProject();
  if (!project) return alert("먼저 프로젝트를 선택하세요.");

  const columnName = prompt("항목명을 입력하세요.");
  if (!columnName || !columnName.trim()) return;

  const trimmed = columnName.trim();
  if (project.columns.includes(trimmed)) {
    alert("같은 항목명이 이미 있습니다.");
    return;
  }

  project.columns.push(trimmed);
  project.rows.forEach(row => {
    row.values[trimmed] = "";
  });

  renderAllocationUI();
};

window.deleteSelectedProject = function() {
  if (!isAdmin(currentUser)) return alert("관리자만 수정할 수 있습니다.");
  const project = getSelectedProject();
  if (!project) return;

  if (!confirm(`"${project.name}" 프로젝트를 삭제하시겠습니까?`)) return;
  allocationData.projects = allocationData.projects.filter(p => p.id !== project.id);
  selectedProjectId = allocationData.projects[0]?.id || null;
  renderAllocationUI();
};

window.selectProject = function(projectId) {
  selectedProjectId = projectId;
  renderAllocationUI();
};

window.updateAllocationCell = function(projectId, rowIndex, columnName, value) {
  const project = allocationData.projects.find(p => p.id === projectId);
  if (!project || !project.rows[rowIndex]) return;
  project.rows[rowIndex].values[columnName] = value;
};

window.saveAllocationData = async function() {
  try {
    if (!isAdmin(currentUser)) return alert("관리자만 저장할 수 있습니다.");
    await setDoc(allocationRef, removeUndefinedDeep(allocationData), { merge: true });
    alert("Project 분배표가 저장되었습니다.");
  } catch (error) {
    console.error("Project 분배표 저장 실패:", error);
    alert("Project 분배표 저장 실패: " + (error.message || error));
  }
};

function renderAllocationUI() {
  const badgeWrap = document.getElementById("workProjectBadges");
  const body = document.getElementById("workAllocationBody");
  if (!badgeWrap || !body) return;

  badgeWrap.innerHTML = "";

  if (!allocationData.projects.length) {
    body.innerHTML = `
      <div class="work-empty">
        생성된 프로젝트가 없습니다.<br>
        상단의 <strong>분배표 생성</strong> 버튼으로 프로젝트를 먼저 만드세요.
      </div>
    `;
    return;
  }

  if (!selectedProjectId || !allocationData.projects.some(p => p.id === selectedProjectId)) {
    selectedProjectId = allocationData.projects[0].id;
  }

  allocationData.projects.forEach(project => {
    const btn = document.createElement("button");
    btn.className = "work-badge" + (project.id === selectedProjectId ? " active" : "");
    btn.textContent = project.name;
    btn.onclick = () => window.selectProject(project.id);
    badgeWrap.appendChild(btn);
  });

  const project = getSelectedProject();
  if (!project) {
    body.innerHTML = `<div class="work-empty">선택된 프로젝트가 없습니다.</div>`;
    return;
  }

  const headers = project.columns.map(col => `<th>${escapeHtml(col)}</th>`).join("");
  const rowsHtml = project.rows.map((row, rowIndex) => {
    const cells = project.columns.map(col => {
      const value = row.values?.[col] ?? "";
      return `<td><input type="text" value="${escapeHtml(value)}" ${isAdmin(currentUser) ? "" : "readonly"} oninput="updateAllocationCell('${project.id}', ${rowIndex}, '${escapeHtml(col)}', this.value)"></td>`;
    }).join("");

    return `
      <tr
        draggable="true"
        ondragstart="dragMemberStart(event, '${project.id}', ${rowIndex})"
        ondragover="dragMemberOver(event)"
        ondrop="dropMemberRow(event, '${project.id}', ${rowIndex})"
        style="${row.active ? '' : 'opacity:0.3'}"
      >
       <td class="drag-member-cell">
          <span class="drag-handle">☰</span>
          <span>${escapeHtml(row.name)}</span>
        
          <button class="member-toggle-btn"
            onclick="toggleMemberActive('${project.id}', ${rowIndex})">
            ${row.active ? '제외' : '참여'}
          </button>
        </td>
        ${cells}
      </tr>
    `;
  }).join("");

  body.innerHTML = `
    <div class="work-project-title">${escapeHtml(project.name)}</div>
    <div class="work-info">첫 번째 열은 이름 고정이며, 두 번째 열부터 항목 추가로 생성됩니다, 마우스드래그로 순서를 변경할수 있습니다.</div>
    <div class="work-header-actions">
      <button class="action-btn" onclick="addColumnPrompt()">항목 추가</button>
      <button class="action-btn" onclick="saveAllocationData()">저장</button>
      <button class="action-btn" onclick="deleteSelectedProject()">프로젝트 삭제</button>
    </div>
    <div class="work-table-wrap">
      <table class="work-table">
        <thead>
          <tr>
            <th>이름</th>
            ${headers}
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}
  
function createDefaultContentTable() {
  return {
    enabled: true,
    rows: [
      ["구분", "내용"],
      ["", ""]
    ]
  };
}

function cloneTableData(data) {
  return {
    enabled: !!data?.enabled,
    rows: Array.isArray(data?.rows)
      ? data.rows.map(row => Array.isArray(row) ? [...row] : [])
      : []
  };
}

function normalizeContentTableRows(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return [["구분", "내용"], ["", ""]];
  }

  const maxCols = Math.max(...rows.map(row => Array.isArray(row) ? row.length : 0), 1);

  return rows.map(row => {
    const safeRow = Array.isArray(row) ? [...row] : [];
    while (safeRow.length < maxCols) safeRow.push("");
    return safeRow;
  });
}
function serializeTableData(tableData) {
  if (!tableData?.enabled) {
    return {
      enabled: false,
      rows: []
    };
  }

  const rows = normalizeContentTableRows(tableData.rows || []);

  return {
    enabled: true,
    rows: rows.map(row => {
      const obj = {};
      row.forEach((cell, idx) => {
        obj[`c${idx}`] = cell ?? "";
      });
      return obj;
    })
  };
}

function deserializeTableData(tableData) {
  if (!tableData?.enabled || !Array.isArray(tableData.rows) || !tableData.rows.length) {
    return {
      enabled: false,
      rows: []
    };
  }

  const rows = tableData.rows.map(rowObj => {
    const keys = Object.keys(rowObj).sort((a, b) => {
      return Number(a.replace("c", "")) - Number(b.replace("c", ""));
    });
    return keys.map(key => rowObj[key] ?? "");
  });

  return {
    enabled: true,
    rows
  };
}
function renderContentTableEditor() {
  const table = document.getElementById("contentTableEditor");
  if (!table) return;

  if (!currentContentTableData.enabled) {
    table.innerHTML = `
      <tbody>
        <tr>
          <td style="padding:16px; color:#64748b;">
            표를 사용하려면 "표 사용" 버튼을 눌러주세요.
          </td>
        </tr>
      </tbody>
    `;
    return;
  }

  currentContentTableData.rows = normalizeContentTableRows(currentContentTableData.rows);
  const rows = currentContentTableData.rows;

  const theadHtml = `
    <thead>
      <tr>
        ${rows[0].map((cell, colIndex) => `
          <th>
            <input
              type="text"
              value="${escapeHtml(cell || "")}"
              oninput="updateContentTableCell(0, ${colIndex}, this.value)"
              placeholder="헤더 입력"
            >
          </th>
        `).join("")}
      </tr>
    </thead>
  `;

  const tbodyHtml = `
    <tbody>
      ${rows.slice(1).map((row, rowOffset) => {
        const rowIndex = rowOffset + 1;
        return `
          <tr>
            ${row.map((cell, colIndex) => `
              <td>
                <input
                  type="text"
                  value="${escapeHtml(cell || "")}"
                  oninput="updateContentTableCell(${rowIndex}, ${colIndex}, this.value)"
                  placeholder="내용 입력"
                >
              </td>
            `).join("")}
          </tr>
        `;
      }).join("")}
    </tbody>
  `;

  table.innerHTML = theadHtml + tbodyHtml;
}

window.updateContentTableCell = function(rowIndex, colIndex, value) {
  if (!currentContentTableData.enabled) return;
  if (!currentContentTableData.rows[rowIndex]) return;
  currentContentTableData.rows[rowIndex][colIndex] = value;
};

window.enableContentTable = function() {
  if (!currentContentTableData.enabled) {
    currentContentTableData = createDefaultContentTable();
  }
  renderContentTableEditor();
};

window.addContentTableRow = function() {
  if (!currentContentTableData.enabled) {
    currentContentTableData = createDefaultContentTable();
  }
  const colCount = currentContentTableData.rows[0]?.length || 2;
  currentContentTableData.rows.push(Array(colCount).fill(""));
  renderContentTableEditor();
};

window.addContentTableColumn = function() {
  if (!currentContentTableData.enabled) {
    currentContentTableData = createDefaultContentTable();
  }

  currentContentTableData.rows = normalizeContentTableRows(currentContentTableData.rows);

  currentContentTableData.rows.forEach((row, idx) => {
    row.push(idx === 0 ? `항목${row.length + 1}` : "");
  });

  renderContentTableEditor();
};

window.removeLastContentTableRow = function() {
  if (!currentContentTableData.enabled) return;

  if (currentContentTableData.rows.length <= 2) {
    alert("최소 1개의 내용 행은 유지해야 합니다.");
    return;
  }

  currentContentTableData.rows.pop();
  renderContentTableEditor();
};

window.removeLastContentTableColumn = function() {
  if (!currentContentTableData.enabled) return;

  currentContentTableData.rows = normalizeContentTableRows(currentContentTableData.rows);
  const colCount = currentContentTableData.rows[0]?.length || 0;

  if (colCount <= 1) {
    alert("최소 1개의 열은 유지해야 합니다.");
    return;
  }

  currentContentTableData.rows.forEach(row => row.pop());
  renderContentTableEditor();
};

window.clearContentTable = function() {
  currentContentTableData = {
    enabled: false,
    rows: []
  };
  renderContentTableEditor();
};

function buildContentTableHtml(tableData) {
  if (!tableData?.enabled) return "";

  const rows = normalizeContentTableRows(tableData.rows || []);
  if (!rows.length) return "";

  const headerRow = rows[0];
  const bodyRows = rows.slice(1);

  const thead = `
    <thead>
      <tr>
        ${headerRow.map(cell => `<th>${escapeHtml(cell || "")}</th>`).join("")}
      </tr>
    </thead>
  `;

  const tbody = `
    <tbody>
      ${bodyRows.map(row => `
        <tr>
          ${row.map(cell => `<td>${escapeHtml(cell || "")}</td>`).join("")}
        </tr>
      `).join("")}
    </tbody>
  `;

  return `
    <div class="content-table-preview">
      <table>
        ${thead}
        ${tbody}
      </table>
    </div>
  `;
}
  
window.toggleMemberActive = function(projectId, rowIndex) {
  const project = allocationData.projects.find(p => p.id === projectId);
  if (!project) return;
  const row = project.rows[rowIndex];
  row.active = !row.active;
  renderAllocationUI();
};

let draggedMemberIndex = null;

window.dragMemberStart = function(event, projectId, rowIndex) {
  draggedMemberIndex = rowIndex;

  event.currentTarget.classList.add("dragging");

  event.dataTransfer.effectAllowed = "move";
};

window.dragMemberOver = function(event) {
  event.preventDefault();
};

window.dropMemberRow = function(event, projectId, targetIndex) {
  event.preventDefault();

  const project = allocationData.projects.find(
    p => p.id === projectId
  );

  if (!project) return;

  if (
    draggedMemberIndex === null ||
    draggedMemberIndex === targetIndex
  ) return;

  const movedRow =
    project.rows.splice(draggedMemberIndex, 1)[0];

  project.rows.splice(targetIndex, 0, movedRow);

  document
    .querySelectorAll(".dragging")
    .forEach(el => el.classList.remove("dragging"));

  draggedMemberIndex = null;

  renderAllocationUI();
};

function initCalendar() {
  const calendarEl = document.getElementById("calendar");
  if (!calendarEl || calendar) return;

  calendar = new FullCalendar.Calendar(calendarEl, {
  locale: "ko",
  initialView: "dayGridMonth",
  height: "auto",
  headerToolbar: {
    left: "prev,next today",
    center: "title",
    right: "dayGridMonth,timeGridWeek,timeGridDay"
  },
  buttonText: {
    today: "오늘",
    month: "월",
    week: "주",
    day: "일"
  },
  selectable: true,
  editable: false,

  // 하루 일정 3개까지 3줄로 표시
  dayMaxEvents: 3,
  dayMaxEventRows: 3,
  expandRows: true,

  dateClick(info) {
    openScheduleEditor({
      date: info.dateStr,
      startTime: "",
      endTime: "",
      title: "",
      memo: ""
    });
  },

  eventClick(info) {
    const ext = info.event.extendedProps || {};
    openScheduleEditor({
      id: info.event.id,
      title: info.event.title,
      date: ext.date || (info.event.startStr ? info.event.startStr.slice(0, 10) : ""),
      startTime: ext.startTime || "",
      endTime: ext.endTime || "",
      memo: ext.memo || "",
      color: info.event.backgroundColor || "#3b82f6"
    });
  },

  events: []
});

  calendar.render();
}

function mapScheduleDocToEvent(docSnap) {
  const data = docSnap.data() || {};
  const date = data.date || "";
  const startTime = data.startTime || "";
  const endTime = data.endTime || "";

  let start = date;
  let end;
  let allDay = true;

  if (date && startTime) {
    start = `${date}T${startTime}`;
    allDay = false;
  }
  if (date && endTime) {
    end = `${date}T${endTime}`;
  }

  return {
    id: docSnap.id,
    title: data.title || "(제목 없음)",
    start,
    end,
    allDay,
    backgroundColor: data.color || "#3b82f6", // 🔥 추가
    borderColor: data.color || "#3b82f6",     // 🔥 추가
    extendedProps: {
      date,
      startTime,
      endTime,
      memo: data.memo || "",
      writer: data.writer || ""
    }
  };
}

function refreshCalendarEvents() {
  if (!calendar) return;
  calendar.removeAllEvents();
  scheduleEvents.forEach(evt => calendar.addEvent(evt));
}

function subscribeSchedules() {
  if (scheduleUnsubscribe) scheduleUnsubscribe();
  const qRef = query(schedulesColRef, orderBy("date", "asc"));
  scheduleUnsubscribe = onSnapshot(qRef, snap => {
    scheduleEvents = snap.docs.map(mapScheduleDocToEvent);
    refreshCalendarEvents();
  }, error => {
    console.error("스케줄 불러오기 실패:", error);
  });
}

function formatTodayDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function openScheduleEditor(schedule = {}) {
  currentScheduleEventId = schedule.id || null;
  document.getElementById("scheduleModalTitle").textContent = currentScheduleEventId ? "일정 수정" : "일정 등록";
  document.getElementById("scheduleFormTitle").value = schedule.title || "";
  document.getElementById("scheduleFormDate").value = schedule.date || formatTodayDate();
  document.getElementById("scheduleFormStart").value = schedule.startTime || "";
  document.getElementById("scheduleFormEnd").value = schedule.endTime || "";
  document.getElementById("scheduleFormMemo").value = schedule.memo || "";
  document.getElementById("scheduleDeleteBtn").classList.toggle("hidden", !currentScheduleEventId);
  document.getElementById("scheduleColor").value = schedule.color || "#3b82f6";
  openModal("scheduleModal");
}

window.openNewScheduleFromButton = function() {
  openScheduleEditor({ date: formatTodayDate() });
};

window.closeScheduleEditor = function() {
  closeModal("scheduleModal");
};

window.saveScheduleEvent = async function() {
  try {
    const title = document.getElementById("scheduleFormTitle").value.trim();
    const date = document.getElementById("scheduleFormDate").value;
    const startTime = document.getElementById("scheduleFormStart").value;
    const endTime = document.getElementById("scheduleFormEnd").value;
    const memo = document.getElementById("scheduleFormMemo").value.trim();
    const color = document.getElementById("scheduleColor").value;

    if (!title) return alert("일정 제목을 입력하세요.");
    if (!date) return alert("날짜를 입력하세요.");
    if (startTime && endTime && startTime > endTime) return alert("종료 시간이 시작 시간보다 빠를 수 없습니다.");

    const payload = removeUndefinedDeep({
      title,
      date,
      startTime: startTime || "",
      endTime: endTime || "",
      memo,
      color, 
      writer: currentUser?.email || "anonymous",
      updatedAt: new Date().toISOString()
    });

    if (currentScheduleEventId) {
      await updateDoc(doc(db, "schedules", currentScheduleEventId), payload);
    } else {
      await addDoc(schedulesColRef, {
        ...payload,
        createdAt: new Date().toISOString()
      });
    }
    await addEditLog("스케줄", title, currentScheduleEventId ? "수정" : "등록");
    
    closeModal("scheduleModal");
  } catch (error) {
    console.error("일정 저장 실패:", error);
    alert("일정 저장 실패: " + (error.message || error));
  }
};

window.deleteScheduleEvent = async function() {
  if (!currentScheduleEventId) return;
  if (!confirm("이 일정을 삭제하시겠습니까?")) return;
  try {
    await deleteDoc(doc(db, "schedules", currentScheduleEventId));
    closeModal("scheduleModal");
  } catch (error) {
    console.error("일정 삭제 실패:", error);
    alert("일정 삭제 실패: " + (error.message || error));
  }
};

onAuthStateChanged(auth, async user => {
  currentUser = user;
  updateAdminUI();
  if (isAdmin(user)) {
    await ensureInitialData();
  } else {
    renderAllocationUI();
  }
});

onSnapshot(settingsRef, snap => {
  const data = snap.data() || {};
  menuData = Array.isArray(data.menus) && data.menus.length ? data.menus : [...defaultMenus];
  ensureFixedMenus();
  noticeData = data.notice || { title: "공지 제목", date: "", html: "<li>공지 내용이 없습니다.</li>" };
  pageContents = data.pageContents ? data.pageContents : structuredClone(defaultPageContents);

Object.keys(pageContents).forEach(key => {
  if (!pageContents[key].bodyHtml) {
    pageContents[key].bodyHtml = pageContents[key].html || "";
  }
  if (!pageContents[key].tableData) {
    pageContents[key].tableData = {
      enabled: false,
      rows: []
    };
  }
});

  renderMenus();
  renderNotice();
  renderAllContents();

  const activeTitle = document.querySelector(".nav-item.active")?.textContent?.trim();
  if (!activeTitle) {
    showSheet(0, "청현 공지사항");
  }
});

onSnapshot(allocationRef, snap => {
  const data = snap.data() || {};
  allocationData = {
    members: Array.isArray(data.members) && data.members.length ? data.members : [...fixedMembers],
    projects: Array.isArray(data.projects) ? data.projects : []
  };

  if (!selectedProjectId || !allocationData.projects.some(p => p.id === selectedProjectId)) {
    selectedProjectId = allocationData.projects[0]?.id || null;
  }
  
  renderAllocationUI();
});

window.downloadAllAllocationExcel = function() {
  if (!allocationData.projects.length) {
    alert("다운로드할 분배표 프로젝트가 없습니다.");
    return;
  }

  const wb = XLSX.utils.book_new();

  allocationData.projects.forEach(project => {
    const data = [];

    data.push(["이름", ...project.columns]);

    project.rows.forEach(row => {
      if (!row.active) return;

      const rowData = [row.name];

      project.columns.forEach(col => {
        rowData.push(row.values?.[col] || "");
      });

      data.push(rowData);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);

    const sheetName = String(project.name || "프로젝트")
      .replace(/[\\/?*[\]:]/g, "")
      .slice(0, 31);

    XLSX.utils.book_append_sheet(wb, ws, sheetName || "프로젝트");
  });

  XLSX.writeFile(wb, "전체_분배표.xlsx");
};

initEditors();
renderMenus();
renderNotice();
renderAllContents();
initCalendar();
subscribeSchedules();
showSheet(0, "청현 공지사항");
