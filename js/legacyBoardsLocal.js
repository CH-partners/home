const API_ROOT = "/api/v1";
const FIXED_BOARDS = [
  { panelIndex: 1, key: "rent", title: "임대차" },
  { panelIndex: 2, key: "wage", title: "임금" },
  { panelIndex: 3, key: "tax", title: "조세" },
  { panelIndex: 4, key: "tenantqa", title: "선순위임차인Q&A" },
  { panelIndex: 5, key: "guaranteeqa", title: "보증서Q&A" },
  { panelIndex: 6, key: "securedqa", title: "피담보채무Q&A" },
  { panelIndex: 7, key: "saleqa", title: "매각대상여부Q&A" },
  { panelIndex: 8, key: "browseqa", title: "열람자료Q&A" },
  { panelIndex: 9, key: "machineqa", title: "기계기구Q&A" }
];
const NON_BOARD_PANEL_INDEXES = new Set([0, 10, 11, 12, 13]);
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

function titleKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}&]+/gu, "");
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

function contentKeyForPanel(panelIndex) {
  return FIXED_BOARDS.find(item => item.panelIndex === Number(panelIndex))?.key || `panel_${Number(panelIndex)}`;
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
  void importMissingLegacyBoards(snapshot);
});
