const API_ROOT = "/api/v1";
const DEFAULT_NOTICE_HTML = "<li>공지 내용이 없습니다.</li>";

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
    .find(item => item.textContent?.replace(/\s+/g, "").includes("공지사항"));
  if (existing) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-item nav-item-notice";
  button.dataset.localSharedMenu = "notice";
  button.textContent = "📢 청현 공지사항";
  button.addEventListener("click", () => showPanel(0, button));
  topNav.prepend(button);
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

    let panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "sheet-panel";
      panel.dataset.index = String(panelIndex);
      panel.dataset.localSharedPanel = "1";
      panel.innerHTML = `
        <header class="sheet-header"><h1></h1></header>
        <section class="major-card">
          <div class="major-title"></div>
          <div class="rich-preview"></div>
        </section>
      `;
      main.appendChild(panel);
    }
    panel.querySelector(".sheet-header h1").textContent = String(menu.title || `게시판 ${panelIndex}`);

    const existingButton = Array.from(topNav.querySelectorAll(".nav-item"))
      .find(item => Number(item.dataset.localSharedPanelIndex) === panelIndex);
    if (!existingButton) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nav-item";
      button.dataset.localSharedMenu = "dynamic";
      button.dataset.localSharedPanelIndex = String(panelIndex);
      button.textContent = String(menu.title || `게시판 ${panelIndex}`);
      button.addEventListener("click", () => showPanel(panelIndex, button));
      topNav.appendChild(button);
    }

    const config = contents[`panel_${panelIndex}`];
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

function renderDynamicContents(snapshot) {
  const contents = snapshot?.page_contents || {};
  const menus = Array.isArray(snapshot?.menus) ? snapshot.menus : [];

  menus.forEach(menu => {
    const panelIndex = Number(menu?.panelIndex);
    if (!Number.isFinite(panelIndex) || panelIndex <= 13 || menu?.kind === "iframe") return;

    const panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);
    const section = panel?.querySelector("section.major-card");
    const config = contents[`panel_${panelIndex}`];
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
  });
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  ensureLocalNoticeMenu();
  ensureLocalDynamicUi(snapshot);
  renderNotice(snapshot.notice || {});
  renderDynamicContents(snapshot);
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

function legacyNoticeReady() {
  const title = document.getElementById("noticeTitle")?.textContent?.trim() || "";
  return Boolean(title && title !== "공지 불러오는 중...");
}

async function waitForLegacyRender(timeoutMs = 2400) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (legacyNoticeReady()) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return legacyNoticeReady();
}

function stripDatePrefix(value) {
  return String(value || "").replace(/^기준일:\s*/, "").trim();
}

function scrapeLegacySnapshot() {
  const noticeTitle = document.getElementById("noticeTitle")?.textContent?.trim() || "공지 제목";
  const noticeDate = stripDatePrefix(document.getElementById("noticeDate")?.textContent || "");
  const noticeHtml = document.getElementById("noticeItems")?.innerHTML?.trim() || DEFAULT_NOTICE_HTML;

  const menus = [];
  const pageContents = {};

  document.querySelectorAll(".sheet-panel[data-index]").forEach(panel => {
    const panelIndex = Number(panel.dataset.index);
    if (!Number.isFinite(panelIndex) || panelIndex <= 13) return;

    const title = panel.querySelector(".sheet-header h1")?.textContent?.trim() || `게시판 ${panelIndex}`;
    const section = panel.querySelector("section.major-card");
    if (!section) return;

    const majorTitle = section.querySelector(".major-title")?.textContent?.trim() || title;
    const preview = section.querySelector(".rich-preview");
    const html = preview?.innerHTML?.trim() || section.innerHTML.trim();

    menus.push({
      title,
      panelIndex,
      location: "top",
      kind: "panel",
      group: ""
    });
    pageContents[`panel_${panelIndex}`] = {
      majorTitle,
      bodyHtml: html,
      tableData: { enabled: false, rows: [] },
      html
    };
  });

  return {
    menus,
    notice: {
      title: noticeTitle,
      date: noticeDate === "-" ? "" : noticeDate,
      html: noticeHtml
    },
    page_contents: pageContents
  };
}

async function bootstrapFromLegacyIfNeeded(snapshot, user) {
  if (!isUninitialized(snapshot) || user?.role !== "ADMIN") return snapshot;

  await waitForLegacyRender();
  const legacy = scrapeLegacySnapshot();
  const hasUsefulNotice = legacy.notice.title !== "공지 제목" || legacy.notice.date || legacy.notice.html !== DEFAULT_NOTICE_HTML;
  const hasDynamicContents = legacy.menus.length > 0;
  if (!hasUsefulNotice && !hasDynamicContents) return snapshot;

  try {
    return await api("/shared-pages/bootstrap", {
      method: "POST",
      body: JSON.stringify(legacy)
    });
  } catch (error) {
    if (error.status === 409) return api("/shared-pages");
    throw error;
  }
}

async function loadLocalSharedPages() {
  let user;
  try {
    user = await api("/auth/me");
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }

  let snapshot = await api("/shared-pages");
  snapshot = await bootstrapFromLegacyIfNeeded(snapshot, user);
  applySnapshot(snapshot);
  return snapshot;
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
