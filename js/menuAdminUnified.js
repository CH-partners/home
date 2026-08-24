const API_ROOT = "/api/v1";
const GROUPS = {
  qna: { title: "Q&A", icon: "❓" },
  work: { title: "법정선순위", icon: "" },
  search: { title: "비고문구", icon: "📝" },
  reference: { title: "공유자료", icon: "📚" }
};
const GROUP_OPTIONS = Object.entries(GROUPS);
const LEGACY_SMALL_DEPOSIT_PANEL = 10;

let currentUser = null;
let workingBlocks = [];
let saving = false;
let lastSnapshot = null;
let applyingPresentation = false;
let replayTimer = null;

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
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[📊📝📢❓⚖📚]/g, "")
    .trim();
}

function validColor(value, fallback = "#1f4e79") {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback;
}

function normalizeMenus(snapshot) {
  const source = Array.isArray(snapshot?.menus) ? snapshot.menus : [];
  return source
    .filter(menu => Number(menu?.panelIndex) !== LEGACY_SMALL_DEPOSIT_PANEL || Boolean(menu?.toolKey))
    .map(menu => ({ ...menu }));
}

function isGroupable(menu) {
  return Boolean(GROUPS[String(menu?.group || "").trim().toLowerCase()]);
}

function buildBlocks(menus) {
  const blocks = [];
  const groups = new Map();

  for (const source of menus) {
    const menu = { ...source };
    const groupKey = String(menu.group || "").trim().toLowerCase();
    if (!isGroupable(menu)) {
      blocks.push({ type: "menu", menu });
      continue;
    }

    let block = groups.get(groupKey);
    if (!block) {
      block = {
        type: "group",
        groupKey,
        title: String(menu.groupTitle || GROUPS[groupKey].title).trim() || GROUPS[groupKey].title,
        items: [],
        color: validColor(menu.groupColor || menu.color, "#334155")
      };
      groups.set(groupKey, block);
      blocks.push(block);
    } else if (!block.title && menu.groupTitle) {
      block.title = String(menu.groupTitle).trim();
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
    const groupTitle = String(block.title || GROUPS[block.groupKey]?.title || block.groupKey).trim();
    for (const item of block.items) {
      item.group = block.groupKey;
      item.groupTitle = groupTitle;
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
    #menuModal.menu-admin-unified .group-title-input{font-weight:900;background:#fff}
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
  if (help) help.textContent = "모든 메뉴와 펼침메뉴 이름을 직접 수정할 수 있습니다. 저장된 이름·순서·그룹·표시 여부는 모든 로그인 상태에 동일하게 적용됩니다.";
  const labels = ["순서", "제목", "패널", "색상", "펼침그룹", "상태", "삭제"];
  modal.querySelectorAll(".menu-table thead th").forEach((th, index) => {
    if (labels[index]) th.textContent = labels[index];
  });
  const buttons = modal.querySelectorAll("button.small-btn");
  buttons.forEach((button, index) => {
    if (index === 0) {
      button.textContent = "게시판 추가";
      button.onclick = addBoard;
      button.style.display = "";
    } else if (index === 1) {
      button.style.display = "none";
    }
  });
}

function orderHtml(upDisabled, downDisabled, scope) {
  return `<div class="order-actions"><button type="button" class="small-btn" data-action="${scope}-up" ${upDisabled ? "disabled" : ""}>↑</button><button type="button" class="small-btn" data-action="${scope}-down" ${downDisabled ? "disabled" : ""}>↓</button></div>`;
}

function groupOptions(selected) {
  return [
    '<option value=""' + (!selected ? ' selected' : '') + '>단독</option>',
    ...GROUP_OPTIONS.map(([key, meta]) => `<option value="${key}" ${key === selected ? "selected" : ""}>${meta.title}</option>`)
  ].join("");
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
    <td><select data-field="group">${groupOptions("")}</select></td>
    <td><span class="menu-status">${hidden ? "숨김" : "표시"}</span></td>
    <td><button type="button" class="small-btn ${hidden ? "" : "danger"}" data-action="toggle">${hidden ? "복원" : "숨김"}</button></td>`;
  tr.querySelector('[data-field="title"]')?.addEventListener("input", e => { menu.title = e.target.value; });
  tr.querySelector('[data-field="color"]')?.addEventListener("input", e => { menu.color = e.target.value; });
  tr.querySelector('[data-field="group"]')?.addEventListener("change", e => changeStandaloneGroup(blockIndex, e.target.value));
  tr.querySelector('[data-action="block-up"]')?.addEventListener("click", () => moveBlock(blockIndex, -1));
  tr.querySelector('[data-action="block-down"]')?.addEventListener("click", () => moveBlock(blockIndex, 1));
  tr.querySelector('[data-action="toggle"]')?.addEventListener("click", () => { menu.hidden = !menu.hidden; renderTable(); });
  tbody.appendChild(tr);
}

function renderGroupRow(tbody, block, blockIndex) {
  const tr = document.createElement("tr");
  tr.className = "group-row";
  const hidden = block.items.every(item => item.hidden);
  tr.innerHTML = `
    <td>${orderHtml(blockIndex === 0, blockIndex === workingBlocks.length - 1, "block")}</td>
    <td><input class="group-title-input" data-field="group-title" value="${escapeHtml(block.title || GROUPS[block.groupKey].title)}"></td>
    <td></td>
    <td><input class="menu-color-input" data-field="group-color" type="color" value="${validColor(block.color, "#334155")}"></td>
    <td><span class="menu-status">펼침메뉴</span></td>
    <td><span class="menu-status">${hidden ? "숨김" : "표시"}</span></td>
    <td><button type="button" class="small-btn ${hidden ? "" : "danger"}" data-action="group-toggle">${hidden ? "복원" : "전체 숨김"}</button></td>`;
  tr.querySelector('[data-field="group-title"]')?.addEventListener("input", e => { block.title = e.target.value; });
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
    <td><button type="button" class="small-btn ${hidden ? "" : "danger"}" data-action="toggle">${hidden ? "복원" : "숨김"}</button></td>`;
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

function changeStandaloneGroup(blockIndex, nextGroup) {
  const block = workingBlocks[blockIndex];
  if (!block || block.type !== "menu" || !GROUPS[nextGroup]) return;
  const menu = block.menu;
  menu.group = nextGroup;
  let target = workingBlocks.find(item => item.type === "group" && item.groupKey === nextGroup);
  if (!target) {
    target = { type: "group", groupKey: nextGroup, title: GROUPS[nextGroup].title, items: [], color: "#334155" };
    workingBlocks.splice(blockIndex, 0, target);
  }
  target.items.push(menu);
  const sourceIndex = workingBlocks.indexOf(block);
  if (sourceIndex >= 0) workingBlocks.splice(sourceIndex, 1);
  renderTable();
}

function changeGroup(blockIndex, itemIndex, nextGroup) {
  const source = workingBlocks[blockIndex];
  if (!source || source.type !== "group") return;
  const [menu] = source.items.splice(itemIndex, 1);
  if (!menu) return;

  if (!nextGroup) {
    menu.group = "";
    delete menu.groupTitle;
    const insertIndex = Math.min(blockIndex + 1, workingBlocks.length);
    workingBlocks.splice(insertIndex, 0, { type: "menu", menu });
  } else if (GROUPS[nextGroup]) {
    menu.group = nextGroup;
    let target = workingBlocks.find(block => block.type === "group" && block.groupKey === nextGroup);
    if (!target) {
      target = { type: "group", groupKey: nextGroup, title: GROUPS[nextGroup].title, items: [], color: "#334155" };
      workingBlocks.splice(Math.min(blockIndex + 1, workingBlocks.length), 0, target);
    }
    target.items.push(menu);
  }

  if (!source.items.length) {
    const sourceIndex = workingBlocks.indexOf(source);
    if (sourceIndex >= 0) workingBlocks.splice(sourceIndex, 1);
  }
  renderTable();
}

function addBoard() {
  workingBlocks.push({
    type: "menu",
    menu: { title: "새 게시판", panelIndex: null, kind: "panel", group: "", color: "#1f4e79", hidden: false }
  });
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
  if (workingBlocks.some(block => block.type === "group" && !String(block.title || "").trim())) return alert("펼침메뉴 이름을 입력해주세요.");
  if (menus.some(menu => !menu.hidden && !String(menu.title || "").trim())) return alert("메뉴 제목을 입력해주세요.");
  saving = true;
  try {
    const snapshot = await api("/shared-pages/menus", {
      method: "PUT",
      body: JSON.stringify({ menus, notice: {}, page_contents: {} })
    });
    document.getElementById("menuModal")?.classList.remove("show");
    applyPresentation(snapshot);
    window.localSharedPagesApi?.refresh?.();
    alert("메뉴가 저장되었습니다.");
  } finally {
    saving = false;
  }
}

function menuKey(menu) {
  if (menu?.toolKey) return `tool:${menu.toolKey}`;
  const panelIndex = Number(menu?.panelIndex);
  if (Number.isFinite(panelIndex)) return `panel:${panelIndex}`;
  return `title:${compact(menu?.title)}`;
}

function ensurePanel(menu) {
  if (menu.toolKey) return document.querySelector(`.sheet-panel[data-local-tool="${menu.toolKey}"]`);
  const panelIndex = Number(menu.panelIndex);
  let panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);
  if (panel || !Number.isFinite(panelIndex)) return panel;

  panel = document.createElement("div");
  panel.className = "sheet-panel";
  panel.dataset.index = String(panelIndex);
  panel.dataset.localAuthoritativePlaceholder = "1";
  panel.innerHTML = `<header class="sheet-header"><h1>${escapeHtml(menu.title || "메뉴")}</h1></header><section class="major-card"><div class="note">로그인 후 내용을 확인할 수 있습니다.</div></section>`;
  document.querySelector(".main")?.appendChild(panel);
  return panel;
}

function showMenu(menu, button) {
  document.querySelectorAll(".sheet-panel").forEach(panel => panel.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
  const panel = ensurePanel(menu);
  panel?.classList.add("active");
  button?.classList.add("active");

  const panelIndex = Number(menu.panelIndex);
  if (panelIndex === 11) setTimeout(() => window.allocationApi?.refresh?.(), 0);
  if (panelIndex === 12) setTimeout(() => window.scheduleApi?.refresh?.(), 0);
  if (panelIndex === 13) setTimeout(() => window.groupReviewApi?.refresh?.(), 0);
}

function ensureButton(menu) {
  const topNav = document.getElementById("topNav");
  if (!topNav) return null;
  const key = menuKey(menu);
  let button = topNav.querySelector(`.nav-item[data-authoritative-menu-key="${CSS.escape(key)}"]`);
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "nav-item";
    button.dataset.authoritativeMenu = "1";
    button.dataset.authoritativeMenuKey = key;
    button.addEventListener("click", () => {
      const current = lastSnapshot?.menus?.find(item => menuKey(item) === key) || menu;
      showMenu(current, button);
    });
    topNav.appendChild(button);
  }
  button.dataset.authoritativeMenu = "1";
  if (menu.toolKey) button.dataset.localTool = menu.toolKey;
  else delete button.dataset.localTool;
  if (Number.isFinite(Number(menu.panelIndex))) button.dataset.localSharedPanelIndex = String(Number(menu.panelIndex));
  button.dataset.localSharedPublic = "1";
  button.textContent = menu.title || "메뉴";
  return button;
}

function applyButtonState(button, menu) {
  if (!button) return;
  button.classList.toggle("local-menu-hidden", Boolean(menu.hidden));
  button.style.removeProperty("background");
  button.style.removeProperty("border-color");
  button.style.setProperty("color", "#ffffff", "important");
}

function ensureGroupShell(groupKey, groupTitle) {
  const topNav = document.getElementById("topNav");
  if (!topNav) return null;
  const meta = GROUPS[groupKey];
  let toggle = topNav.querySelector(`[data-authoritative-group="${groupKey}"]`);
  let wrap = topNav.querySelector(`[data-authoritative-group-wrap="${groupKey}"]`);

  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-item local-board-group-toggle";
    toggle.dataset.authoritativeMenu = "1";
    toggle.dataset.authoritativeGroup = groupKey;
    toggle.dataset.localSharedPublic = "1";
    toggle.addEventListener("click", () => {
      const expanded = wrap?.hidden !== false;
      if (wrap) wrap.hidden = !expanded;
      toggle.classList.toggle("expanded", expanded);
      const arrow = toggle.querySelector(".group-arrow");
      if (arrow) arrow.textContent = expanded ? "▼" : "▶";
    });
    topNav.appendChild(toggle);
  }

  const displayTitle = String(groupTitle || meta.title).trim() || meta.title;
  const label = `${meta.icon ? `${meta.icon} ` : ""}${displayTitle}`;
  toggle.innerHTML = `<span>${escapeHtml(label)}</span><span class="group-arrow">${toggle.classList.contains("expanded") ? "▼" : "▶"}</span>`;

  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "local-board-subgroup";
    wrap.dataset.authoritativeGroupWrap = groupKey;
    wrap.hidden = true;
    topNav.appendChild(wrap);
  }
  return { toggle, wrap };
}

function hideLegacyNavigation() {
  document.querySelectorAll("#topNav .nav-item, #bottomNav .nav-item").forEach(button => {
    if (button.dataset.authoritativeMenu === "1") return;
    button.classList.add("local-menu-hidden");
  });
  document.querySelectorAll("#topNav .nav-group-toggle, #topNav .nav-sub-group, #topNav .nav-divider, #bottomNav .nav-divider").forEach(node => {
    node.classList.add("local-menu-hidden");
  });
}

function removeStaleAuthoritativeNodes(menus) {
  const validKeys = new Set(menus.map(menuKey));
  document.querySelectorAll('[data-authoritative-menu-key]').forEach(button => {
    if (!validKeys.has(button.dataset.authoritativeMenuKey)) button.remove();
  });

  const activeGroups = new Set(menus.map(menu => String(menu.group || "").trim().toLowerCase()).filter(key => GROUPS[key]));
  document.querySelectorAll('[data-authoritative-group]').forEach(toggle => {
    if (!activeGroups.has(toggle.dataset.authoritativeGroup)) toggle.remove();
  });
  document.querySelectorAll('[data-authoritative-group-wrap]').forEach(wrap => {
    if (!activeGroups.has(wrap.dataset.authoritativeGroupWrap)) wrap.remove();
  });
}

function applyPresentation(snapshot) {
  if (!snapshot || applyingPresentation) return;
  applyingPresentation = true;
  try {
    lastSnapshot = {
      ...snapshot,
      menus: normalizeMenus(snapshot)
    };
    const menus = lastSnapshot.menus;
    const topNav = document.getElementById("topNav");
    if (!topNav) return;

    hideLegacyNavigation();
    removeStaleAuthoritativeNodes(menus);

    const blocks = buildBlocks(menus);
    for (const menu of menus) {
      const panel = ensurePanel(menu);
      if (panel) {
        panel.classList.toggle("local-menu-hidden", Boolean(menu.hidden));
        if (!menu.hidden) panel.dataset.localSharedPublicReady = "1";
        else delete panel.dataset.localSharedPublicReady;
      }
    }

    for (const block of blocks) {
      if (block.type === "menu") {
        const button = ensureButton(block.menu);
        applyButtonState(button, block.menu);
        button?.classList.remove("local-board-sub-item");
        if (button) topNav.appendChild(button);
        continue;
      }

      const shell = ensureGroupShell(block.groupKey, block.title);
      if (!shell) continue;
      let visible = false;
      for (const item of block.items) {
        const button = ensureButton(item);
        applyButtonState(button, item);
        button?.classList.add("local-board-sub-item");
        if (button) shell.wrap.appendChild(button);
        if (!item.hidden) visible = true;
      }
      shell.toggle.classList.toggle("local-menu-hidden", !visible);
      shell.wrap.classList.toggle("local-menu-hidden", !visible);
      topNav.appendChild(shell.toggle);
      topNav.appendChild(shell.wrap);
    }

    hideLegacyNavigation();
  } finally {
    queueMicrotask(() => { applyingPresentation = false; });
  }
}

function installNavigationReplayObserver() {
  const topNav = document.getElementById("topNav");
  if (!topNav || topNav.dataset.authoritativeObserverInstalled === "1") return;
  topNav.dataset.authoritativeObserverInstalled = "1";
  const observer = new MutationObserver(() => {
    if (applyingPresentation || !lastSnapshot) return;
    clearTimeout(replayTimer);
    replayTimer = setTimeout(() => applyPresentation(lastSnapshot), 30);
  });
  observer.observe(topNav, { childList: true, subtree: true });
}

async function syncUser() {
  try {
    currentUser = await api("/auth/me");
  } catch (error) {
    if (error.status === 401) currentUser = null;
    else throw error;
  }
  ensureAdminButton();
}

function bind() {
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("#menuModal.menu-admin-unified .primary-btn")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void saveMenus().catch(error => alert(`메뉴 저장 실패: ${error.message}`));
    } else if (target.closest("#menuModal.menu-admin-unified .secondary-btn")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.getElementById("menuModal")?.classList.remove("show");
    }
  }, true);

  window.addEventListener("local-shared-pages-loaded", event => {
    if (event?.detail) applyPresentation(event.detail);
    ensureAdminButton();
  });
}

ensureStyles();
bind();
installNavigationReplayObserver();
[0, 250, 800, 1600].forEach(delay => setTimeout(() => {
  installNavigationReplayObserver();
  void syncUser();
}, delay));
