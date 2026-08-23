const API_ROOT = "/api/v1";
const FIXED_BOARDS = [
  { panelIndex: 1, key: "rent", title: "임대차", group: "work" },
  { panelIndex: 2, key: "wage", title: "임금", group: "work" },
  { panelIndex: 3, key: "tax", title: "조세", group: "work" },
  { panelIndex: 4, key: "tenantqa", title: "선순위임차인Q&A", group: "qna" },
  { panelIndex: 5, key: "guaranteeqa", title: "보증서Q&A", group: "qna" },
  { panelIndex: 6, key: "securedqa", title: "피담보채무Q&A", group: "qna" },
  { panelIndex: 7, key: "saleqa", title: "매각대상여부Q&A", group: "qna" },
  { panelIndex: 8, key: "browseqa", title: "열람자료Q&A", group: "qna" },
  { panelIndex: 9, key: "machineqa", title: "기계기구Q&A", group: "qna" }
];
const BOARD_GROUPS = [
  { key: "qna", title: "Q&A", icon: "❓" },
  { key: "work", title: "법정선순위", icon: "⚖" },
  { key: "search", title: "비고문구", icon: "📝" },
  { key: "reference", title: "공유자료", icon: "📚" }
];
const NON_BOARD_PANEL_INDEXES = new Set([0, 10, 11, 12, 13]);
const groupState = {};
let legacySettingsPromise = null;
let importInFlight = false;

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

function compact(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function titleKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}&]+/gu, "");
}

function isGeneralBoard(menu) {
  return compact(menu?.title) === "일반게시판";
}

function isLegacyBoardMenu(menu) {
  const panelIndex = Number(menu?.panelIndex);
  const kind = String(menu?.kind || "panel").trim().toLowerCase();
  const group = String(menu?.group || "").trim().toLowerCase();
  return Boolean(
    titleKey(menu?.title) &&
    Number.isFinite(panelIndex) &&
    !NON_BOARD_PANEL_INDEXES.has(panelIndex) &&
    kind !== "iframe" &&
    group !== "tool"
  );
}

function fixedBoardForPanel(panelIndex) {
  return FIXED_BOARDS.find(item => item.panelIndex === Number(panelIndex)) || null;
}

function contentKeyForPanel(panelIndex) {
  return fixedBoardForPanel(panelIndex)?.key || `panel_${Number(panelIndex)}`;
}

function inferGroup(menu, panelIndex) {
  const explicit = String(menu?.group || "").trim().toLowerCase();
  if (BOARD_GROUPS.some(group => group.key === explicit)) return explicit;

  const fixed = fixedBoardForPanel(panelIndex);
  if (fixed) return fixed.group;

  const title = compact(menu?.title).toLocaleLowerCase();
  if (title.includes("q&a") || title.includes("qna") || title.includes("질의")) return "qna";
  if (title.includes("임대차") || title.includes("임차") || title.includes("임금") || title.includes("조세") || title.includes("법정선순위")) return "work";
  if (title.includes("비고") || title.includes("경매참고") || title.includes("감정평가")) return "search";
  return "reference";
}

function updateGroupDisplay(groupKey) {
  const topNav = document.getElementById("topNav");
  if (!topNav) return;
  const toggle = topNav.querySelector(`[data-local-board-group-toggle="${groupKey}"]`);
  const wrap = topNav.querySelector(`[data-local-board-group-wrap="${groupKey}"]`);
  if (!toggle || !wrap) return;

  const expanded = Boolean(groupState[groupKey]);
  toggle.classList.toggle("expanded", expanded);
  toggle.setAttribute("aria-expanded", String(expanded));
  wrap.hidden = !expanded;
  const arrow = toggle.querySelector(".local-board-group-arrow");
  if (arrow) arrow.textContent = expanded ? "▼" : "▶";
}

function ensureGroup(groupKey) {
  const topNav = document.getElementById("topNav");
  const config = BOARD_GROUPS.find(group => group.key === groupKey);
  if (!topNav || !config) return null;

  let toggle = topNav.querySelector(`[data-local-board-group-toggle="${groupKey}"]`);
  let wrap = topNav.querySelector(`[data-local-board-group-wrap="${groupKey}"]`);

  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-item local-board-group-toggle";
    toggle.dataset.localSharedPublic = "1";
    toggle.dataset.localBoardGroupToggle = groupKey;
    toggle.innerHTML = `
      <span class="local-board-group-label"><span aria-hidden="true">${config.icon}</span><span>${config.title}</span></span>
      <span class="local-board-group-arrow" aria-hidden="true">▶</span>
    `;
    toggle.addEventListener("click", () => {
      groupState[groupKey] = !groupState[groupKey];
      updateGroupDisplay(groupKey);
    });
    topNav.appendChild(toggle);
  }

  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "local-board-subgroup";
    wrap.dataset.localBoardGroupWrap = groupKey;
    topNav.appendChild(wrap);
  }

  updateGroupDisplay(groupKey);
  return wrap;
}

function moveButtonToGroup(button, groupKey) {
  if (!button) return;
  const wrap = ensureGroup(groupKey);
  if (!wrap) return;

  button.dataset.localSharedPublic = "1";
  button.classList.add("local-board-sub-item");
  if (button.parentElement !== wrap) wrap.appendChild(button);
}

function findFixedButton(fixed) {
  return document.querySelector(`.nav-item[data-local-shared-public-key="${fixed.key}"]`);
}

function findDynamicButton(panelIndex) {
  return document.querySelector(`.nav-item[data-local-shared-menu="dynamic"][data-local-shared-panel-index="${panelIndex}"]`);
}

function renderFixedGroups(snapshot) {
  const contents = snapshot?.page_contents || {};
  for (const fixed of FIXED_BOARDS) {
    if (!contents[fixed.key]) continue;
    const button = findFixedButton(fixed);
    if (!button) continue;
    moveButtonToGroup(button, fixed.group);
  }
}

function renderDynamicGroups(snapshot) {
  const menus = Array.isArray(snapshot?.menus) ? snapshot.menus : [];
  const contents = snapshot?.page_contents || {};

  for (const menu of menus) {
    const panelIndex = Number(menu?.panelIndex);
    if (!Number.isFinite(panelIndex) || panelIndex <= 13 || menu?.kind === "iframe" || isGeneralBoard(menu)) continue;

    const contentKey = contentKeyForPanel(panelIndex);
    if (!contents[contentKey]) continue;

    const panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);
    if (panel) panel.dataset.localSharedPublicReady = "1";

    const button = findDynamicButton(panelIndex);
    if (!button) continue;
    button.dataset.localSharedPublicKey = contentKey;
    moveButtonToGroup(button, inferGroup(menu, panelIndex));
  }
}

function orderGroups() {
  const topNav = document.getElementById("topNav");
  if (!topNav) return;

  for (const group of BOARD_GROUPS) {
    const toggle = topNav.querySelector(`[data-local-board-group-toggle="${group.key}"]`);
    const wrap = topNav.querySelector(`[data-local-board-group-wrap="${group.key}"]`);
    if (!toggle || !wrap) continue;

    if (!wrap.querySelector(".nav-item")) {
      toggle.remove();
      wrap.remove();
      continue;
    }

    topNav.appendChild(toggle);
    topNav.appendChild(wrap);
    updateGroupDisplay(group.key);
  }
}

function ensureStyles() {
  if (document.getElementById("legacy-board-local-styles")) return;
  const style = document.createElement("style");
  style.id = "legacy-board-local-styles";
  style.textContent = `
    body.limited-deployment-mode #topNav > .local-board-group-toggle{
      width:calc(100% - 12px)!important;
      min-width:0!important;
      height:40px!important;
      margin:0 0 0 12px!important;
      padding:0 14px!important;
      justify-content:space-between!important;
      text-align:left!important;
      border:1px solid rgba(255,255,255,.28)!important;
      border-right:0!important;
      border-radius:12px 0 0 12px!important;
      background:rgba(255,255,255,.08)!important;
      color:#e8eef8!important;
      font-size:13px!important;
      font-weight:800!important;
      box-shadow:none!important;
    }
    body.limited-deployment-mode #topNav > .local-board-group-toggle:hover,
    body.limited-deployment-mode #topNav > .local-board-group-toggle.expanded{
      background:rgba(255,255,255,.16)!important;
      color:#ffffff!important;
      transform:none!important;
    }
    .local-board-group-label{display:flex;align-items:center;gap:8px;min-width:0}
    .local-board-group-arrow{font-size:10px;flex:0 0 auto}
    .local-board-subgroup{display:flex;flex-direction:column;gap:4px;margin:0 0 4px 0}
    .local-board-subgroup[hidden]{display:none!important}
    body.limited-deployment-mode #topNav .local-board-subgroup > .local-board-sub-item{
      width:calc(100% - 28px)!important;
      min-width:0!important;
      height:30px!important;
      margin:0 0 0 28px!important;
      padding:4px 10px!important;
      justify-content:flex-start!important;
      text-align:left!important;
      border:0!important;
      border-radius:8px 0 0 8px!important;
      background:rgba(255,255,255,.035)!important;
      color:#dbe7f7!important;
      font-size:12px!important;
      font-weight:600!important;
      overflow:hidden!important;
      white-space:nowrap!important;
      text-overflow:ellipsis!important;
      box-shadow:none!important;
    }
    body.limited-deployment-mode #topNav .local-board-subgroup > .local-board-sub-item:hover{
      background:rgba(255,255,255,.12)!important;
      color:#ffffff!important;
      font-size:12px!important;
      transform:translateX(2px)!important;
    }
    body.limited-deployment-mode #topNav .local-board-subgroup > .local-board-sub-item.active{
      background:#f7f9fc!important;
      color:#1f4e79!important;
      font-size:12px!important;
      font-weight:800!important;
      transform:none!important;
    }
  `;
  document.head.appendChild(style);
}

function renderBoardGroups(snapshot) {
  ensureStyles();
  renderFixedGroups(snapshot);
  renderDynamicGroups(snapshot);
  orderGroups();
}

async function readLegacyFirebaseSettings() {
  if (legacySettingsPromise) return legacySettingsPromise;

  legacySettingsPromise = (async () => {
    try {
      const [{ getApps }, { getFirestore, doc, getDoc }] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js")
      ]);
      const app = getApps()[0];
      if (!app) return null;
      const snapshot = await getDoc(doc(getFirestore(app), "sharedPages", "mainSettings"));
      return snapshot.exists() ? (snapshot.data() || {}) : null;
    } catch (error) {
      console.warn("기존 Firebase 게시판 읽기 실패:", error);
      return null;
    }
  })();

  const result = await legacySettingsPromise;
  if (!result) legacySettingsPromise = null;
  return result;
}

function normalizeImportedContent(raw, title) {
  if (typeof raw === "string") {
    return {
      majorTitle: title,
      bodyHtml: raw,
      tableData: { enabled: false, rows: [] },
      html: raw
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const bodyHtml = typeof raw.bodyHtml === "string" && raw.bodyHtml.trim()
    ? raw.bodyHtml
    : typeof raw.html === "string" ? raw.html : "";
  return {
    ...raw,
    majorTitle: raw.majorTitle || title,
    bodyHtml,
    tableData: raw.tableData || { enabled: false, rows: [] },
    html: typeof raw.html === "string" ? raw.html : bodyHtml
  };
}

function normalizeLegacyPageContents(legacy) {
  const menus = Array.isArray(legacy?.menus) ? legacy.menus : [];
  const source = legacy?.pageContents && typeof legacy.pageContents === "object" ? legacy.pageContents : {};
  const pageContents = {};

  for (const [key, raw] of Object.entries(source)) {
    const fixed = FIXED_BOARDS.find(item => item.key === key);
    let title = fixed?.title || key;
    if (!fixed && key.startsWith("panel_")) {
      const panelIndex = Number(key.replace("panel_", ""));
      const menu = menus.find(item => Number(item?.panelIndex) === panelIndex);
      title = menu?.title || title;
    }
    pageContents[key] = normalizeImportedContent(raw, title) || raw;
  }

  return pageContents;
}

function hasMissingLegacyBoards(snapshot, legacy, legacyMenus) {
  const localMenus = Array.isArray(snapshot?.menus) ? snapshot.menus : [];
  const localByTitle = new Map(
    localMenus
      .map(menu => [titleKey(menu?.title), menu])
      .filter(([key]) => Boolean(key))
  );
  const localContents = snapshot?.page_contents || {};
  const legacySource = legacy?.pageContents && typeof legacy.pageContents === "object"
    ? legacy.pageContents
    : {};

  return legacyMenus.some(menu => {
    const localMenu = localByTitle.get(titleKey(menu?.title));
    if (!localMenu) return true;

    const localKey = contentKeyForPanel(Number(localMenu?.panelIndex));
    const sourceKey = contentKeyForPanel(Number(menu?.panelIndex));
    return Boolean(legacySource[sourceKey]) && !localContents[localKey];
  });
}

async function importMissingLegacyBoards(snapshot) {
  if (importInFlight) return;
  importInFlight = true;
  try {
    let user;
    try {
      user = await api("/auth/me");
    } catch (error) {
      if (error.status === 401) return;
      throw error;
    }
    if (user?.role !== "ADMIN") return;

    const legacy = await readLegacyFirebaseSettings();
    const legacyMenus = Array.isArray(legacy?.menus) ? legacy.menus.filter(isLegacyBoardMenu) : [];
    if (!legacyMenus.length || !hasMissingLegacyBoards(snapshot, legacy, legacyMenus)) return;

    await api("/shared-pages/import-missing", {
      method: "POST",
      body: JSON.stringify({
        menus: legacyMenus,
        notice: {},
        page_contents: normalizeLegacyPageContents(legacy)
      })
    });
    window.localSharedPagesApi?.refresh?.();
  } catch (error) {
    console.error("기존 웹 누락 게시판 가져오기 실패:", error);
  } finally {
    importInFlight = false;
  }
}

window.addEventListener("local-shared-pages-loaded", event => {
  const snapshot = event?.detail;
  if (!snapshot) return;
  renderBoardGroups(snapshot);
  void importMissingLegacyBoards(snapshot);
});
