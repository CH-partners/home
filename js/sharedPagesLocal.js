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

let currentLocalUser = null;
let currentLocalSnapshot = null;
let currentLocalContentKey = "";
let currentLocalContentConfig = null;
let legacyFirebaseSettingsPromise = null;

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

function compactLabel(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function isGeneralBoard(menu) {
  return compactLabel(menu?.title) === "일반게시판";
}

function fixedContentForPanel(panelIndex) {
  return FIXED_CONTENTS.find(item => item.panelIndex === Number(panelIndex)) || null;
}

function menuForPanel(panelIndex) {
  return (currentLocalSnapshot?.menus || []).find(menu => Number(menu?.panelIndex) === Number(panelIndex));
}

function contentRefForPanel(panelIndex) {
  const fixed = fixedContentForPanel(panelIndex);
  if (fixed) return fixed;
  const menu = menuForPanel(panelIndex);
  return {
    panelIndex: Number(panelIndex),
    key: `panel_${Number(panelIndex)}`,
    title: menu?.title || `게시판 ${panelIndex}`,
    targetId: ""
  };
}

function showPanel(panelIndex, button) {
  document.querySelectorAll(".sheet-panel").forEach(panel => panel.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
  const panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);
  if (panel) panel.classList.add("active");
  if (button) button.classList.add("active");
}

function ensureLocalNoticeMenu() {
  const topNav = document.getElementById("topNav");
  if (!topNav) return;
  const existing = Array.from(topNav.querySelectorAll(".nav-item"))
    .find(item => compactLabel(item.textContent).includes("공지사항"));
  if (existing) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-item nav-item-notice";
  button.dataset.localSharedMenu = "notice";
  button.textContent = "📢 청현 공지사항";
  button.addEventListener("click", () => showPanel(0, button));
  topNav.prepend(button);
}

function ensureContentEditButton(panel, ref, publicReady = false) {
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

  button.dataset.localSharedPanelIndex = String(ref.panelIndex);
  button.dataset.localSharedContentKey = ref.key;
  button.onclick = () => openLocalContentEditor(ref);
  button.classList.toggle("local-admin-visible", currentLocalUser?.role === "ADMIN");
  if (publicReady) button.dataset.localSharedPublic = "1";
}

function ensureDirectLocalMenu(ref) {
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
  button.textContent = ref.title;
}

function ensureLocalFixedUi(snapshot) {
  const contents = snapshot?.page_contents || {};

  FIXED_CONTENTS.forEach(ref => {
    const panel = document.querySelector(`.sheet-panel[data-index="${ref.panelIndex}"]`);
    const config = contents[ref.key];
    const existingButton = document.querySelector(`.nav-item[data-local-shared-public-key="${ref.key}"]`);

    if (!panel || !config) {
      panel?.removeAttribute("data-local-shared-public-ready");
      existingButton?.remove();
      return;
    }

    panel.dataset.localSharedPublicReady = "1";
    ensureContentEditButton(panel, ref, true);
    ensureDirectLocalMenu(ref);
  });
}

function ensureLocalDynamicUi(snapshot) {
  const main = document.querySelector(".main");
  const topNav = document.getElementById("topNav");
  if (!main || !topNav) return;

  const menus = Array.isArray(snapshot?.menus) ? snapshot.menus : [];
  const contents = snapshot?.page_contents || {};

  menus.forEach(menu => {
    const panelIndex = Number(menu?.panelIndex);
    if (!Number.isFinite(panelIndex) || panelIndex <= 13 || menu?.kind === "iframe") return;

    const ref = contentRefForPanel(panelIndex);
    const publicReady = isGeneralBoard(menu) && Boolean(contents[ref.key]);
    let panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);

    if (!panel) {
      panel = document.createElement("div");
      panel.className = "sheet-panel";
      panel.dataset.index = String(panelIndex);
      panel.dataset.localSharedPanel = "1";
      panel.innerHTML = `
        <header class="sheet-header"><h1></h1><div class="sheet-tools"></div></header>
        <section class="major-card">
          <div class="major-title"></div>
          <div class="rich-preview"></div>
        </section>
      `;
      main.appendChild(panel);
    }

    panel.querySelector(".sheet-header h1").textContent = String(menu.title || ref.title);
    if (publicReady) panel.dataset.localSharedPublicReady = "1";
    else panel.removeAttribute("data-local-shared-public-ready");
    ensureContentEditButton(panel, ref, publicReady);

    let button = topNav.querySelector(`.nav-item[data-local-shared-panel-index="${panelIndex}"][data-local-shared-menu="dynamic"]`);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "nav-item";
      button.dataset.localSharedMenu = "dynamic";
      button.dataset.localSharedPanelIndex = String(panelIndex);
      button.addEventListener("click", () => showPanel(panelIndex, button));
      topNav.appendChild(button);
    }
    button.textContent = String(menu.title || ref.title);
    if (publicReady) button.dataset.localSharedPublic = "1";
    else button.removeAttribute("data-local-shared-public");

    const config = contents[ref.key];
    if (config) {
      panel.querySelector(".major-title").textContent = String(config.majorTitle || menu.title || "");
      panel.querySelector(".rich-preview").innerHTML = String(config.html || config.bodyHtml || "");
    }
  });
}

function renderNotice(notice) {
  const title = document.getElementById("noticeTitle");
  const date = document.getElementById("noticeDate");
  const items = document.getElementById("noticeItems");
  if (!title || !date || !items) return;

  title.textContent = notice?.title || "공지 제목";
  date.textContent = `기준일: ${notice?.date || "-"}`;

  const html = String(notice?.html || "").trim();
  if (!html) {
    items.innerHTML = DEFAULT_NOTICE_HTML;
    return;
  }

  const hasBlockTags = /<(li|ul|ol|p|div|h[1-6]|blockquote)/i.test(html);
  items.innerHTML = hasBlockTags ? html : `<li>${html}</li>`;
}

function renderFixedContents(snapshot) {
  const contents = snapshot?.page_contents || {};
  FIXED_CONTENTS.forEach(ref => {
    const target = document.getElementById(ref.targetId);
    const config = contents[ref.key];
    if (!target || !config) return;
    target.innerHTML = `
      <div class="major-title"></div>
      <div class="rich-preview"></div>
    `;
    target.querySelector(".major-title").textContent = String(config.majorTitle || ref.title);
    target.querySelector(".rich-preview").innerHTML = String(config.html || config.bodyHtml || "");
  });
}

function renderDynamicContents(snapshot) {
  const contents = snapshot?.page_contents || {};
  const menus = Array.isArray(snapshot?.menus) ? snapshot.menus : [];

  menus.forEach(menu => {
    const panelIndex = Number(menu?.panelIndex);
    if (!Number.isFinite(panelIndex) || panelIndex <= 13 || menu?.kind === "iframe") return;

    const ref = contentRefForPanel(panelIndex);
    const panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);
    const section = panel?.querySelector("section.major-card");
    const config = contents[ref.key];
    if (!panel || !section || !config) return;

    let majorTitle = section.querySelector(".major-title");
    let preview = section.querySelector(".rich-preview");
    if (!majorTitle || !preview) {
      section.innerHTML = `<div class="major-title"></div><div class="rich-preview"></div>`;
      majorTitle = section.querySelector(".major-title");
      preview = section.querySelector(".rich-preview");
    }
    majorTitle.textContent = String(config.majorTitle || menu.title || "");
    preview.innerHTML = String(config.html || config.bodyHtml || "");
    ensureContentEditButton(panel, ref, isGeneralBoard(menu));
  });
}

function noticeEditorHtml() {
  return document.querySelector("#noticeEditor .ql-editor")?.innerHTML ?? "";
}

function setNoticeEditorHtml(html) {
  const editor = document.querySelector("#noticeEditor .ql-editor");
  if (editor) editor.innerHTML = String(html || "");
}

function openLocalNoticeEditor() {
  const notice = currentLocalSnapshot?.notice || {};
  const titleInput = document.getElementById("noticeFormTitle");
  const dateInput = document.getElementById("noticeFormDate");
  const modal = document.getElementById("noticeModal");
  if (!titleInput || !dateInput || !modal) return;

  titleInput.value = String(notice.title || "");
  dateInput.value = String(notice.date || "");
  setNoticeEditorHtml(notice.html || "");
  modal.classList.add("show");
}

async function saveLocalNotice() {
  const payload = {
    title: document.getElementById("noticeFormTitle")?.value?.trim() || "공지 제목",
    date: document.getElementById("noticeFormDate")?.value || "",
    html: noticeEditorHtml()
  };
  const snapshot = await api("/shared-pages/notice", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  currentLocalSnapshot = snapshot;
  applySnapshot(snapshot);
  document.getElementById("noticeModal")?.classList.remove("show");
}

function contentEditorElement() {
  return document.querySelector("#contentEditor .ql-editor");
}

function contentBodyHtml(config) {
  if (typeof config?.bodyHtml === "string" && config.bodyHtml.trim()) return config.bodyHtml;
  const wrap = document.createElement("div");
  wrap.innerHTML = String(config?.html || "");
  wrap.querySelectorAll(".content-table-preview").forEach(table => table.remove());
  return wrap.innerHTML;
}

function preservedTableHtml(config) {
  const wrap = document.createElement("div");
  wrap.innerHTML = String(config?.html || "");
  return wrap.querySelector(".content-table-preview")?.outerHTML || "";
}

function setLocalContentModalMode(enabled) {
  const modal = document.getElementById("contentModal");
  if (!modal) return;
  modal.classList.toggle("local-shared-edit-mode", enabled);

  const tableWrap = document.getElementById("contentTableWrap");
  const tableRow = tableWrap?.closest(".form-row");
  if (tableRow) tableRow.style.display = enabled ? "none" : "";
}

function openLocalContentEditor(refOrPanelIndex) {
  if (currentLocalUser?.role !== "ADMIN") return alert("관리자만 수정할 수 있습니다.");

  const ref = typeof refOrPanelIndex === "object"
    ? refOrPanelIndex
    : contentRefForPanel(Number(refOrPanelIndex));
  const config = currentLocalSnapshot?.page_contents?.[ref.key] || {
    majorTitle: ref.title,
    bodyHtml: "<p>내용을 입력하세요.</p>",
    tableData: { enabled: false, rows: [] },
    html: "<p>내용을 입력하세요.</p>"
  };
  const modal = document.getElementById("contentModal");
  const title = document.getElementById("contentModalTitle");
  const majorTitle = document.getElementById("contentMajorTitle");
  const editor = contentEditorElement();
  if (!modal || !title || !majorTitle || !editor) {
    return alert("게시판 편집기를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.");
  }

  currentLocalContentKey = ref.key;
  currentLocalContentConfig = structuredClone(config);
  title.textContent = `${ref.title || config.majorTitle || "게시판"} 내용 수정`;
  majorTitle.value = String(config.majorTitle || ref.title || "");
  editor.innerHTML = contentBodyHtml(config);
  setLocalContentModalMode(true);
  modal.classList.add("show");
}

function closeLocalContentEditor() {
  document.getElementById("contentModal")?.classList.remove("show");
  setLocalContentModalMode(false);
  currentLocalContentKey = "";
  currentLocalContentConfig = null;
}

async function saveLocalContent() {
  if (!currentLocalContentKey || !currentLocalContentConfig) return;
  const editor = contentEditorElement();
  if (!editor) throw new Error("게시판 편집기를 찾을 수 없습니다.");

  const majorTitle = document.getElementById("contentMajorTitle")?.value?.trim() || "게시판";
  const bodyHtml = editor.innerHTML;
  const tableHtml = preservedTableHtml(currentLocalContentConfig);
  const content = {
    ...currentLocalContentConfig,
    majorTitle,
    bodyHtml,
    html: bodyHtml + tableHtml
  };

  const result = await api(`/shared-pages/contents/${encodeURIComponent(currentLocalContentKey)}`, {
    method: "PUT",
    body: JSON.stringify({ content })
  });

  currentLocalSnapshot = {
    ...(currentLocalSnapshot || {}),
    page_contents: {
      ...(currentLocalSnapshot?.page_contents || {}),
      [currentLocalContentKey]: result.content
    }
  };
  applySnapshot(currentLocalSnapshot);
  closeLocalContentEditor();
}

function ensureLocalAdminControls() {
  const admin = currentLocalUser?.role === "ADMIN";
  const editButton = document.getElementById("noticeEditBtn");
  const saveButton = document.querySelector("#noticeModal .primary-btn");

  if (editButton) {
    editButton.classList.toggle("local-admin-visible", admin);
    if (admin && !editButton.dataset.localNoticeBound) {
      editButton.dataset.localNoticeBound = "1";
      editButton.removeAttribute("onclick");
      editButton.addEventListener("click", openLocalNoticeEditor);
    }
  }

  if (saveButton && admin && !saveButton.dataset.localNoticeBound) {
    saveButton.dataset.localNoticeBound = "1";
    saveButton.removeAttribute("onclick");
    saveButton.addEventListener("click", () => {
      void saveLocalNotice().catch(error => alert(`공지 저장 실패: ${error.message}`));
    });
  }

  document.querySelectorAll(".local-shared-edit-btn").forEach(button => {
    button.classList.toggle("local-admin-visible", admin);
  });

  if (!document.getElementById("local-shared-page-styles")) {
    const style = document.createElement("style");
    style.id = "local-shared-page-styles";
    style.textContent = `
      body.limited-deployment-mode #noticeEditBtn.local-admin-visible,
      body.limited-deployment-mode .local-shared-edit-btn.local-admin-visible{display:inline-flex!important}
      body.limited-deployment-mode .panel-edit-btn:not(.local-shared-edit-btn){display:none!important}
    `;
    document.head.appendChild(style);
  }
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  currentLocalSnapshot = snapshot;
  ensureLocalNoticeMenu();
  ensureLocalFixedUi(snapshot);
  ensureLocalDynamicUi(snapshot);
  renderNotice(snapshot.notice || {});
  renderFixedContents(snapshot);
  renderDynamicContents(snapshot);
  ensureLocalAdminControls();
  window.dispatchEvent(new CustomEvent("local-shared-pages-loaded", { detail: snapshot }));
}

function isUninitialized(snapshot) {
  if (!snapshot) return true;
  const menusEmpty = !Array.isArray(snapshot.menus) || snapshot.menus.length === 0;
  const contentsEmpty = !snapshot.page_contents || Object.keys(snapshot.page_contents).length === 0;
  const notice = snapshot.notice || {};
  const noticeEmpty = !Object.keys(notice).length || (
    String(notice.title || "공지 제목") === "공지 제목" &&
    !String(notice.date || "") &&
    String(notice.html || DEFAULT_NOTICE_HTML).trim() === DEFAULT_NOTICE_HTML
  );
  return menusEmpty && contentsEmpty && noticeEmpty;
}

async function readLegacyFirebaseSettings() {
  if (legacyFirebaseSettingsPromise) return legacyFirebaseSettingsPromise;

  legacyFirebaseSettingsPromise = (async () => {
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
      console.warn("기존 Firebase 공지/콘텐츠 읽기 실패:", error);
      return null;
    }
  })();

  return legacyFirebaseSettingsPromise;
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
    : typeof raw.html === "string"
      ? raw.html
      : "";
  return {
    ...raw,
    majorTitle: raw.majorTitle || title,
    bodyHtml,
    tableData: raw.tableData || { enabled: false, rows: [] },
    html: typeof raw.html === "string" ? raw.html : bodyHtml
  };
}

async function bootstrapFromLegacyIfNeeded(snapshot, user) {
  if (!isUninitialized(snapshot) || user?.role !== "ADMIN") return snapshot;

  const legacy = await readLegacyFirebaseSettings();
  if (!legacy) return snapshot;

  const menus = Array.isArray(legacy.menus) ? legacy.menus : [];
  const notice = legacy.notice || {};
  const rawContents = legacy.pageContents && typeof legacy.pageContents === "object"
    ? legacy.pageContents
    : {};
  const pageContents = {};
  Object.entries(rawContents).forEach(([key, raw]) => {
    const fixed = FIXED_CONTENTS.find(item => item.key === key);
    pageContents[key] = normalizeImportedContent(raw, fixed?.title || key) || raw;
  });

  const hasUsefulData = menus.length || Object.keys(pageContents).length || Object.keys(notice).length;
  if (!hasUsefulData) return snapshot;

  try {
    return await api("/shared-pages/bootstrap", {
      method: "POST",
      body: JSON.stringify({ menus, notice, page_contents: pageContents })
    });
  } catch (error) {
    if (error.status === 409) return api("/shared-pages");
    throw error;
  }
}

async function importMissingFixedContents(snapshot, user) {
  if (user?.role !== "ADMIN") return snapshot;

  const missing = FIXED_CONTENTS.filter(ref => !snapshot?.page_contents?.[ref.key]);
  if (!missing.length) return snapshot;

  const legacy = await readLegacyFirebaseSettings();
  const source = legacy?.pageContents;
  if (!source || typeof source !== "object") return snapshot;

  let nextSnapshot = {
    ...snapshot,
    page_contents: { ...(snapshot.page_contents || {}) }
  };

  for (const ref of missing) {
    const content = normalizeImportedContent(source[ref.key], ref.title);
    if (!content) continue;
    const result = await api(`/shared-pages/contents/${encodeURIComponent(ref.key)}`, {
      method: "PUT",
      body: JSON.stringify({ content })
    });
    nextSnapshot.page_contents[ref.key] = result.content;
  }

  return nextSnapshot;
}

async function loadLocalSharedPages() {
  let user;
  try {
    user = await api("/auth/me");
  } catch (error) {
    if (error.status === 401) {
      currentLocalUser = null;
      ensureLocalAdminControls();
      return null;
    }
    throw error;
  }

  currentLocalUser = user;
  let snapshot = await api("/shared-pages");
  snapshot = await bootstrapFromLegacyIfNeeded(snapshot, user);
  snapshot = await importMissingFixedContents(snapshot, user);
  applySnapshot(snapshot);
  return snapshot;
}

function bindLocalModalActions() {
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const contentModal = document.getElementById("contentModal");
    if (contentModal?.classList.contains("local-shared-edit-mode")) {
      if (target.closest("#contentModal .primary-btn")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void saveLocalContent().catch(error => alert(`게시판 저장 실패: ${error.message}`));
        return;
      }
      if (target.closest("#contentModal .secondary-btn")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeLocalContentEditor();
      }
    }
  }, true);
}

function installLocalUiObserver() {
  let timer = null;
  const observer = new MutationObserver(mutations => {
    if (!currentLocalSnapshot) return;
    const relevant = mutations.some(mutation => mutation.type === "childList");
    if (!relevant) return;
    clearTimeout(timer);
    timer = setTimeout(() => applySnapshot(currentLocalSnapshot), 40);
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
      void loadLocalSharedPages().catch(error => {
        console.error("로컬 공지/게시판 불러오기 실패:", error);
      });
    }, delay);
  };

  window.localSharedPagesApi = {
    refresh: () => refresh(0),
    get: loadLocalSharedPages,
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

  bindLocalModalActions();
  installLocalUiObserver();

  document.addEventListener("submit", event => {
    if (event.target?.matches?.("#grv2LoginForm,#allocationLoginForm")) {
      refresh(300);
      refresh(900);
    }
  }, true);

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("#grv2Logout")) refresh(300);
  }, true);

  [0, 250, 800, 1600].forEach(delay => refresh(delay));
}

installLocalSharedPages();
