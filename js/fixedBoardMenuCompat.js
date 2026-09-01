const API_ROOT = "/api/v1";

const FIXED_BOARD_MENUS = [
  { title: "임대차", panelIndex: 1, kind: "panel", group: "work", color: "#1f4e79" },
  { title: "임금", panelIndex: 2, kind: "panel", group: "work", color: "#1f4e79" },
  { title: "조세", panelIndex: 3, kind: "panel", group: "work", color: "#1f4e79" },
  { title: "선순위임차인Q&A", panelIndex: 4, kind: "panel", group: "qna", color: "#1f4e79" },
  { title: "보증서Q&A", panelIndex: 5, kind: "panel", group: "qna", color: "#1f4e79" },
  { title: "피담보채무Q&A", panelIndex: 6, kind: "panel", group: "qna", color: "#1f4e79" },
  { title: "매각대상여부Q&A", panelIndex: 7, kind: "panel", group: "qna", color: "#1f4e79" },
  { title: "열람자료Q&A", panelIndex: 8, kind: "panel", group: "qna", color: "#1f4e79" },
  { title: "기계기구Q&A", panelIndex: 9, kind: "panel", group: "qna", color: "#1f4e79" }
];

let migrationInFlight = false;
let migrationCompleted = false;

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

function menuByPanel(snapshot) {
  return new Map(
    (Array.isArray(snapshot?.menus) ? snapshot.menus : [])
      .map(menu => [Number(menu?.panelIndex), menu])
      .filter(([panelIndex]) => Number.isFinite(panelIndex))
  );
}

function hideMissingFixedButtons(snapshot) {
  const menus = menuByPanel(snapshot);
  for (const definition of FIXED_BOARD_MENUS) {
    const menu = menus.get(definition.panelIndex);
    const hidden = menu ? Boolean(menu.hidden) : true;
    const button = document.querySelector(`.nav-item[data-local-shared-panel-index="${definition.panelIndex}"]`);
    const panel = document.querySelector(`.sheet-panel[data-index="${definition.panelIndex}"]`);
    button?.classList.toggle("local-menu-hidden", hidden);
    panel?.classList.toggle("local-menu-hidden", hidden);
  }
}

async function persistMissingFixedMenus(snapshot) {
  if (migrationInFlight || migrationCompleted) return;

  const currentMenus = Array.isArray(snapshot?.menus) ? snapshot.menus.map(menu => ({ ...menu })) : [];
  const existing = new Set(currentMenus.map(menu => Number(menu?.panelIndex)).filter(Number.isFinite));
  const missing = FIXED_BOARD_MENUS.filter(menu => !existing.has(menu.panelIndex));
  if (!missing.length) {
    migrationCompleted = true;
    return;
  }

  migrationInFlight = true;
  try {
    let user;
    try {
      user = await api("/auth/me");
    } catch (error) {
      if (error.status === 401) return;
      throw error;
    }
    if (user?.role !== "ADMIN") return;

    const menus = [
      ...currentMenus,
      ...missing.map(menu => ({
        ...menu,
        location: "top",
        hidden: true,
        visibilityInitialized: true,
        visibilityVersion: 2
      }))
    ];

    await api("/shared-pages/menus", {
      method: "PUT",
      body: JSON.stringify({ menus, notice: {}, page_contents: {} })
    });
    migrationCompleted = true;
    window.localSharedPagesApi?.refresh?.();
  } catch (error) {
    console.error("고정 게시판 메뉴 등록 실패:", error);
  } finally {
    migrationInFlight = false;
  }
}

window.addEventListener("local-shared-pages-loaded", event => {
  const snapshot = event?.detail;
  if (!snapshot) return;
  hideMissingFixedButtons(snapshot);
  void persistMissingFixedMenus(snapshot);
});
