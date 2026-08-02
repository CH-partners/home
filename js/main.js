import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection, addDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { initAllocation } from "./allocation.js";
import { initSchedule } from "./schedule.js";

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
let navGroupState = {};

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

function getMenuGroup(menu) {
  if (menu.group) return menu.group;

  if (isQnaMenu(menu)) return "qna";

  return "";
}

function getGroupTitle(groupKey) {
  const map = {
    qna: "Q&A 모음",
    search: "비고 문구(경매, 감정평가, 기타)",
    work: "법정선순위",
    reference: "참고 메뉴"
  };

  return map[groupKey] || groupKey;
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

function getMenusByDashboardGroup(groupKey) {
  if (groupKey === "tool") {
    return menuData.filter(menu => {
      const title = (menu.title || "").trim();

      return (
        Number(menu.panelIndex) === 11 ||
        Number(menu.panelIndex) === 12 ||
        title === "소액조회" ||
        title.includes("전월세") ||
        title.includes("최우선임금") ||
        menu.group === "tool"
      );
    });
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
  const panelIndex = `dashboard-${groupKey}`;

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

    main.appendChild(panel);
  }

  return panel;
}

function showDashboardGroup(groupKey) {
  document.querySelectorAll(".sheet-panel").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));

  const panel = ensureDashboardPanel(groupKey);
  const grid = panel.querySelector(`#dashboardGrid-${groupKey}`);
  const menus = getMenusByDashboardGroup(groupKey);

  grid.innerHTML = "";

  if (!menus.length) {
    grid.innerHTML = `
      <div class="dashboard-empty">
        등록된 메뉴가 없습니다.
      </div>
    `;
  } else {
    menus.forEach(menu => {
      grid.appendChild(createDashboardCard(menu));
    });
  }

  panel.classList.add("active");

  const activeBtn = document.querySelector(`[data-dashboard-nav="${groupKey}"]`);
  if (activeBtn) activeBtn.classList.add("active");
}

function getMenuIcon(title) {
  title = title || "";

  if (title.includes("분배표")) return "📊";
  if (title.includes("스케줄")) return "📅";
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
          <header class="sheet-header">
            <h1>${escapeHtml(menu.title || "외부페이지")}</h1>
          </header>
          <section class="major-card iframe-card">
            <iframe class="tool-frame" src="${escapeHtml(menu.url)}"></iframe>
          </section>
        `;
        document.querySelector(".main").appendChild(panel);
      } else {
        const frame = panel.querySelector("iframe");
        if (frame) frame.src = menu.url;
      }
    }

    renderAllContents();

    if (Number(menu.panelIndex) === 11) {
      window.allocationApi?.renderAllocationUI();
    }

    showSheet(Number(menu.panelIndex || 0), menu.title);
  };

  return card;
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
  if (Number(index) === 12 && window.scheduleApi) {
    requestAnimationFrame(() => window.scheduleApi.updateSize());
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
      if (menu.theme === "purple") {
          btn.classList.add("nav-item-purple");
      } else if (menu.theme === "pink") {
          btn.classList.add("nav-item-pink");
      } else if (menu.theme === "blue") {
          btn.classList.add("nav-item-blue");
      } else {
          btn.classList.add("nav-item-green");
      }
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
      const panelIndex = Number(menu.panelIndex || 10);
      let panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);
    
      if (!panel) {
        panel = document.createElement("div");
        panel.className = "sheet-panel";
        panel.setAttribute("data-index", String(panelIndex));
        panel.innerHTML = `
          <header class="sheet-header">
            <h1>${escapeHtml(menu.title || "외부페이지")}</h1>
          </header>
          <section class="major-card iframe-card">
            <iframe class="tool-frame" src="${escapeHtml(menu.url)}"></iframe>
          </section>
        `;
        document.querySelector(".main").appendChild(panel);
      } else {
        const frame = panel.querySelector("iframe");
        if (frame) frame.src = menu.url;
      }
    }
    renderAllContents();
    if (Number(menu.panelIndex) === 11) window.allocationApi?.renderAllocationUI();
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

  const renderedMenus = new Set();
  const noticeMenu = menuData.find(menu => Number(menu.panelIndex) === 0);

  if (noticeMenu) {
    topNav.appendChild(createMenuButton(noticeMenu));
    renderedMenus.add(noticeMenu);
  }

  const divider = document.createElement("div");
  divider.className = "nav-divider";
  topNav.appendChild(divider);

  dashboardGroups
    .filter(group => group.key !== "notice")
    .forEach(group => {
      const menus = getMenusByDashboardGroup(group.key)
        .filter(menu => !renderedMenus.has(menu));

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

    ungroupedMenus.forEach(menu => {
      topNav.appendChild(createMenuButton(menu));
    });
  }

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
  window.allocationApi?.renderAllocationUI();
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

function hasContentTableValue(rows) {
  return rows.some(row => row.some(cell => String(cell || "").trim() !== ""));
}

function getContentTableColumnCount(rows) {
  return Math.max(2, ...rows.map(row => row.length), 2);
}

function createBlankContentTable(rowCount = 2, colCount = 2) {
  return Array.from({ length: rowCount }, () => Array.from({ length: colCount }, () => ""));
}

function deserializeTableData(tableData) {
  const sourceRows = Array.isArray(tableData)
    ? tableData
    : Array.isArray(tableData?.rows)
      ? tableData.rows
      : [];

  const rows = sourceRows
    .filter(row => Array.isArray(row))
    .map(row => row.map(cell => String(cell ?? "")));

  const colCount = getContentTableColumnCount(rows);
  const normalizedRows = rows.map(row => {
    const normalizedRow = [...row];
    while (normalizedRow.length < colCount) normalizedRow.push("");
    return normalizedRow;
  });

  const enabled = Boolean(tableData?.enabled || hasContentTableValue(normalizedRows));

  return {
    enabled,
    rows: enabled && normalizedRows.length ? normalizedRows : []
  };
}

function serializeTableData(tableData) {
  const normalized = deserializeTableData(tableData);
  return {
    enabled: normalized.enabled,
    rows: normalized.rows
  };
}

function ensureEditableContentTable() {
  if (!currentContentTableData.enabled) {
    currentContentTableData = {
      enabled: true,
      rows: createBlankContentTable()
    };
    return;
  }

  if (!currentContentTableData.rows.length) {
    currentContentTableData.rows = createBlankContentTable();
    return;
  }

  const colCount = getContentTableColumnCount(currentContentTableData.rows);
  currentContentTableData.rows = currentContentTableData.rows.map(row => {
    const nextRow = [...row];
    while (nextRow.length < colCount) nextRow.push("");
    return nextRow;
  });
}

function buildContentTableHtml(tableData) {
  const normalized = deserializeTableData(tableData);
  if (!normalized.enabled || !normalized.rows.length || !hasContentTableValue(normalized.rows)) {
    return "";
  }

  const [headerRow, ...bodyRows] = normalized.rows;
  const headerHtml = `
    <thead>
      <tr>${headerRow.map(cell => `<th>${escapeHtml(cell)}</th>`).join("")}</tr>
    </thead>
  `;
  const bodyHtml = bodyRows.length
    ? `
      <tbody>
        ${bodyRows.map(row => `
          <tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>
        `).join("")}
      </tbody>
    `
    : "";

  return `
    <div class="content-table-preview">
      <table>
        ${headerHtml}
        ${bodyHtml}
      </table>
    </div>
  `;
}

function renderContentTableEditor() {
  const table = document.getElementById("contentTableEditor");
  if (!table) return;

  if (!currentContentTableData.enabled) {
    table.innerHTML = `
      <tbody>
        <tr>
          <td class="note">표를 사용하려면 표 사용을 눌러주세요.</td>
        </tr>
      </tbody>
    `;
    return;
  }

  ensureEditableContentTable();
  const colCount = getContentTableColumnCount(currentContentTableData.rows);

  table.innerHTML = `
    <thead>
      <tr>
        <th>구분</th>
        ${Array.from({ length: colCount }, (_, colIndex) => `<th>열 ${colIndex + 1}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${currentContentTableData.rows.map((row, rowIndex) => `
        <tr>
          <th>${rowIndex === 0 ? "제목" : `행 ${rowIndex + 1}`}</th>
          ${row.map((cell, colIndex) => `
            <td>
              <input
                type="text"
                data-content-row="${rowIndex}"
                data-content-col="${colIndex}"
                value="${escapeHtml(cell)}"
              >
            </td>
          `).join("")}
        </tr>
      `).join("")}
    </tbody>
  `;

  table.querySelectorAll("input[data-content-row][data-content-col]").forEach(input => {
    input.addEventListener("input", () => {
      const rowIndex = Number(input.getAttribute("data-content-row"));
      const colIndex = Number(input.getAttribute("data-content-col"));
      if (!currentContentTableData.rows[rowIndex]) return;
      currentContentTableData.rows[rowIndex][colIndex] = input.value;
    });
  });
}

window.enableContentTable = function() {
  ensureEditableContentTable();
  renderContentTableEditor();
};

window.addContentTableRow = function() {
  ensureEditableContentTable();
  const colCount = getContentTableColumnCount(currentContentTableData.rows);
  currentContentTableData.rows.push(Array.from({ length: colCount }, () => ""));
  renderContentTableEditor();
};

window.addContentTableColumn = function() {
  ensureEditableContentTable();
  currentContentTableData.rows.forEach(row => row.push(""));
  renderContentTableEditor();
};

window.removeLastContentTableRow = function() {
  if (!currentContentTableData.enabled || currentContentTableData.rows.length <= 1) return;
  currentContentTableData.rows.pop();
  renderContentTableEditor();
};

window.removeLastContentTableColumn = function() {
  if (!currentContentTableData.enabled) return;
  const colCount = getContentTableColumnCount(currentContentTableData.rows);
  if (colCount <= 2) return;
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
      <input data-field="icon" data-index="${realIndex}"
        value="${escapeHtml(menu.icon || "")}"
        placeholder="예: 📊"
        ${isFixedMenu ? "readonly" : ""}
      >
    </td>
      <td>
        <input data-field="panelIndex" data-index="${realIndex}" value="${escapeHtml(String(isWork ? 11 : isSchedule ? 12 : (menu.panelIndex ?? "")))}" ${isFixedMenu ? "readonly" : ""}>
      </td>
      <td>
        <select data-field="theme" data-index="${realIndex}" ${isFixedMenu ? "disabled" : ""}>
          <option value="green" ${(menu.theme || "green") === "green" ? "selected" : ""}>초록</option>
          <option value="purple" ${menu.theme === "purple" ? "selected" : ""}>보라</option>
          <option value="pink" ${menu.theme === "pink" ? "selected" : ""}>분홍</option>
          <option value="blue" ${menu.theme === "blue" ? "selected" : ""}>파랑</option>
        </select>
      </td>
      <td>
        <select data-field="group" data-index="${realIndex}" ${isFixedMenu ? "disabled" : ""}>
          <option value="" ${!getMenuGroup(menu) ? "selected" : ""}>일반</option>
          <option value="tool" ${getMenuGroup(menu) === "tool" ? "selected" : ""}>업무도구</option>
          <option value="qna" ${getMenuGroup(menu) === "qna" ? "selected" : ""}>Q&A 모음</option>
          <option value="search" ${getMenuGroup(menu) === "search" ? "selected" : ""}>비고 문구(경매, 감정평가, 기타)</option>
          <option value="work" ${getMenuGroup(menu) === "work" ? "selected" : ""}>법정선순위</option>
          <option value="reference" ${getMenuGroup(menu) === "reference" ? "selected" : ""}>참고 메뉴</option>
        </select>
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
  menuData.push({
    title: "",
    panelIndex: 0,
    location: location || "top",
    kind: location === "bottom" ? "iframe" : "panel",
    url: "",
    theme: location === "bottom" ? "green" : "",
    group: ""
  });
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
    const rawIcon = getVal("icon");
    const rawPanelIndex = getVal("panelIndex");
    const rawLocation = getVal("location");
    const rawUrl = getVal("url");
    const rawTheme = getVal("theme") || prev.theme || "green";
    const rawGroup = getVal("group") || "";

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
      icon: rawIcon || prev.icon || "",
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

    if (isWorkAllocation || isSchedule) {
      item.theme = "purple";
    } else if (location === "bottom") {
      item.theme = rawTheme || "green";
    } else if (prev.theme) {
      item.theme = prev.theme;
    }

    if (rawGroup && location !== "bottom") {
      item.group = rawGroup;
    }

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

onAuthStateChanged(auth, async user => {
  currentUser = user;
  updateAdminUI();
  if (isAdmin(user)) {
    await ensureInitialData();
  } else {
    window.allocationApi?.renderAllocationUI();
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



initEditors();

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

renderMenus();
renderNotice();
renderAllContents();
window.scheduleApi.initCalendar();
window.scheduleApi.subscribeSchedules();
showSheet(0, "청현 공지사항");
