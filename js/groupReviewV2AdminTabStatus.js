const API_ROOT = "/api/v1";

async function api(path) {
  const response = await fetch(`${API_ROOT}${path}`, { credentials: "include" });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`);
  return data;
}

export function installGroupReviewAdminTabStatusV2() {
  if (window.__grv2AdminTabStatusInstalled) return;
  window.__grv2AdminTabStatusInstalled = true;

  let timer = null;
  let applying = false;

  function ensureStyles() {
    if (document.getElementById("grv2-admin-tab-status-styles")) return;
    const style = document.createElement("style");
    style.id = "grv2-admin-tab-status-styles";
    style.textContent = `
      .grv2-tab.grv2-admin-complete {
        background: #fff3b0 !important;
        border-color: #eab308 !important;
        color: #713f12 !important;
      }
      .grv2-tab.grv2-admin-reuse {
        background: #fecaca !important;
        border-color: #ef4444 !important;
        color: #991b1b !important;
      }
      .grv2-tab.grv2-admin-complete.active,
      .grv2-tab.grv2-admin-reuse.active {
        font-weight: 800;
      }
    `;
    document.head.appendChild(style);
  }

  function activeProjectId() {
    return document.querySelector("#groupReviewProjectBadges .grv2-project-badge.active")?.dataset?.projectId || "";
  }

  function clearAdminStatus() {
    document.querySelectorAll("#groupReviewBody .grv2-tab").forEach(tab => {
      tab.classList.remove("grv2-admin-complete", "grv2-admin-reuse");
      tab.removeAttribute("title");
    });
  }

  async function applyAdminStatus() {
    if (applying) return;
    const projectId = activeProjectId();
    const tabs = Array.from(document.querySelectorAll("#groupReviewBody .grv2-tab[data-sheet-id]"));
    if (!projectId || !tabs.length) return;

    applying = true;
    try {
      const user = await api("/auth/me");
      if (user?.role !== "ADMIN") {
        clearAdminStatus();
        return;
      }

      const sheets = await api(`/group-review/projects/${encodeURIComponent(projectId)}/sheets`);
      const byId = new Map((Array.isArray(sheets) ? sheets : []).map(sheet => [Number(sheet.id), sheet]));

      tabs.forEach(tab => {
        const sheet = byId.get(Number(tab.dataset.sheetId));
        if (!sheet) return;

        // 관리자 화면에서는 상태 문구를 붙이지 않고 작업자 이름만 표시한다.
        const name = String(sheet.member_name || "");
        if (tab.textContent !== name) tab.textContent = name;

        const reuseRequested = Boolean(sheet.reuse_requested);
        const completed = Boolean(sheet.completed);
        tab.classList.toggle("grv2-admin-reuse", reuseRequested);
        tab.classList.toggle("grv2-admin-complete", completed && !reuseRequested);

        if (reuseRequested) tab.title = "재사용 요청";
        else if (completed) tab.title = "입력 완료";
        else tab.removeAttribute("title");
      });
    } catch (_) {
      // 기본 Group Review 화면은 그대로 유지한다.
    } finally {
      applying = false;
    }
  }

  function scheduleApply(delay = 80) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void applyAdminStatus();
    }, delay);
  }

  function startObserver() {
    const body = document.getElementById("groupReviewBody");
    if (!body) {
      setTimeout(startObserver, 100);
      return;
    }

    const observer = new MutationObserver(mutations => {
      if (applying) return;
      const screenRebuilt = mutations.some(mutation => mutation.target === body);
      if (screenRebuilt) scheduleApply();
    });
    observer.observe(body, { childList: true });

    [0, 200, 600].forEach(delay => setTimeout(() => scheduleApply(0), delay));
  }

  ensureStyles();
  startObserver();
}
