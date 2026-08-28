const API_ROOT = "/api/v1";
const DEFAULT_NOTICE_HTML = "<li>공지 내용이 없습니다.</li>";
const FIXED_CONTENTS = [
  { panelIndex: 1, key: "rent", title: "임대차", targetId: "content-rent" },
  { panelIndex: 2, key: "wage", title: "임금", targetId: "content-wage" },
  { panelIndex: 3, key: "tax", title: "조세", targetId: "content-tax" },
  { panelIndex: 4, key: "tenantqa", title: "선순위임차인Q&A", targetId: "content-tenantqa" },
  { panelIndex: 5, key: "guaranteeqa", title: "보증서Q&A", targetId: "content-guaranteeqa" },
  { panelIndex: 6, key: "securedqa", title: "피담보채무Q&A", targetId: "content-securedqa" },
  { panelIndex: 7, key: "saleqa", title: "매각대상여부Q&A", targetId: "content-saleqa" },
  { panelIndex: 8, key: "browseqa", title: "열람자료Q&A", targetId: "content-browseqa" },
  { panelIndex: 9, key: "machineqa", title: "기계기구Q&A", targetId: "content-machineqa" }
];

let currentUser = null;
let currentSnapshot = null;
let editingKey = "";
let editingConfig = null;
let observerTimer = null;
let observerSuppressUntil = 0;

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

function isGeneralBoard(menu) {
  return compact(menu?.title) === "일반게시판";
}

function menuForPanel(panelIndex) {
  return (currentSnapshot?.menus || []).find(menu => Number(menu?.panelIndex) === Number(panelIndex)) || null;
}

function refForPanel(panelIndex) {
  const fixed = FIXED_CONTENTS.find(item => item.panelIndex === Number(panelIndex));
  if (fixed) return fixed;
  const menu = menuForPanel(panelIndex);
  return {
    panelIndex: Number(panelIndex),
    key: `panel_${Number(panelIndex)}`,
    title: menu?.title || `게시판 ${panelIndex}`,
    targetId: ""
  };
}

function setText(node, value) {
  if (!node) return;
  const next = String(value ?? "");
  if (node.textContent !== next) node.textContent = next;
}

function setHtml(node, value) {
  if (!node) return;
  const next = String(value ?? "");
  if (node.innerHTML !== next) node.innerHTML = next;
}

function showPanel(panelIndex, button) {
  document.querySelectorAll(".sheet-panel").forEach(panel => panel.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
  document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`)?.classList.add("active");
  button?.classList.add("active");
}

function ensureNoticeMenu() {
  const topNav = document.getElementById("topNav");
  if (!topNav) return;
  const existing = Array.from(topNav.querySelectorAll(".nav-item"))
    .find(item => compact(item.textContent).includes("공지사항"));
  if (existing) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-item nav-item-notice";
  button.dataset.localSharedMenu = "notice";
  button.textContent = "📢 청현 공지사항";
  button.addEventListener("click", () => showPanel(0, button));
  topNav.prepend(button);
}

function ensureEditButton(panel, ref, publicReady = false) {
  const header = panel?.querySelector(".sheet-header");
  if (!header) return;

  let tools = header.querySelector(".sheet-tools");
  if (!tools) {
    tools = document.createElement("div");
    tools.className = "sheet-tools";
    header.appendChild(tools);
  }

  let button = tools.querySelector(".local-shared-edit-btn");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "action-btn hidden local-shared-edit-btn";
    button.textContent = "내용 수정";
    tools.appendChild(button);
  }

  button.dataset.localSharedContentKey = ref.key;
  button.dataset.localSharedPanelIndex = String(ref.panelIndex);
  button.classList.toggle("local-admin-visible", currentUser?.role === "ADMIN");
  if (publicReady) button.dataset.localSharedPublic = "1";
  else button.removeAttribute("data-local-shared-public");
  button.onclick = () => openContentEditor(ref);
}

function ensureDirectMenu(ref) {
  const topNav = document.getElementById("topNav");
  if (!topNav) return;

  let button = topNav.querySelector(`.nav-item[data-local-shared-public-key="${ref.key}"]`);
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "nav-item";
    button.dataset.localSharedPublic = "1";
    button.dataset.localSharedPublicKey = ref.key;
    button.dataset.localSharedPanelIndex = String(ref.panelIndex);
    button.addEventListener("click", () => showPanel(ref.panelIndex, button));
    topNav.appendChild(button);
  }
  setText(button, ref.title);
}

function renderNotice(notice) {
  setText(document.getElementById("noticeTitle"), notice?.title || "공지 제목");
  setText(document.getElementById("noticeDate"), `기준일: ${notice?.date || "-"}`);
  const items = document.getElementById("noticeItems");
  if (!items) return;
  const html = String(notice?.html || "").trim();
  if (!html) return setHtml(items, DEFAULT_NOTICE_HTML);
  const hasBlock = /<(li|ul|ol|p|div|h[1-6]|blockquote)/i.test(html);
  setHtml(items, hasBlock ? html : `<li>${html}</li>`);
}

function renderFixed(snapshot) {
  const contents = snapshot?.page_contents || {};
  for (const ref of FIXED_CONTENTS) {
    const panel = document.querySelector(`.sheet-panel[data-index="${ref.panelIndex}"]`);
    const target = document.getElementById(ref.targetId);
    const config = contents[ref.key];
    const directButton = document.querySelector(`.nav-item[data-local-shared-public-key="${ref.key}"]`);

    if (!panel || !target || !config) {
      panel?.removeAttribute("data-local-shared-public-ready");
      directButton?.remove();
      continue;
    }

    panel.dataset.localSharedPublicReady = "1";
    ensureEditButton(panel, ref, true);
    ensureDirectMenu(ref);

    let title = target.querySelector(":scope > .major-title");
    let preview = target.querySelector(":scope > .rich-preview");
    if (!title || !preview || target.children.length !== 2) {
      target.replaceChildren();
      title = document.createElement("div");
      title.className = "major-title";
      preview = document.createElement("div");
      preview.className = "rich-preview";
      target.append(title, preview);
    }
    setText(title, config.majorTitle || ref.title);
    setHtml(preview, config.html || config.bodyHtml || "");
  }
}

function renderDynamic(snapshot) {
  const main = document.querySelector(".main");
  const topNav = document.getElementById("topNav");
  if (!main || !topNav) return;

  const menus = Array.isArray(snapshot?.menus) ? snapshot.menus : [];
  const contents = snapshot?.page_contents || {};

  for (const menu of menus) {
    const panelIndex = Number(menu?.panelIndex);
    if (!Number.isFinite(panelIndex) || panelIndex <= 13 || menu?.kind === "iframe") continue;

    const ref = refForPanel(panelIndex);
    const config = contents[ref.key];
    const publicReady = isGeneralBoard(menu) && Boolean(config);

    let panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "sheet-panel";
      panel.dataset.index = String(panelIndex);
      panel.dataset.localSharedPanel = "1";
      panel.innerHTML = '<header class="sheet-header"><h1></h1><div class="sheet-tools"></div></header><section class="major-card"><div class="major-title"></div><div class="rich-preview"></div></section>';
      main.appendChild(panel);
    }

    setText(panel.querySelector(".sheet-header h1"), menu.title || ref.title);
    if (publicReady) panel.dataset.localSharedPublicReady = "1";
    else panel.removeAttribute("data-local-shared-public-ready");
    ensureEditButton(panel, ref, publicReady);

    let button = topNav.querySelector(`.nav-item[data-local-shared-menu="dynamic"][data-local-shared-panel-index="${panelIndex}"]`);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "nav-item";
      button.dataset.localSharedMenu = "dynamic";
      button.dataset.localSharedPanelIndex = String(panelIndex);
      button.addEventListener("click", () => showPanel(panelIndex, button));
      topNav.appendChild(button);
    }
    setText(button, menu.title || ref.title);
    if (publicReady) button.dataset.localSharedPublic = "1";
    else button.removeAttribute("data-local-shared-public");

    if (config) {
      setText(panel.querySelector(".major-title"), config.majorTitle || menu.title || "");
      setHtml(panel.querySelector(".rich-preview"), config.html || config.bodyHtml || "");
    }
  }
}

function ensureStyles() {
  if (document.getElementById("local-shared-page-styles")) return;
  const style = document.createElement("style");
  style.id = "local-shared-page-styles";
  style.textContent = `
    body.limited-deployment-mode .local-shared-edit-btn.local-admin-visible{display:inline-flex!important}
    body.limited-deployment-mode .panel-edit-btn:not(.local-shared-edit-btn){display:none!important}
  `;
  document.head.appendChild(style);
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  currentSnapshot = snapshot;
  observerSuppressUntil = Date.now() + 150;
  ensureNoticeMenu();
  renderNotice(snapshot.notice || {});
  renderFixed(snapshot);
  renderDynamic(snapshot);
  ensureStyles();
  document.querySelectorAll(".local-shared-edit-btn").forEach(button => {
    button.classList.toggle("local-admin-visible", currentUser?.role === "ADMIN");
  });
  window.dispatchEvent(new CustomEvent("local-shared-pages-loaded", { detail: snapshot }));
}

async function loadSharedPages() {
  let user;
  try {
    user = await api("/auth/me");
  } catch (error) {
    if (error.status === 401) {
      currentUser = null;
      document.querySelectorAll(".local-shared-edit-btn").forEach(button => button.classList.remove("local-admin-visible"));
      return null;
    }
    throw error;
  }

  currentUser = user;
  const snapshot = await api("/shared-pages");
  applySnapshot(snapshot);
  return snapshot;
}

function contentEditor() {
  return document.querySelector("#contentEditor .ql-editor");
}

function bodyHtmlFrom(config) {
  if (typeof config?.bodyHtml === "string" && config.bodyHtml.trim()) return config.bodyHtml;
  const wrap = document.createElement("div");
  wrap.innerHTML = String(config?.html || "");
  wrap.querySelectorAll(".content-table-preview").forEach(node => node.remove());
  return wrap.innerHTML;
}

function tableHtmlFrom(config) {
  const wrap = document.createElement("div");
  wrap.innerHTML = String(config?.html || "");
  return wrap.querySelector(".content-table-preview")?.outerHTML || "";
}

function setContentModalMode(enabled) {
  const modal = document.getElementById("contentModal");
  if (!modal) return;
  modal.classList.toggle("local-shared-edit-mode", enabled);
  const tableRow = document.getElementById("contentTableWrap")?.closest(".form-row");
  if (tableRow) tableRow.style.display = enabled ? "none" : "";
}

function openContentEditor(refOrIndex) {
  if (currentUser?.role !== "ADMIN") return alert("관리자만 수정할 수 있습니다.");
  const ref = typeof refOrIndex === "object" ? refOrIndex : refForPanel(Number(refOrIndex));
  const config = currentSnapshot?.page_contents?.[ref.key] || {
    majorTitle: ref.title,
    bodyHtml: "<p>내용을 입력하세요.</p>",
    tableData: { enabled: false, rows: [] },
    html: "<p>내용을 입력하세요.</p>"
  };
  const modal = document.getElementById("contentModal");
  const title = document.getElementById("contentModalTitle");
  const majorTitle = document.getElementById("contentMajorTitle");
  const editor = contentEditor();
  if (!modal || !title || !majorTitle || !editor) return alert("게시판 편집기를 불러오지 못했습니다.");

  editingKey = ref.key;
  editingConfig = structuredClone(config);
  setText(title, `${ref.title || config.majorTitle || "게시판"} 내용 수정`);
  majorTitle.value = String(config.majorTitle || ref.title || "");
  editor.innerHTML = bodyHtmlFrom(config);
  setContentModalMode(true);
  modal.classList.add("show");
}

function closeContentEditor() {
  document.getElementById("contentModal")?.classList.remove("show");
  setContentModalMode(false);
  editingKey = "";
  editingConfig = null;
}

async function saveContentEditor() {
  if (!editingKey || !editingConfig) return;
  const editor = contentEditor();
  if (!editor) throw new Error("게시판 편집기를 찾을 수 없습니다.");

  const bodyHtml = editor.innerHTML;
  const content = {
    ...editingConfig,
    majorTitle: document.getElementById("contentMajorTitle")?.value?.trim() || "게시판",
    bodyHtml,
    html: bodyHtml + tableHtmlFrom(editingConfig)
  };
  const result = await api(`/shared-pages/contents/${encodeURIComponent(editingKey)}`, {
    method: "PUT",
    body: JSON.stringify({ content })
  });
  currentSnapshot = {
    ...(currentSnapshot || {}),
    page_contents: {
      ...(currentSnapshot?.page_contents || {}),
      [editingKey]: result.content
    }
  };
  applySnapshot(currentSnapshot);
  closeContentEditor();
}

function bindModalActions() {
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const modal = document.getElementById("contentModal");
    if (!target || !modal?.classList.contains("local-shared-edit-mode")) return;

    if (target.closest("#contentModal .primary-btn")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void saveContentEditor().catch(error => alert(`게시판 저장 실패: ${error.message}`));
    } else if (target.closest("#contentModal .secondary-btn")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeContentEditor();
    }
  }, true);
}

function installObserver() {
  const observer = new MutationObserver(mutations => {
    if (!currentSnapshot || Date.now() < observerSuppressUntil) return;
    const relevant = mutations.some(mutation => {
      if (mutation.type !== "childList") return false;
      const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
      return Boolean(target?.closest?.("#topNav,.main"));
    });
    if (!relevant) return;

    clearTimeout(observerTimer);
    observerTimer = setTimeout(() => {
      if (!currentSnapshot) return;
      applySnapshot(currentSnapshot);
    }, 80);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function installLocalSharedPages() {
  if (window.__localSharedPagesInstalled) return;
  window.__localSharedPagesInstalled = true;

  let refreshTimer = null;
  const refresh = (delay = 0) => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void loadSharedPages().catch(error => console.error("로컬 공지/게시판 불러오기 실패:", error));
    }, delay);
  };

  window.localSharedPagesApi = {
    refresh: () => refresh(0),
    get: loadSharedPages,
    updateNotice: async notice => {
      const snapshot = await api("/shared-pages/notice", {
        method: "PUT",
        body: JSON.stringify(notice)
      });
      applySnapshot(snapshot);
      return snapshot;
    },
    updateContent: async (key, content) => {
      const result = await api(`/shared-pages/contents/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({ content })
      });
      refresh(0);
      return result;
    }
  };

  bindModalActions();
  installObserver();

  document.addEventListener("submit", event => {
    if (event.target?.matches?.("#grv2LoginForm,#allocationLoginForm")) {
      refresh(300);
      setTimeout(() => refresh(0), 900);
    }
  }, true);

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("#grv2Logout")) {
      currentUser = null;
      refresh(300);
    }
  }, true);

  refresh(0);
  setTimeout(() => refresh(0), 250);
  setTimeout(() => refresh(0), 800);
  setTimeout(() => refresh(0), 1600);
}

installLocalSharedPages();