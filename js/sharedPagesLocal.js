const API_ROOT = "/api/v1";

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

function renderNotice(notice) {
  const title = document.getElementById("noticeTitle");
  const date = document.getElementById("noticeDate");
  const items = document.getElementById("noticeItems");
  if (!title || !date || !items) return;

  title.textContent = notice?.title || "공지 제목";
  date.textContent = `기준일: ${notice?.date || "-"}`;

  const html = String(notice?.html || "").trim();
  if (!html) {
    items.innerHTML = "<li>공지 내용이 없습니다.</li>";
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

    const majorTitle = String(config.majorTitle || menu.title || "");
    const html = String(config.html || config.bodyHtml || "");
    section.innerHTML = `
      <div class="major-title"></div>
      <div class="rich-preview"></div>
    `;
    section.querySelector(".major-title").textContent = majorTitle;
    section.querySelector(".rich-preview").innerHTML = html;
  });
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  renderNotice(snapshot.notice || {});
  renderDynamicContents(snapshot);
  window.dispatchEvent(new CustomEvent("local-shared-pages-loaded", { detail: snapshot }));
}

async function loadLocalSharedPages() {
  try {
    await api("/auth/me");
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }

  const snapshot = await api("/shared-pages");
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
