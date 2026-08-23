const API_ROOT = "/api/v1";
const CORE_PANEL_INDEXES = new Set([0, 10, 11, 12, 13]);
const GROUP_OPTIONS = [
  ["qna", "Q&A"],
  ["work", "법정선순위"],
  ["search", "비고문구"],
  ["reference", "공유자료"]
];
const THEME_OPTIONS = [
  ["", "기본"],
  ["green", "초록"],
  ["purple", "보라"],
  ["pink", "분홍"],
  ["blue", "파랑"]
];

let currentUser = null;
let workingMenus = [];
let saving = false;

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json; charset=utf-8";
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers,
    credentials: "include"
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.detail || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isCore(menu) {
  return CORE_PANEL_INDEXES.has(Number(menu?.panelIndex));
}

function normalizeMenus(snapshot) {
  const menus = Array.isArray(snapshot?.menus) ? snapshot.menus : [];
  return menus.map(menu => ({ ...menu }));
}

function ensureAdminMenuButton() {
  const loginBox = document.getElementById("limitedLoginBox");
  if (!loginBox) return;

  let button = document.getElementById("localMenuEditBtn");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.id = "localMenuEditBtn";
    button.className = "local-menu-admin-btn";
    button.textContent = "메뉴 수정";
    button.addEventListener("click", () => void openMenuEditor().catch(error => alert(`메뉴 편집 열기 실패: ${error.message}`)));
    loginBox.appendChild(button);
  }
  button.hidden = currentUser?.role !== "ADMIN";
}

function ensureStyles() {
  if (document.getElementById("local-menu-admin-styles")) return;
  const style = document.createElement("style");
  style.id = "local-menu-admin-styles";
  style.textContent = `
    #limitedLoginBox{flex-wrap:wrap}
    #limitedLoginBox .local-menu-admin-btn{width:100%;margin-top:7px;padding:6px 10px;border:1px solid rgba(0,0,0,.2);border-radius:8px;background:rgba(255,255,255,.38);color:#111;font-size:11px;font-weight:900;cursor:pointer}
    #limitedLoginBox .local-menu-admin-btn:hover{background:rgba(255,255,255,.7)}
    #menuModal.local-menu-admin-mode .help-text{margin-bottom:12px}
    #menuModal.local-menu-admin-mode .menu-table input,
    #menuModal.local-menu-admin-mode .menu-table select{width:100%;box-sizing:border-box}
    #menuModal.local-menu-admin-mode .local-menu-order-actions{display:flex;gap:4px;justify-content:center}
    #menuModal.local-menu-admin-mode .local-menu-deleted{opacity:.48;background:#f8fafc}
    #menuModal.local-menu-admin-mode .local-menu-fixed{background:#f8fafc}
    #menuModal.local-menu-admin-mode .local-menu-status{font-size:11px;color:#64748b;white-space:nowrap}
    body.limited-deployment-mode #topNav .local-board-sub-item[data-menu-theme="green"]{background:rgba(34,197,94,.18)!important}
    body.limited-deployment-mode #topNav .local-board-sub-item[data-menu-theme="purple"]{background:rgba(139,92,246,.18)!important}
    body.limited-deployment-mode #topNav .local-board-sub-item[data-menu-theme="pink"]{background:rgba(236,72,153,.18)!important}
    body.limited-deployment-mode #topNav .local-board-sub-item[data-menu-theme="blue"]{background:rgba(59,130,246,.18)!important}
  `;
  document.head.appendChild(style);
}

function configureModalHeader() {
  const modal = document.getElementById("menuModal");
  if (!modal) return;
  modal.classList.add("local-menu-admin-mode");
  const title = modal.querySelector(".modal-title");
  if (title) title.textContent = "메뉴 수정";
  const help = modal.querySelector(".help-text");
  if (help) help.textContent = "게시판 메뉴를 추가·삭제하고 색상, 펼침그룹, 표시 순서를 변경할 수 있습니다. 공지·소액조회·분배표·스케줄·그룹리뷰는 고정 메뉴입니다.";

  const headers = modal.querySelectorAll(".menu-table thead th");
  const labels = ["순서", "제목", "패널", "색상", "펼침그룹", "상태", "삭제"];
  headers.forEach((header, index) => {
    if (labels[index]) header.textContent = labels[index];
  });

  const addButtons = modal.querySelectorAll("button.small-btn");
  addButtons.forEach((button, index) => {
    if (index === 0) {
      button.textContent = "게시판 추가";
      button.onclick = () => addMenu();
      button.style.display = "";
    } else if (index === 1) {
      button.style.display = "none";
    }
  });
}

function optionHtml(options, selected) {
  return options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function renderTable() {
  const tbody = document.getElementById("menuTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  workingMenus.forEach((menu, index) => {
    const core = isCore(menu);
    const hidden = Boolean(menu.hidden);
    const tr = document.createElement("tr");
    if (core) tr.classList.add("local-menu-fixed");
    if (hidden) tr.classList.add("local-menu-deleted");

    tr.innerHTML = `
      <td>
        <div class="local-menu-order-actions">
          <button type="button" class="small-btn" data-menu-action="up" ${index === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="small-btn" data-menu-action="down" ${index === workingMenus.length - 1 ? "disabled" : ""}>↓</button>
        </div>
      </td>
      <td><input type="text" data-menu-field="title" value="${escapeHtml(menu.title || "")}" ${core ? "readonly" : ""}></td>
      <td><input type="text" value="${escapeHtml(menu.panelIndex ?? "자동")}" readonly></td>
      <td><select data-menu-field="theme" ${core ? "disabled" : ""}>${optionHtml(THEME_OPTIONS, String(menu.theme || ""))}</select></td>
      <td><select data-menu-field="group" ${core ? "disabled" : ""}>${optionHtml(GROUP_OPTIONS, String(menu.group || inferGroup(menu)))}</select></td>
      <td><span class="local-menu-status">${core ? "고정" : hidden ? "삭제 예정" : "게시판"}</span></td>
      <td>${core ? '<span class="local-menu-status">삭제 불가</span>' : `<button type="button" class="small-btn ${hidden ? "" : "danger"}" data-menu-action="delete">${hidden ? "복원" : "삭제"}</button>`}</td>
    `;

    tr.querySelectorAll("[data-menu-field]").forEach(control => {
      control.addEventListener("change", () => {
        menu[control.dataset.menuField] = control.value;
      });
      control.addEventListener("input", () => {
        menu[control.dataset.menuField] = control.value;
      });
    });

    tr.querySelector('[data-menu-action="up"]')?.addEventListener("click", () => moveMenu(index, -1));
    tr.querySelector('[data-menu-action="down"]')?.addEventListener("click", () => moveMenu(index, 1));
    tr.querySelector('[data-menu-action="delete"]')?.addEventListener("click", () => {
      menu.hidden = !menu.hidden;
      renderTable();
    });
    tbody.appendChild(tr);
  });
}

function inferGroup(menu) {
  const title = String(menu?.title || "").replace(/\s+/g, "").toLocaleLowerCase();
  if (title.includes("q&a") || title.includes("qna") || title.includes("질의")) return "qna";
  if (title.includes("임대차") || title.includes("임차") || title.includes("임금") || title.includes("조세")) return "work";
  if (title.includes("비고") || title.includes("감정평가") || title.includes("경매참고")) return "search";
  return "reference";
}

function moveMenu(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= workingMenus.length) return;
  [workingMenus[index], workingMenus[target]] = [workingMenus[target], workingMenus[index]];
  renderTable();
}

function addMenu() {
  workingMenus.push({
    title: "새 게시판",
    panelIndex: null,
    location: "top",
    kind: "panel",
    group: "reference",
    theme: "",
    hidden: false
  });
  renderTable();
}

async function openMenuEditor() {
  if (currentUser?.role !== "ADMIN") return alert("관리자만 수정할 수 있습니다.");
  const snapshot = await api("/shared-pages");
  workingMenus = normalizeMenus(snapshot);
  configureModalHeader();
  renderTable();
  document.getElementById("menuModal")?.classList.add("show");
}

async function saveMenus() {
  if (saving) return;
  if (currentUser?.role !== "ADMIN") return alert("관리자만 수정할 수 있습니다.");

  const blank = workingMenus.find(menu => !isCore(menu) && !menu.hidden && !String(menu.title || "").trim());
  if (blank) return alert("게시판 제목을 입력해주세요.");

  saving = true;
  try {
    const snapshot = await api("/shared-pages/menus", {
      method: "PUT",
      body: JSON.stringify({ menus: workingMenus, notice: {}, page_contents: {} })
    });
    workingMenus = normalizeMenus(snapshot);
    document.getElementById("menuModal")?.classList.remove("show");
    window.localSharedPagesApi?.refresh?.();
    alert("메뉴가 저장되었습니다.");
  } finally {
    saving = false;
  }
}

function applyMenuPresentation(snapshot) {
  const menus = Array.isArray(snapshot?.menus) ? snapshot.menus : [];
  const order = new Map();
  menus.forEach((menu, index) => order.set(Number(menu?.panelIndex), index));

  for (const menu of menus) {
    const panelIndex = Number(menu?.panelIndex);
    if (!Number.isFinite(panelIndex)) continue;
    const hidden = Boolean(menu.hidden);

    const panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);
    if (panel && !CORE_PANEL_INDEXES.has(panelIndex)) {
      panel.style.display = hidden ? "none" : "";
      if (hidden) panel.classList.remove("active");
    }

    const selectors = [
      `.nav-item[data-local-shared-panel-index="${panelIndex}"]`,
      `.nav-item[data-local-shared-menu="dynamic"][data-local-shared-panel-index="${panelIndex}"]`
    ];
    const button = document.querySelector(selectors.join(","));
    if (button && !CORE_PANEL_INDEXES.has(panelIndex)) {
      button.style.display = hidden ? "none" : "";
      button.dataset.menuTheme = String(menu.theme || "");
    }
  }

  document.querySelectorAll(".local-board-subgroup").forEach(wrap => {
    const buttons = Array.from(wrap.querySelectorAll(":scope > .nav-item"));
    buttons.sort((a, b) => {
      const aIndex = Number(a.dataset.localSharedPanelIndex);
      const bIndex = Number(b.dataset.localSharedPanelIndex);
      return (order.get(aIndex) ?? 9999) - (order.get(bIndex) ?? 9999);
    });
    buttons.forEach(button => wrap.appendChild(button));
  });
}

async function syncUser() {
  try {
    currentUser = await api("/auth/me");
  } catch (error) {
    if (error.status === 401) currentUser = null;
    else throw error;
  }
  ensureAdminMenuButton();
}

function bindActions() {
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("#menuModal.local-menu-admin-mode .primary-btn")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void saveMenus().catch(error => alert(`메뉴 저장 실패: ${error.message}`));
      return;
    }

    if (target.closest("#menuModal.local-menu-admin-mode .secondary-btn")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.getElementById("menuModal")?.classList.remove("show");
      return;
    }

    if (target.closest("#grv2Logout")) setTimeout(() => void syncUser(), 250);
  }, true);

  document.addEventListener("submit", event => {
    if (event.target?.matches?.("#grv2LoginForm,#allocationLoginForm")) {
      setTimeout(() => void syncUser(), 250);
      setTimeout(() => void syncUser(), 900);
    }
  }, true);

  window.addEventListener("local-shared-pages-loaded", event => {
    if (event?.detail) applyMenuPresentation(event.detail);
    ensureAdminMenuButton();
  });
}

export function installLocalMenuAdmin() {
  if (window.__localMenuAdminInstalled) return;
  window.__localMenuAdminInstalled = true;
  ensureStyles();
  bindActions();
  [0, 250, 800, 1600].forEach(delay => {
    setTimeout(() => void syncUser().catch(error => console.error("메뉴 관리자 상태 확인 실패:", error)), delay);
  });
}

installLocalMenuAdmin();
