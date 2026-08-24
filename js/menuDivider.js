const DIVIDER_PREFIX = "__MENU_DIVIDER__";

let dividerKeys = new Set();
let decorateScheduled = false;

function compact(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[📊📝📢❓⚖📚]/g, "")
    .trim();
}

function isDivider(menu) {
  return String(menu?.kind || "").trim().toLowerCase() === "divider"
    || String(menu?.title || "").startsWith(DIVIDER_PREFIX);
}

function menuKey(menu) {
  if (menu?.toolKey) return `tool:${menu.toolKey}`;
  const panelIndex = Number(menu?.panelIndex);
  if (Number.isFinite(panelIndex)) return `panel:${panelIndex}`;
  return `title:${compact(menu?.title)}`;
}

function makeDividerTitle() {
  const id = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${DIVIDER_PREFIX}${id}`;
}

function setImportant(node, property, value) {
  if (node.style.getPropertyValue(property) === value && node.style.getPropertyPriority(property) === "important") return;
  node.style.setProperty(property, value, "important");
}

function styleDividerButton(button) {
  if (!(button instanceof HTMLButtonElement)) return;
  const key = String(button.dataset.authoritativeMenuKey || "");
  const divider = dividerKeys.has(key)
    || button.dataset.menuDividerItem === "1"
    || String(button.textContent || "").startsWith(DIVIDER_PREFIX);
  if (!divider) return;

  button.dataset.menuDividerItem = "1";
  button.classList.add("menu-divider-item");
  button.disabled = true;
  button.tabIndex = -1;
  button.setAttribute("aria-hidden", "true");
  if (button.textContent) button.textContent = "";

  setImportant(button, "display", button.classList.contains("local-menu-hidden") ? "none" : "block");
  setImportant(button, "width", "calc(100% - 36px)");
  setImportant(button, "min-width", "0");
  setImportant(button, "max-width", "calc(100% - 36px)");
  setImportant(button, "height", "1px");
  setImportant(button, "min-height", "1px");
  setImportant(button, "margin", "8px 18px");
  setImportant(button, "padding", "0");
  setImportant(button, "border", "0");
  setImportant(button, "border-radius", "0");
  setImportant(button, "background", "rgba(255,255,255,.24)");
  setImportant(button, "background-image", "none");
  setImportant(button, "box-shadow", "none");
  setImportant(button, "outline", "none");
  setImportant(button, "transform", "none");
  setImportant(button, "font-size", "0");
  setImportant(button, "line-height", "0");
  setImportant(button, "pointer-events", "none");
  setImportant(button, "overflow", "hidden");
}

function decorateSidebar() {
  document.querySelectorAll("#topNav [data-authoritative-menu-key]").forEach(styleDividerButton);
}

function decorateEditorRows() {
  const tbody = document.getElementById("menuTableBody");
  if (!tbody) return;

  tbody.querySelectorAll("tr").forEach(row => {
    const titleInput = row.querySelector('input[data-field="title"]');
    if (!(titleInput instanceof HTMLInputElement)) return;
    const divider = titleInput.value.startsWith(DIVIDER_PREFIX);
    if (!divider) return;

    row.classList.add("menu-divider-editor-row");
    titleInput.style.setProperty("display", "none", "important");

    const titleCell = titleInput.closest("td");
    if (titleCell && !titleCell.querySelector(".menu-divider-editor-label")) {
      const label = document.createElement("span");
      label.className = "menu-divider-editor-label";
      label.textContent = "메뉴 구분선";
      titleCell.appendChild(label);
    }

    row.querySelectorAll('input[type="color"], select[data-field="group"]').forEach(control => {
      control.disabled = true;
      control.style.setProperty("display", "none", "important");
    });

    const cells = row.querySelectorAll("td");
    if (cells[2]) cells[2].querySelectorAll("input").forEach(input => input.style.setProperty("display", "none", "important"));
    const status = row.querySelector(".menu-status");
    if (status && status.textContent !== "구분선") status.textContent = "구분선";
  });
}

function convertNewestBoardToDivider() {
  const rows = Array.from(document.querySelectorAll("#menuTableBody tr"));
  const row = rows.at(-1);
  const input = row?.querySelector?.('input[data-field="title"]');
  if (!(input instanceof HTMLInputElement)) {
    alert("구분선을 추가하지 못했습니다. 메뉴 편집창을 다시 열어주세요.");
    return;
  }

  input.value = makeDividerTitle();
  input.dispatchEvent(new Event("input", { bubbles: true }));
  decorateEditorRows();
}

function addDividerFromEditor() {
  const modal = document.getElementById("menuModal");
  if (!modal) return;

  const addBoardButton = Array.from(modal.querySelectorAll("button.small-btn"))
    .find(button => button.id !== "menuDividerAddBtn" && /게시판 추가|상단 메뉴 추가/.test(String(button.textContent || "")));
  if (!(addBoardButton instanceof HTMLButtonElement)) {
    alert("게시판 추가 기능을 찾지 못했습니다. 메뉴 편집창을 다시 열어주세요.");
    return;
  }

  addBoardButton.click();
  queueMicrotask(convertNewestBoardToDivider);
}

function ensureEditorAddButton() {
  const modal = document.getElementById("menuModal");
  if (!modal || document.getElementById("menuDividerAddBtn")) return;

  const addBoardButton = Array.from(modal.querySelectorAll("button.small-btn"))
    .find(button => /게시판 추가|상단 메뉴 추가/.test(String(button.textContent || "")));
  const container = addBoardButton?.parentElement;
  if (!container) return;

  const button = document.createElement("button");
  button.type = "button";
  button.id = "menuDividerAddBtn";
  button.className = "small-btn";
  button.textContent = "구분선 추가";
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    addDividerFromEditor();
  });
  container.appendChild(button);
}

function ensureStyles() {
  if (document.getElementById("menu-divider-styles")) return;
  const style = document.createElement("style");
  style.id = "menu-divider-styles";
  style.textContent = `
    #topNav .nav-item.menu-divider-item,
    body.limited-deployment-mode #topNav .nav-item.menu-divider-item {
      width:calc(100% - 36px)!important;
      min-width:0!important;
      max-width:calc(100% - 36px)!important;
      height:1px!important;
      min-height:1px!important;
      margin:8px 18px!important;
      padding:0!important;
      border:0!important;
      border-radius:0!important;
      background:rgba(255,255,255,.24)!important;
      background-image:none!important;
      box-shadow:none!important;
      outline:none!important;
      transform:none!important;
      font-size:0!important;
      line-height:0!important;
      pointer-events:none!important;
      overflow:hidden!important;
    }
    #menuModal.menu-admin-unified .menu-divider-editor-row td {
      background:#f8fafc!important;
    }
    #menuModal.menu-admin-unified .menu-divider-editor-label {
      display:inline-flex;
      align-items:center;
      min-height:28px;
      color:#475569;
      font-size:12px;
      font-weight:800;
      letter-spacing:.02em;
    }
    #menuModal.menu-admin-unified .menu-divider-editor-row td:nth-child(3),
    #menuModal.menu-admin-unified .menu-divider-editor-row td:nth-child(4),
    #menuModal.menu-admin-unified .menu-divider-editor-row td:nth-child(5) {
      color:transparent!important;
    }
  `;
  document.head.appendChild(style);
}

function scheduleDecorate() {
  if (decorateScheduled) return;
  decorateScheduled = true;
  queueMicrotask(() => {
    decorateScheduled = false;
    ensureEditorAddButton();
    decorateEditorRows();
    decorateSidebar();
  });
}

function installObservers() {
  const topNav = document.getElementById("topNav");
  if (topNav && topNav.dataset.menuDividerObserverInstalled !== "1") {
    topNav.dataset.menuDividerObserverInstalled = "1";
    const observer = new MutationObserver(scheduleDecorate);
    observer.observe(topNav, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  }

  const modal = document.getElementById("menuModal");
  if (modal && modal.dataset.menuDividerObserverInstalled !== "1") {
    modal.dataset.menuDividerObserverInstalled = "1";
    const observer = new MutationObserver(scheduleDecorate);
    observer.observe(modal, { childList: true, subtree: true });
  }
}

window.addEventListener("local-shared-pages-loaded", event => {
  const menus = Array.isArray(event?.detail?.menus) ? event.detail.menus : [];
  dividerKeys = new Set(menus.filter(isDivider).map(menuKey));
  scheduleDecorate();
});

ensureStyles();
installObservers();
scheduleDecorate();
[100, 300, 800, 1600].forEach(delay => setTimeout(() => {
  installObservers();
  scheduleDecorate();
}, delay));
