const API_ROOT = "/api/v1";
const CORE_PANEL_INDEXES = new Set([0, 10, 11, 12, 13]);
const GROUP_OPTIONS = [["qna","Q&A"],["work","법정선순위"],["search","비고문구"],["reference","공유자료"]];
const THEME_OPTIONS = [["","기본"],["green","초록"],["purple","보라"],["pink","분홍"],["blue","파랑"]];
const GROUP_META = {
  qna: { title: "Q&A", icon: "❓" },
  work: { title: "법정선순위", icon: "⚖" },
  search: { title: "비고문구", icon: "📝" },
  reference: { title: "공유자료", icon: "📚" }
};
const CORE_LABELS = {
  0: ["청현공지사항", "공지사항"],
  10: ["소액조회"],
  11: ["분배표"],
  12: ["스케줄"],
  13: ["그룹리뷰"]
};

let currentUser = null;
let workingBlocks = [];
let saving = false;
let lastPresentationKey = "";

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json; charset=utf-8";
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers, credentials: "include" });
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

function compact(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[📊📝📢❓⚖📚]/g, "")
    .trim();
}

function isCore(menu) {
  return CORE_PANEL_INDEXES.has(Number(menu?.panelIndex));
}

function inferGroup(menu) {
  const explicit = String(menu?.group || "").trim().toLowerCase();
  if (GROUP_META[explicit]) return explicit;

  const title = String(menu?.title || "").replace(/\s+/g, "").toLocaleLowerCase();
  if (title.includes("q&a") || title.includes("qna") || title.includes("질의")) return "qna";
  if (title.includes("임대차") || title.includes("임차") || title.includes("임금") || title.includes("조세")) return "work";
  if (title.includes("비고") || title.includes("감정평가") || title.includes("경매참고")) return "search";
  return "reference";
}

function buildBlocks(menus) {
  const blocks = [];
  const groupBlocks = new Map();

  for (const source of Array.isArray(menus) ? menus : []) {
    const menu = { ...source };
    if (isCore(menu)) {
      blocks.push({ type: "menu", menu });
      continue;
    }

    const groupKey = inferGroup(menu);
    menu.group = groupKey;
    let block = groupBlocks.get(groupKey);
    if (!block) {
      block = { type: "group", groupKey, items: [] };
      groupBlocks.set(groupKey, block);
      blocks.push(block);
    }
    block.items.push(menu);
  }

  return blocks;
}

function flattenBlocks(blocks = workingBlocks) {
  const menus = [];
  for (const block of blocks) {
    if (block.type === "menu") {
      menus.push(block.menu);
      continue;
    }
    for (const item of block.items) {
      item.group = block.groupKey;
      menus.push(item);
    }
  }
  return menus;
}

function ensureStyles() {
  if (document.getElementById("local-menu-admin-styles")) return;
  const style = document.createElement("style");
  style.id = "local-menu-admin-styles";
  style.textContent = `
    #limitedLoginBox{flex-wrap:wrap}
    #limitedLoginBox .local-menu-admin-btn{width:100%;margin-top:7px;padding:6px 10px;border:1px solid rgba(0,0,0,.2);border-radius:8px;background:rgba(255,255,255,.38);color:#111;font-size:11px;font-weight:900;cursor:pointer}
    #limitedLoginBox .local-menu-admin-btn:hover{background:rgba(255,255,255,.7)}
    #menuModal.local-menu-admin-mode .menu-table input,#menuModal.local-menu-admin-mode .menu-table select{width:100%;box-sizing:border-box}
    #menuModal.local-menu-admin-mode .local-menu-order-actions{display:flex;gap:4px;justify-content:center}
    #menuModal.local-menu-admin-mode .local-menu-group-row td{background:#e9eef7;font-weight:900;border-top:2px solid #cbd5e1}
    #menuModal.local-menu-admin-mode .local-menu-child-row td:nth-child(2){padding-left:26px}
    #menuModal.local-menu-admin-mode .local-menu-child-row td:nth-child(2)::before{content:"↳";margin-right:6px;color:#94a3b8}
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
    button.onclick = () => void openMenuEditor().catch(error => alert(`메뉴 편집 열기 실패: ${error.message}`));
    loginBox.appendChild(button);
  }
  button.hidden = currentUser?.role !== "ADMIN";
}

function configureModal() {
  const modal = document.getElementById("menuModal");
  if (!modal) return;

  modal.classList.add("local-menu-admin-mode");
  modal.querySelector(".modal-title").textContent = "메뉴 수정";
  const help = modal.querySelector(".help-text");
  if (help) help.textContent = "↑↓로 단독 메뉴와 펼침그룹의 위치를 바꾸고, 펼침그룹 안에서도 게시판 순서를 바꿀 수 있습니다.";

  const labels = ["순서", "제목", "패널", "색상", "펼침그룹", "상태", "삭제"];
  modal.querySelectorAll(".menu-table thead th").forEach((th, index) => {
    if (labels[index]) th.textContent = labels[index];
  });

  const buttons = modal.querySelectorAll("button.small-btn");
  buttons.forEach((button, index) => {
    if (index === 0) {
      button.textContent = "게시판 추가";
      button.onclick = addMenu;
      button.style.display = "";
    } else if (index === 1) {
      button.style.display = "none";
    }
  });
}

function optionsHtml(options, selected) {
  return options
    .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
}

function orderButtonsHtml(disableUp, disableDown, scope) {
  return `<div class="local-menu-order-actions">
    <button type="button" class="small-btn" data-action="${scope}-up" ${disableUp ? "disabled" : ""}>↑</button>
    <button type="button" class="small-btn" data-action="${scope}-down" ${disableDown ? "disabled" : ""}>↓</button>
  </div>`;
}

function renderCoreRow(tbody, block, blockIndex) {
  const menu = block.menu;
  const tr = document.createElement("tr");
  tr.className = "local-menu-fixed";
  tr.innerHTML = `
    <td>${orderButtonsHtml(blockIndex === 0, blockIndex === workingBlocks.length - 1, "block")}</td>
    <td><input value="${escapeHtml(menu.title || "")}" readonly></td>
    <td><input value="${escapeHtml(menu.panelIndex ?? "")}" readonly></td>
    <td><select disabled>${optionsHtml(THEME_OPTIONS, String(menu.theme || ""))}</select></td>
    <td><span class="local-menu-status">단독 메뉴</span></td>
    <td><span class="local-menu-status">고정</span></td>
    <td><span class="local-menu-status">삭제 불가</span></td>`;

  tr.querySelector('[data-action="block-up"]')?.addEventListener("click", () => moveBlock(blockIndex, -1));
  tr.querySelector('[data-action="block-down"]')?.addEventListener("click", () => moveBlock(blockIndex, 1));
  tbody.appendChild(tr);
}

function renderGroupRow(tbody, block, blockIndex) {
  const meta = GROUP_META[block.groupKey] || { title: block.groupKey, icon: "📁" };
  const visibleCount = block.items.filter(item => !item.hidden).length;
  const tr = document.createElement("tr");
  tr.className = "local-menu-group-row";
  tr.innerHTML = `
    <td>${orderButtonsHtml(blockIndex === 0, blockIndex === workingBlocks.length - 1, "block")}</td>
    <td>${meta.icon} ${escapeHtml(meta.title)}</td>
    <td></td><td></td>
    <td><span class="local-menu-status">펼침메뉴</span></td>
    <td><span class="local-menu-status">${visibleCount}개 게시판</span></td>
    <td></td>`;

  tr.querySelector('[data-action="block-up"]')?.addEventListener("click", () => moveBlock(blockIndex, -1));
  tr.querySelector('[data-action="block-down"]')?.addEventListener("click", () => moveBlock(blockIndex, 1));
  tbody.appendChild(tr);

  block.items.forEach((menu, itemIndex) => renderChildRow(tbody, block, blockIndex, menu, itemIndex));
}

function renderChildRow(tbody, block, blockIndex, menu, itemIndex) {
  const hidden = Boolean(menu.hidden);
  const tr = document.createElement("tr");
  tr.className = "local-menu-child-row";
  if (hidden) tr.classList.add("local-menu-deleted");

  tr.innerHTML = `
    <td>${orderButtonsHtml(itemIndex === 0, itemIndex === block.items.length - 1, "item")}</td>
    <td><input data-field="title" value="${escapeHtml(menu.title || "")}"></td>
    <td><input value="${escapeHtml(menu.panelIndex ?? "자동")}" readonly></td>
    <td><select data-field="theme">${optionsHtml(THEME_OPTIONS, String(menu.theme || ""))}</select></td>
    <td><select data-field="group">${optionsHtml(GROUP_OPTIONS, block.groupKey)}</select></td>
    <td><span class="local-menu-status">${hidden ? "삭제 예정" : "게시판"}</span></td>
    <td><button type="button" class="small-btn ${hidden ? "" : "danger"}" data-action="delete">${hidden ? "복원" : "삭제"}</button></td>`;

  tr.querySelector('[data-field="title"]')?.addEventListener("input", event => { menu.title = event.target.value; });
  tr.querySelector('[data-field="theme"]')?.addEventListener("change", event => { menu.theme = event.target.value; });
  tr.querySelector('[data-field="group"]')?.addEventListener("change", event => changeItemGroup(blockIndex, itemIndex, event.target.value));
  tr.querySelector('[data-action="item-up"]')?.addEventListener("click", () => moveItem(blockIndex, itemIndex, -1));
  tr.querySelector('[data-action="item-down"]')?.addEventListener("click", () => moveItem(blockIndex, itemIndex, 1));
  tr.querySelector('[data-action="delete"]')?.addEventListener("click", () => { menu.hidden = !menu.hidden; renderTable(); });
  tbody.appendChild(tr);
}

function renderTable() {
  const tbody = document.getElementById("menuTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  workingBlocks.forEach((block, blockIndex) => {
    if (block.type === "menu") renderCoreRow(tbody, block, blockIndex);
    else renderGroupRow(tbody, block, blockIndex);
  });
}

function moveBlock(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= workingBlocks.length) return;
  [workingBlocks[index], workingBlocks[target]] = [workingBlocks[target], workingBlocks[index]];
  renderTable();
}

function moveItem(blockIndex, itemIndex, direction) {
  const block = workingBlocks[blockIndex];
  if (!block || block.type !== "group") return;
  const target = itemIndex + direction;
  if (target < 0 || target >= block.items.length) return;
  [block.items[itemIndex], block.items[target]] = [block.items[target], block.items[itemIndex]];
  renderTable();
}

function changeItemGroup(blockIndex, itemIndex, nextGroupKey) {
  if (!GROUP_META[nextGroupKey]) return;
  const sourceBlock = workingBlocks[blockIndex];
  if (!sourceBlock || sourceBlock.type !== "group") return;

  const [menu] = sourceBlock.items.splice(itemIndex, 1);
  if (!menu) return;
  menu.group = nextGroupKey;

  let targetBlock = workingBlocks.find(block => block.type === "group" && block.groupKey === nextGroupKey);
  if (!targetBlock) {
    targetBlock = { type: "group", groupKey: nextGroupKey, items: [] };
    workingBlocks.splice(Math.min(blockIndex + 1, workingBlocks.length), 0, targetBlock);
  }
  targetBlock.items.push(menu);

  if (!sourceBlock.items.length) {
    const sourceIndex = workingBlocks.indexOf(sourceBlock);
    if (sourceIndex >= 0) workingBlocks.splice(sourceIndex, 1);
  }
  renderTable();
}

function addMenu() {
  let referenceBlock = workingBlocks.find(block => block.type === "group" && block.groupKey === "reference");
  if (!referenceBlock) {
    referenceBlock = { type: "group", groupKey: "reference", items: [] };
    workingBlocks.push(referenceBlock);
  }
  referenceBlock.items.push({ title: "새 게시판", panelIndex: null, location: "top", kind: "panel", group: "reference", theme: "", hidden: false });
  renderTable();
}

async function openMenuEditor() {
  if (currentUser?.role !== "ADMIN") return alert("관리자만 수정할 수 있습니다.");
  const snapshot = await api("/shared-pages");
  workingBlocks = buildBlocks(snapshot?.menus || []);
  configureModal();
  renderTable();
  document.getElementById("menuModal")?.classList.add("show");
}

async function saveMenus() {
  if (saving) return;
  if (currentUser?.role !== "ADMIN") return alert("관리자만 수정할 수 있습니다.");

  const menus = flattenBlocks();
  if (menus.some(menu => !isCore(menu) && !menu.hidden && !String(menu.title || "").trim())) return alert("게시판 제목을 입력해주세요.");

  saving = true;
  try {
    await api("/shared-pages/menus", { method: "PUT", body: JSON.stringify({ menus, notice: {}, page_contents: {} }) });
    lastPresentationKey = "";
    document.getElementById("menuModal")?.classList.remove("show");
    window.localSharedPagesApi?.refresh?.();
    alert("메뉴가 저장되었습니다.");
  } finally {
    saving = false;
  }
}

function ensureGroupShell(groupKey) {
  const topNav = document.getElementById("topNav");
  const meta = GROUP_META[groupKey];
  if (!topNav || !meta) return null;

  let toggle = topNav.querySelector(`[data-local-board-group-toggle="${groupKey}"]`);
  let wrap = topNav.querySelector(`[data-local-board-group-wrap="${groupKey}"]`);

  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-item local-board-group-toggle";
    toggle.dataset.localSharedPublic = "1";
    toggle.dataset.localBoardGroupToggle = groupKey;
    toggle.innerHTML = `<span class="local-board-group-label"><span aria-hidden="true">${meta.icon}</span><span>${escapeHtml(meta.title)}</span></span><span class="local-board-group-arrow" aria-hidden="true">▶</span>`;
    toggle.addEventListener("click", () => {
      const nextExpanded = wrap?.hidden !== false;
      if (wrap) wrap.hidden = !nextExpanded;
      toggle.classList.toggle("expanded", nextExpanded);
      toggle.setAttribute("aria-expanded", String(nextExpanded));
      const arrow = toggle.querySelector(".local-board-group-arrow");
      if (arrow) arrow.textContent = nextExpanded ? "▼" : "▶";
    });
    topNav.appendChild(toggle);
  }

  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "local-board-subgroup";
    wrap.dataset.localBoardGroupWrap = groupKey;
    wrap.hidden = true;
    topNav.appendChild(wrap);
  }

  return { toggle, wrap };
}

function findCoreButton(panelIndex) {
  const topNav = document.getElementById("topNav");
  if (!topNav) return null;
  const labels = CORE_LABELS[panelIndex] || [];
  return Array.from(topNav.querySelectorAll(":scope > .nav-item"))
    .find(button => labels.includes(compact(button.textContent))) || null;
}

function findBoardButton(panelIndex) {
  return document.querySelector(`.nav-item[data-local-shared-panel-index="${panelIndex}"]`);
}

function presentationKey(menus) {
  return JSON.stringify(menus.map(menu => ({
    panelIndex: Number(menu?.panelIndex),
    title: String(menu?.title || ""),
    group: inferGroup(menu),
    theme: String(menu?.theme || ""),
    hidden: Boolean(menu?.hidden)
  })));
}

function presentationDomReady(menus) {
  for (const menu of menus) {
    const panelIndex = Number(menu?.panelIndex);
    if (!Number.isFinite(panelIndex) || CORE_PANEL_INDEXES.has(panelIndex)) continue;
    const button = findBoardButton(panelIndex);
    if (!button) return false;
    const wrap = document.querySelector(`[data-local-board-group-wrap="${inferGroup(menu)}"]`);
    if (!wrap || button.parentElement !== wrap) return false;
  }
  return true;
}

function appendOnlyIfNeeded(parent, node) {
  if (!parent || !node) return;
  if (node.parentElement !== parent || parent.lastElementChild !== node) parent.appendChild(node);
}

function applyMenuPresentation(snapshot) {
  const menus = Array.isArray(snapshot?.menus) ? snapshot.menus : [];
  const topNav = document.getElementById("topNav");
  if (!topNav) return;

  const nextKey = presentationKey(menus);
  if (nextKey === lastPresentationKey && presentationDomReady(menus)) return;
  lastPresentationKey = nextKey;

  const blocks = buildBlocks(menus);
  const order = new Map(menus.map((menu, index) => [Number(menu?.panelIndex), index]));

  for (const menu of menus) {
    const panelIndex = Number(menu?.panelIndex);
    if (!Number.isFinite(panelIndex) || CORE_PANEL_INDEXES.has(panelIndex)) continue;

    const hidden = Boolean(menu.hidden);
    const groupKey = inferGroup(menu);
    const shell = ensureGroupShell(groupKey);
    const panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);
    const button = findBoardButton(panelIndex);

    if (panel) {
      if (hidden) panel.removeAttribute("data-local-shared-public-ready");
      else if (panel.dataset.localSharedPublicReady !== "1") panel.dataset.localSharedPublicReady = "1";
      const wantedDisplay = hidden ? "none" : "";
      if (panel.style.display !== wantedDisplay) panel.style.display = wantedDisplay;
      if (hidden) panel.classList.remove("active");
    }

    if (button) {
      if (hidden) button.removeAttribute("data-local-shared-public");
      else if (button.dataset.localSharedPublic !== "1") button.dataset.localSharedPublic = "1";
      const wantedDisplay = hidden ? "none" : "";
      if (button.style.display !== wantedDisplay) button.style.display = wantedDisplay;
      const theme = String(menu.theme || "");
      if (button.dataset.menuTheme !== theme) button.dataset.menuTheme = theme;
      button.classList.add("local-board-sub-item");
      if (shell?.wrap && button.parentElement !== shell.wrap) shell.wrap.appendChild(button);
    }
  }

  document.querySelectorAll(".local-board-subgroup").forEach(wrap => {
    const sorted = Array.from(wrap.querySelectorAll(":scope > .nav-item")).sort((a, b) => {
      const aIndex = Number(a.dataset.localSharedPanelIndex);
      const bIndex = Number(b.dataset.localSharedPanelIndex);
      return (order.get(aIndex) ?? 9999) - (order.get(bIndex) ?? 9999);
    });
    sorted.forEach((button, index) => {
      const current = wrap.children[index];
      if (current !== button) wrap.insertBefore(button, current || null);
    });

    const visibleChildren = sorted.some(button => button.style.display !== "none");
    const groupKey = wrap.dataset.localBoardGroupWrap;
    const toggle = topNav.querySelector(`[data-local-board-group-toggle="${groupKey}"]`);
    const wantedDisplay = visibleChildren ? "" : "none";
    if (toggle && toggle.style.display !== wantedDisplay) toggle.style.display = wantedDisplay;
    if (wrap.style.display !== wantedDisplay) wrap.style.display = wantedDisplay;
  });

  for (const block of blocks) {
    if (block.type === "menu") {
      const button = findCoreButton(Number(block.menu?.panelIndex));
      appendOnlyIfNeeded(topNav, button);
      continue;
    }
    const shell = ensureGroupShell(block.groupKey);
    if (!shell) continue;
    appendOnlyIfNeeded(topNav, shell.toggle);
    appendOnlyIfNeeded(topNav, shell.wrap);
  }
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
