const API_ROOT = "/api/v1";
const GROUPS = {
  qna: { title: "Q&A", icon: "❓" },
  work: { title: "법정선순위", icon: "⚖" },
  search: { title: "비고문구", icon: "📝" },
  reference: { title: "공유자료", icon: "📚" }
};
const GROUP_OPTIONS = Object.entries(GROUPS);
const VISIBILITY_PRESET_VERSION = 2;
const DEFAULT_VISIBLE_MENU_KEYS = new Set([
  "panel:0",
  "panel:11",
  "panel:13",
  "tool:small-deposit",
  "tool:rent-trades",
  "tool:priority-wage"
]);
const TOOL_DEFAULTS = [
  { title: "소액조회", panelIndex: 1000, kind: "tool", toolKey: "small-deposit", color: "#1f4e79", hidden: false, visibilityInitialized: true, visibilityPresetVersion: VISIBILITY_PRESET_VERSION },
  { title: "전월세실거래가조회", panelIndex: 1003, kind: "tool", toolKey: "rent-trades", color: "#1f4e79", hidden: false, visibilityInitialized: true, visibilityPresetVersion: VISIBILITY_PRESET_VERSION },
  { title: "최우선임금 계산기", panelIndex: 1001, kind: "tool", toolKey: "priority-wage", color: "#1f4e79", hidden: false, visibilityInitialized: true, visibilityPresetVersion: VISIBILITY_PRESET_VERSION },
  { title: "근저당추출", panelIndex: 1002, kind: "tool", toolKey: "mortgage-extract", color: "#1f4e79", hidden: true, visibilityInitialized: true, visibilityPresetVersion: VISIBILITY_PRESET_VERSION }
];
const LEGACY_SMALL_DEPOSIT_PANEL = 10;
const FIXED_LABELS = {
  0: ["청현공지사항", "공지사항"],
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
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function compact(value) {
  return String(value || "").replace(/\s+/g, "").replace(/[📊📝📢❓⚖📚]/g, "").trim();
}

function validColor(value, fallback = "#1f4e79") {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback;
}

function inferGroup(menu) {
  const explicit = String(menu?.group || "").trim().toLowerCase();
  if (GROUPS[explicit]) return explicit;
  const title = compact(menu?.title).toLocaleLowerCase();
  if (title.includes("q&a") || title.includes("qna") || title.includes("질의")) return "qna";
  if (title.includes("임대차") || title.includes("임차") || title.includes("임금") || title.includes("조세")) return "work";
  if (title.includes("비고") || title.includes("감정평가") || title.includes("경매참고")) return "search";
  return "reference";
}

function visibilityKey(menu) {
  if (menu?.toolKey) return `tool:${menu.toolKey}`;
  const panelIndex = Number(menu?.panelIndex);
  return Number.isFinite(panelIndex) ? `panel:${panelIndex}` : "";
}

function applyInitialVisibility(menu) {
  if (Number(menu?.visibilityPresetVersion) === VISIBILITY_PRESET_VERSION) return menu;
  return {
    ...menu,
    hidden: !DEFAULT_VISIBLE_MENU_KEYS.has(visibilityKey(menu)),
    visibilityInitialized: true,
    visibilityPresetVersion: VISIBILITY_PRESET_VERSION
  };
}

function normalizeMenus(snapshot) {
  const source = Array.isArray(snapshot?.menus) ? snapshot.menus : [];
  const menus = source
    .filter(menu => Number(menu?.panelIndex) !== LEGACY_SMALL_DEPOSIT_PANEL || Boolean(menu?.toolKey))
    .map(menu => applyInitialVisibility({ ...menu }));
  const byTool = new Map(menus.filter(menu => menu.toolKey).map(menu => [menu.toolKey, menu]));
  for (const tool of TOOL_DEFAULTS) {
    if (!byTool.has(tool.toolKey)) menus.push({ ...tool });
  }
  return menus;
}

function isGroupable(menu) {
  const kind = String(menu?.kind || "panel");
  const panelIndex = Number(menu?.panelIndex);
  return kind === "panel" && ((panelIndex >= 1 && panelIndex <= 9) || panelIndex >= 14);
}

function buildBlocks(menus) {
  const blocks = [];
  const groups = new Map();
  for (const source of menus) {
    const menu = { ...source };
    if (!isGroupable(menu)) {
      blocks.push({ type: "menu", menu });
      continue;
    }
    const groupKey = inferGroup(menu);
    menu.group = groupKey;
    let block = groups.get(groupKey);
    if (!block) {
      block = { type: "group", groupKey, items: [], color: validColor(menu.groupColor || menu.color, "#334155") };
      groups.set(groupKey, block);
      blocks.push(block);
    }
    block.items.push(menu);
  }
  return blocks;
}

function flattenBlocks() {
  const menus = [];
  for (const block of workingBlocks) {
    if (block.type === "menu") {
      menus.push(block.menu);
      continue;
    }
    for (const item of block.items) {
      item.group = block.groupKey;
      item.groupColor = block.color;
      menus.push(item);
    }
  }
  return menus;
}

function ensureStyles() {
  if (document.getElementById("menu-admin-unified-styles")) return;
  const style = document.createElement("style");
  style.id = "menu-admin-unified-styles";
  style.textContent = `
    .local-menu-hidden{display:none!important}
    #limitedLoginBox{flex-wrap:wrap}
    #limitedLoginBox .local-menu-admin-btn{width:100%;margin-top:7px;padding:6px 10px;border:1px solid rgba(0,0,0,.2);border-radius:8px;background:rgba(255,255,255,.38);color:#111;font-size:11px;font-weight:900;cursor:pointer}
    #menuModal.menu-admin-unified .menu-table input,#menuModal.menu-admin-unified .menu-table select{width:100%;box-sizing:border-box}
    #menuModal.menu-admin-unified .menu-color-input{width:48px!important;height:32px;padding:2px;border:1px solid #cbd5e1;border-radius:6px;background:#fff}
    #menuModal.menu-admin-unified .order-actions{display:flex;gap:4px;justify-content:center}
    #menuModal.menu-admin-unified .group-row td{background:#e9eef7;font-weight:900;border-top:2px solid #cbd5e1}
    #menuModal.menu-admin-unified .child-row td:nth-child(2){padding-left:24px}
    #menuModal.menu-admin-unified .deleted-row{opacity:.45}
    #menuModal.menu-admin-unified .menu-status{font-size:11px;color:#64748b;white-space:nowrap}
  `;
  document.head.appendChild(style);
}

function ensureAdminButton() {
  const box = document.getElementById("limitedLoginBox");
  if (!box) return;
  let button = document.getElementById("localMenuEditBtn");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.id = "localMenuEditBtn";
    button.className = "local-menu-admin-btn";
    button.textContent = "메뉴 수정";
    box.appendChild(button);
  }
  button.onclick = () => void openEditor().catch(error => alert(`메뉴 편집 열기 실패: ${error.message}`));
  button.hidden = currentUser?.role !== "ADMIN";
}

function configureModal() {
  const modal = document.getElementById("menuModal");
  if (!modal) return;
  modal.classList.remove("local-menu-admin-mode");
  modal.classList.add("menu-admin-unified");
  modal.querySelector(".modal-title").textContent = "메뉴 수정";
  const help = modal.querySelector(".help-text");
  if (help) help.textContent = "모든 메뉴와 펼침메뉴의 순서·표시·색상을 변경할 수 있습니다. 색상칸을 클릭하면 원하는 색을 직접 선택할 수 있습니다.";
  const labels = ["순서", "제목", "패널", "색상", "펼침그룹", "상태", "삭제"];
  modal.querySelectorAll(".menu-table thead th").forEach((th, index) => { if (labels[index]) th.textContent = labels[index]; });
  const buttons = modal.querySelectorAll("button.small-btn");
  buttons.forEach((button, index) => {
    if (index === 0) {
      button.textContent = "게시판 추가";
      button.onclick = addBoard;
      button.style.display = "";
    } else if (index === 1) button.style.display = "none";
  });
}

function orderHtml(upDisabled, downDisabled, scope) {
  return `<div class="order-actions"><button type="button" class="small-btn" data-action="${scope}-up" ${upDisabled ? "disabled" : ""}>↑</button><button type="button" class="small-btn" data-action="${scope}-down" ${downDisabled ? "disabled" : ""}>↓</button></div>`;
}

function groupOptions(selected) {
  return GROUP_OPTIONS.map(([key, meta]) => `<option value="${key}" ${key === selected ? "selected" : ""}>${meta.title}</option>`).join("");
}

function renderMenuRow(tbody, block, blockIndex) {
  const menu = block.menu;
  const hidden = Boolean(menu.hidden);
  const tr = document.createElement("tr");
  if (hidden) tr.classList.add("deleted-row");
  tr.innerHTML = `
    <td>${orderHtml(blockIndex === 0, blockIndex === workingBlocks.length - 1, "block")}</td>
    <td><input data-field="title" value="${escapeHtml(menu.title || "")}"></td>
    <td><input value="${escapeHtml(menu.panelIndex ?? "자동")}" readonly></td>
    <td><input class="menu-color-input" data-field="color" type="color" value="${validColor(menu.color)}"></td>
    <td><span class="menu-status">단독 메뉴</span></td>
    <td><span class="menu-status">${hidden ? "숨김" : "표시"}</span></td>
    <td><button type="button" class="small-btn ${hidden ? "" : "danger"}" data-action="toggle">${hidden ? "복원" : "삭제"}</button></td>`;
  tr.querySelector('[data-field="title"]')?.addEventListener("input", e => { menu.title = e.target.value; });
  tr.querySelector('[data-field="color"]')?.addEventListener("input", e => { menu.color = e.target.value; });
  tr.querySelector('[data-action="block-up"]')?.addEventListener("click", () => moveBlock(blockIndex, -1));
  tr.querySelector('[data-action="block-down"]')?.addEventListener("click", () => moveBlock(blockIndex, 1));
  tr.querySelector('[data-action="toggle"]')?.addEventListener("click", () => { menu.hidden = !menu.hidden; renderTable(); });
  tbody.appendChild(tr);
}

function renderGroupRow(tbody, block, blockIndex) {
  const meta = GROUPS[block.groupKey];
  const tr = document.createElement("tr");
  tr.className = "group-row";
  const hidden = block.items.every(item => item.hidden);
  tr.innerHTML = `
    <td>${orderHtml(blockIndex === 0, blockIndex === workingBlocks.length - 1, "block")}</td>
    <td>${meta.icon} ${meta.title}</td>
    <td></td>
    <td><input class="menu-color-input" data-field="group-color" type="color" value="${validColor(block.color, "#334155")}"></td>
    <td><span class="menu-status">펼침메뉴</span></td>
    <td><span class="menu-status">${hidden ? "숨김" : "표시"}</span></td>
    <td><button type="button" class="small-btn ${hidden ? "" : "danger"}" data-action="group-toggle">${hidden ? "복원" : "삭제"}</button></td>`;
  tr.querySelector('[data-field="group-color"]')?.addEventListener("input", e => { block.color = e.target.value; });
  tr.querySelector('[data-action="block-up"]')?.addEventListener("click", () => moveBlock(blockIndex, -1));
  tr.querySelector('[data-action="block-down"]')?.addEventListener("click", () => moveBlock(blockIndex, 1));
  tr.querySelector('[data-action="group-toggle"]')?.addEventListener("click", () => {
    const nextHidden = !hidden;
    block.items.forEach(item => { item.hidden = nextHidden; });
    renderTable();
  });
  tbody.appendChild(tr);
  block.items.forEach((menu, itemIndex) => renderChildRow(tbody, block, blockIndex, menu, itemIndex));
}

function renderChildRow(tbody, block, blockIndex, menu, itemIndex) {
  const hidden = Boolean(menu.hidden);
  const tr = document.createElement("tr");
  tr.className = "child-row";
  if (hidden) tr.classList.add("deleted-row");
  tr.innerHTML = `
    <td>${orderHtml(itemIndex === 0, itemIndex === block.items.length - 1, "item")}</td>
    <td>↳ <input data-field="title" value="${escapeHtml(menu.title || "")}" style="width:calc(100% - 24px)"></td>
    <td><input value="${escapeHtml(menu.panelIndex ?? "자동")}" readonly></td>
    <td><input class="menu-color-input" data-field="color" type="color" value="${validColor(menu.color)}"></td>
    <td><select data-field="group">${groupOptions(block.groupKey)}</select></td>
    <td><span class="menu-status">${hidden ? "숨김" : "표시"}</span></td>
    <td><button type="button" class="small-btn ${hidden ? "" : "danger"}" data-action="toggle">${hidden ? "복원" : "삭제"}</button></td>`;
  tr.querySelector('[data-field="title"]')?.addEventListener("input", e => { menu.title = e.target.value; });
  tr.querySelector('[data-field="color"]')?.addEventListener("input", e => { menu.color = e.target.value; });
  tr.querySelector('[data-field="group"]')?.addEventListener("change", e => changeGroup(blockIndex, itemIndex, e.target.value));
  tr.querySelector('[data-action="item-up"]')?.addEventListener("click", () => moveItem(blockIndex, itemIndex, -1));
  tr.querySelector('[data-action="item-down"]')?.addEventListener("click", () => moveItem(blockIndex, itemIndex, 1));
  tr.querySelector('[data-action="toggle"]')?.addEventListener("click", () => { menu.hidden = !menu.hidden; renderTable(); });
  tbody.appendChild(tr);
}

function renderTable() {
  const tbody = document.getElementById("menuTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  workingBlocks.forEach((block, index) => block.type === "group" ? renderGroupRow(tbody, block, index) : renderMenuRow(tbody, block, index));
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

function changeGroup(blockIndex, itemIndex, nextGroup) {
  if (!GROUPS[nextGroup]) return;
  const source = workingBlocks[blockIndex];
  if (!source || source.type !== "group") return;
  const [menu] = source.items.splice(itemIndex, 1);
  if (!menu) return;
  menu.group = nextGroup;
  let target = workingBlocks.find(block => block.type === "group" && block.groupKey === nextGroup);
  if (!target) {
    target = { type: "group", groupKey: nextGroup, items: [], color: "#334155" };
    workingBlocks.splice(Math.min(blockIndex + 1, workingBlocks.length), 0, target);
  }
  target.items.push(menu);
  if (!source.items.length) workingBlocks.splice(workingBlocks.indexOf(source), 1);
  renderTable();
}

function addBoard() {
  let block = workingBlocks.find(item => item.type === "group" && item.groupKey === "reference");
  if (!block) {
    block = { type: "group", groupKey: "reference", items: [], color: "#334155" };
    workingBlocks.push(block);
  }
  block.items.push({ title: "새 게시판", panelIndex: null, kind: "panel", group: "reference", color: "#1f4e79", hidden: false, visibilityInitialized: true, visibilityPresetVersion: VISIBILITY_PRESET_VERSION });
  renderTable();
}

async function openEditor() {
  if (currentUser?.role !== "ADMIN") return alert("관리자만 수정할 수 있습니다.");
  const snapshot = await api("/shared-pages");
  workingBlocks = buildBlocks(normalizeMenus(snapshot));
  configureModal();
  renderTable();
  document.getElementById("menuModal")?.classList.add("show");
}

async function saveMenus() {
  if (saving) return;
  const menus = flattenBlocks();
  if (menus.some(menu => !menu.hidden && !String(menu.title || "").trim())) return alert("메뉴 제목을 입력해주세요.");
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

function fixedButtonForPanel(panelIndex) {
  if (panelIndex === 0) return document.querySelector('.nav-item[data-local-shared-menu="notice"], .nav-item-notice');
  const labels = FIXED_LABELS[panelIndex] || [];
  return Array.from(document.querySelectorAll("#topNav > .nav-item, #bottomNav > .nav-item"))
    .find(button => labels.includes(compact(button.textContent))) || null;
}

function buttonForMenu(menu) {
  if (menu.toolKey) return document.querySelector(`.nav-item[data-local-tool="${menu.toolKey}"]`);
  const panelIndex = Number(menu.panelIndex);
  const byPanel = document.querySelector(`.nav-item[data-local-shared-panel-index="${panelIndex}"]`);
  if (byPanel) return byPanel;
  const fixed = fixedButtonForPanel(panelIndex);
  if (fixed) return fixed;
  return Array.from(document.querySelectorAll("#topNav > .nav-item, #bottomNav > .nav-item"))
    .find(button => compact(button.textContent) === compact(menu.title)) || null;
}

function panelForMenu(menu) {
  if (menu.toolKey) return document.querySelector(`.sheet-panel[data-local-tool="${menu.toolKey}"]`);
  return document.querySelector(`.sheet-panel[data-index="${Number(menu.panelIndex)}"]`);
}

function applyButtonStyle(button, menu) {
  if (!button) return;
  const hidden = Boolean(menu.hidden);
  button.classList.toggle("local-menu-hidden", hidden);
  button.dataset.localSharedPublic = "1";
  button.style.setProperty("background", validColor(menu.color), "important");
  button.style.setProperty("border-color", validColor(menu.color), "important");
  if (!hidden && menu.title && button.textContent !== menu.title) button.textContent = menu.title;
}

function ensureGroupShell(groupKey, color) {
  const topNav = document.getElementById("topNav");
  if (!topNav) return null;
  const meta = GROUPS[groupKey];
  let toggle = topNav.querySelector(`[data-unified-group-toggle="${groupKey}"]`);
  let wrap = topNav.querySelector(`[data-unified-group-wrap="${groupKey}"]`);
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-item local-board-group-toggle";
    toggle.dataset.localSharedPublic = "1";
    toggle.dataset.unifiedGroupToggle = groupKey;
    toggle.innerHTML = `<span>${meta.icon} ${meta.title}</span><span class="group-arrow">▶</span>`;
    toggle.addEventListener("click", () => {
      const expanded = wrap.hidden;
      wrap.hidden = !expanded;
      toggle.classList.toggle("expanded", expanded);
      toggle.querySelector(".group-arrow").textContent = expanded ? "▼" : "▶";
    });
    topNav.appendChild(toggle);
  }
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "local-board-subgroup";
    wrap.dataset.unifiedGroupWrap = groupKey;
    wrap.hidden = true;
    topNav.appendChild(wrap);
  }
  toggle.style.setProperty("background", validColor(color, "#334155"), "important");
  toggle.style.setProperty("border-color", validColor(color, "#334155"), "important");
  return { toggle, wrap };
}

function presentationKey(menus) {
  return JSON.stringify(menus.map(menu => [menu.title, menu.panelIndex, menu.kind, menu.toolKey, menu.group, menu.color, menu.groupColor, Boolean(menu.hidden), Number(menu.visibilityPresetVersion) || 0]));
}

function presentationHealthy(menus) {
  return menus.every(menu => {
    const button = buttonForMenu(menu);
    if (!button) return false;
    return button.classList.contains("local-menu-hidden") === Boolean(menu.hidden);
  });
}

function applyPresentation(snapshot) {
  const menus = normalizeMenus(snapshot);
  const key = presentationKey(menus);
  if (key === lastPresentationKey && presentationHealthy(menus)) return;
  lastPresentationKey = key;

  const topNav = document.getElementById("topNav");
  if (!topNav) return;
  const blocks = buildBlocks(menus);

  for (const menu of menus) {
    const button = buttonForMenu(menu);
    const panel = panelForMenu(menu);
    applyButtonStyle(button, menu);
    if (panel) panel.classList.toggle("local-menu-hidden", Boolean(menu.hidden));
  }

  for (const block of blocks) {
    if (block.type === "menu") {
      const button = buttonForMenu(block.menu);
      if (button) topNav.appendChild(button);
      continue;
    }

    const shell = ensureGroupShell(block.groupKey, block.color);
    if (!shell) continue;
    let visible = false;
    block.items.forEach(item => {
      const button = buttonForMenu(item);
      if (!button) return;
      applyButtonStyle(button, item);
      button.classList.add("local-board-sub-item");
      shell.wrap.appendChild(button);
      if (!item.hidden) visible = true;
    });
    shell.toggle.classList.toggle("local-menu-hidden", !visible);
    shell.wrap.classList.toggle("local-menu-hidden", !visible);
    topNav.appendChild(shell.toggle);
    topNav.appendChild(shell.wrap);
  }

  document.querySelector('.sheet-panel[data-index="10"]')?.classList.add("local-menu-hidden");
  Array.from(document.querySelectorAll("#topNav > .nav-item"))
    .filter(button => !button.dataset.localTool && compact(button.textContent) === "소액조회")
    .forEach(button => button.classList.add("local-menu-hidden"));
}

async function syncUser() {
  try { currentUser = await api("/auth/me"); }
  catch (error) { if (error.status === 401) currentUser = null; else throw error; }
  ensureAdminButton();
}

function bind() {
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("#menuModal.menu-admin-unified .primary-btn")) {
      event.preventDefault(); event.stopImmediatePropagation();
      void saveMenus().catch(error => alert(`메뉴 저장 실패: ${error.message}`));
    } else if (target.closest("#menuModal.menu-admin-unified .secondary-btn")) {
      event.preventDefault(); event.stopImmediatePropagation();
      document.getElementById("menuModal")?.classList.remove("show");
    }
  }, true);

  document.addEventListener("submit", event => {
    if (event.target?.matches?.("#grv2LoginForm,#allocationLoginForm")) {
      setTimeout(() => void syncUser(), 250);
      setTimeout(() => void syncUser(), 900);
    }
  }, true);

  window.addEventListener("local-shared-pages-loaded", event => {
    if (event?.detail) applyPresentation(event.detail);
    ensureAdminButton();
  });
}

ensureStyles();
bind();
[0, 250, 800, 1600].forEach(delay => setTimeout(() => void syncUser(), delay));
