const API_ROOT = "/api/v1";
const TEXT_COLOR_VERSION = 1;

let latestMenuSnapshot = null;
let textColorMigrationInFlight = false;
let textColorMigrationDone = false;

function installMenuTextStyle() {
  if (!document.getElementById("menu-text-style")) {
    const style = document.createElement("style");
    style.id = "menu-text-style";
    style.textContent = `
      body.limited-deployment-mode #topNav .nav-item,
      body.limited-deployment-mode #bottomNav .nav-item,
      body.limited-deployment-mode #topNav [data-authoritative-group] {
        width:calc(100% - 24px)!important;
        min-width:0!important;
        height:36px!important;
        margin:0 12px!important;
        padding:0 8px!important;
        justify-content:flex-start!important;
        text-align:left!important;
        border:0!important;
        border-radius:0!important;
        background:transparent!important;
        background-image:none!important;
        box-shadow:none!important;
        appearance:none!important;
        -webkit-appearance:none!important;
        font-size:13px!important;
        font-weight:500!important;
        line-height:1.2!important;
        transform:none!important;
        transition:font-size .12s ease,font-weight .12s ease,opacity .12s ease!important;
      }

      body.limited-deployment-mode #topNav .nav-item:hover,
      body.limited-deployment-mode #bottomNav .nav-item:hover,
      body.limited-deployment-mode #topNav [data-authoritative-group]:hover {
        background:transparent!important;
        background-image:none!important;
        border:0!important;
        box-shadow:none!important;
        font-size:calc(13px + 2pt)!important;
        font-weight:800!important;
        transform:none!important;
      }

      body.limited-deployment-mode #topNav .nav-item.active,
      body.limited-deployment-mode #bottomNav .nav-item.active {
        width:calc(100% - 24px)!important;
        margin:0 12px!important;
        padding:0 8px!important;
        background:transparent!important;
        background-image:none!important;
        border:0!important;
        border-radius:0!important;
        box-shadow:none!important;
        font-size:13px!important;
        font-weight:600!important;
        transform:none!important;
      }

      body.limited-deployment-mode #topNav .nav-item.active:hover,
      body.limited-deployment-mode #bottomNav .nav-item.active:hover {
        font-size:calc(13px + 2pt)!important;
        font-weight:800!important;
      }

      body.limited-deployment-mode #topNav .local-board-subgroup,
      body.limited-deployment-mode #topNav [data-authoritative-group-wrap] {
        margin:0!important;
        padding:0!important;
        border:0!important;
        border-radius:0!important;
        background:transparent!important;
        background-image:none!important;
        box-shadow:none!important;
      }

      body.limited-deployment-mode #topNav .local-board-subgroup > .nav-item.local-board-sub-item {
        width:calc(100% - 38px)!important;
        height:30px!important;
        margin:1px 14px 1px 24px!important;
        padding:0 6px!important;
        border:0!important;
        border-radius:0!important;
        background:transparent!important;
        background-image:none!important;
        box-shadow:none!important;
        font-size:12px!important;
        font-weight:500!important;
      }

      body.limited-deployment-mode #topNav .local-board-subgroup > .nav-item.local-board-sub-item:hover {
        font-size:calc(12px + 2pt)!important;
        font-weight:800!important;
      }

      body.limited-deployment-mode #topNav .nav-item::before,
      body.limited-deployment-mode #topNav .nav-item::after,
      body.limited-deployment-mode #bottomNav .nav-item::before,
      body.limited-deployment-mode #bottomNav .nav-item::after {
        box-shadow:none!important;
        background:transparent!important;
      }
    `;
    document.head.appendChild(style);
  }

  applyMenuTextPresentation(latestMenuSnapshot);
}

function validColor(value, fallback = "#ffffff") {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback;
}

function stripGroupEmoji(text) {
  return String(text || "")
    .replace(/^\s*[❓📝📚⚖]\s*/u, "")
    .trim();
}

function menuButton(menu) {
  if (menu?.toolKey) {
    return document.querySelector(`#topNav .nav-item[data-local-tool="${CSS.escape(String(menu.toolKey))}"]`);
  }
  const panelIndex = Number(menu?.panelIndex);
  if (Number.isFinite(panelIndex)) {
    return document.querySelector(`#topNav .nav-item[data-local-shared-panel-index="${panelIndex}"]`);
  }
  return null;
}

function applyMenuTextPresentation(snapshot) {
  const menus = Array.isArray(snapshot?.menus) ? snapshot.menus : [];

  document.querySelectorAll("#topNav .nav-item, #bottomNav .nav-item").forEach(button => {
    button.style.setProperty("background", "transparent", "important");
    button.style.setProperty("background-image", "none", "important");
    button.style.setProperty("border", "0", "important");
    button.style.setProperty("border-radius", "0", "important");
    button.style.setProperty("box-shadow", "none", "important");
  });

  for (const menu of menus) {
    const button = menuButton(menu);
    if (!button) continue;
    const color = Number(menu?.textColorVersion) >= TEXT_COLOR_VERSION
      ? validColor(menu?.color)
      : "#ffffff";
    button.style.setProperty("color", color, "important");
  }

  const groups = new Map();
  for (const menu of menus) {
    const groupKey = String(menu?.group || "").trim().toLowerCase();
    if (!groupKey || groups.has(groupKey)) continue;
    groups.set(groupKey, menu);
  }

  document.querySelectorAll("#topNav [data-authoritative-group]").forEach(toggle => {
    const groupKey = String(toggle.dataset.authoritativeGroup || "").trim().toLowerCase();
    const source = groups.get(groupKey);
    const color = Number(source?.textColorVersion) >= TEXT_COLOR_VERSION
      ? validColor(source?.groupColor)
      : "#ffffff";
    toggle.style.setProperty("background", "transparent", "important");
    toggle.style.setProperty("background-image", "none", "important");
    toggle.style.setProperty("border", "0", "important");
    toggle.style.setProperty("border-radius", "0", "important");
    toggle.style.setProperty("box-shadow", "none", "important");
    toggle.style.setProperty("color", color, "important");

    const label = toggle.querySelector("span:first-child");
    if (label) {
      const next = stripGroupEmoji(label.textContent);
      if (label.textContent !== next) label.textContent = next;
    }
  });

  updateMenuEditorLabels();
}

function updateMenuEditorLabels() {
  const modal = document.getElementById("menuModal");
  if (!modal) return;

  modal.querySelectorAll(".menu-table thead th").forEach(th => {
    if (th.textContent?.trim() === "색상") th.textContent = "글씨색";
  });

  const help = modal.querySelector(".help-text");
  if (help && !help.textContent.includes("글씨색")) {
    help.textContent = `${help.textContent.trim()} 색상 선택은 사이드바 글씨색에 적용됩니다.`.trim();
  }

  if (!latestMenuSnapshot?.menus) return;
  const menus = latestMenuSnapshot.menus;
  const rows = Array.from(modal.querySelectorAll("#menuTableBody tr"));
  let menuCursor = 0;

  for (const row of rows) {
    const colorInput = row.querySelector('input[type="color"]');
    if (!colorInput) continue;

    if (row.classList.contains("group-row")) {
      const groupRowsFollowing = [];
      let sibling = row.nextElementSibling;
      while (sibling?.classList.contains("child-row")) {
        groupRowsFollowing.push(sibling);
        sibling = sibling.nextElementSibling;
      }
      const source = menus.find(menu => String(menu?.group || "").trim().toLowerCase());
      if (source && Number(source?.textColorVersion) < TEXT_COLOR_VERSION) colorInput.value = "#ffffff";
      continue;
    }

    const source = menus[menuCursor++];
    if (source && Number(source?.textColorVersion) < TEXT_COLOR_VERSION) colorInput.value = "#ffffff";
  }
}

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

async function migrateLegacyColors(snapshot) {
  if (textColorMigrationDone || textColorMigrationInFlight || !Array.isArray(snapshot?.menus)) return;
  const needsMigration = snapshot.menus.some(menu => Number(menu?.textColorVersion) < TEXT_COLOR_VERSION);
  if (!needsMigration) {
    textColorMigrationDone = true;
    return;
  }

  textColorMigrationInFlight = true;
  try {
    let user;
    try {
      user = await api("/auth/me");
    } catch (error) {
      if (error.status === 401) return;
      throw error;
    }
    if (user?.role !== "ADMIN") return;

    const menus = snapshot.menus.map(menu => ({
      ...menu,
      color: Number(menu?.textColorVersion) >= TEXT_COLOR_VERSION ? validColor(menu?.color) : "#ffffff",
      groupColor: Number(menu?.textColorVersion) >= TEXT_COLOR_VERSION ? validColor(menu?.groupColor) : "#ffffff",
      textColorVersion: TEXT_COLOR_VERSION
    }));

    await api("/shared-pages/menus", {
      method: "PUT",
      body: JSON.stringify({ menus, notice: {}, page_contents: {} })
    });
    textColorMigrationDone = true;
    window.localSharedPagesApi?.refresh?.();
  } catch (error) {
    console.error("메뉴 글씨색 초기화 실패:", error);
  } finally {
    textColorMigrationInFlight = false;
  }
}

installMenuTextStyle();

window.addEventListener("local-shared-pages-loaded", event => {
  if (event?.detail) latestMenuSnapshot = event.detail;
  applyMenuTextPresentation(latestMenuSnapshot);
  void migrateLegacyColors(latestMenuSnapshot);
  queueMicrotask(() => applyMenuTextPresentation(latestMenuSnapshot));
  setTimeout(() => applyMenuTextPresentation(latestMenuSnapshot), 0);
});

document.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("#localMenuEditBtn, #menuEditBtn")) {
    setTimeout(updateMenuEditorLabels, 0);
    setTimeout(updateMenuEditorLabels, 100);
  }
}, true);

const menuModal = document.getElementById("menuModal");
if (menuModal) {
  const observer = new MutationObserver(() => updateMenuEditorLabels());
  observer.observe(menuModal, { childList: true, subtree: true });
}

[100, 300, 800, 1600].forEach(delay => setTimeout(() => applyMenuTextPresentation(latestMenuSnapshot), delay));
