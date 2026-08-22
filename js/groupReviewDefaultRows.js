const API_ROOT = "/api/v1";

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json; charset=utf-8";
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers, credentials: "include" });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`);
  return data;
}

export function installGroupReviewDefaultRowsV2(groupReviewApi) {
  if (window.__grv2DefaultRowsInstalled) return;
  window.__grv2DefaultRowsInstalled = true;

  const initialized = new Set();
  const pending = new Set();
  let timer = null;

  function schedule(delay = 120) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void ensureDefaultRows();
    }, delay);
  }

  async function ensureDefaultRows() {
    const body = document.getElementById("groupReviewBody");
    if (!body) return;

    const role = body.querySelector(".grv2-role")?.textContent?.trim();
    if (role !== "WORKER") return;

    const ownTab = body.querySelector(".grv2-tab.own[data-sheet-id]");
    if (!ownTab || !ownTab.classList.contains("active")) return;

    const sheetId = Number(ownTab.dataset.sheetId || 0);
    if (!sheetId || initialized.has(sheetId) || pending.has(sheetId)) return;

    pending.add(sheetId);
    try {
      const rows = await api(`/group-review/sheets/${sheetId}/rows`);
      if (Array.isArray(rows) && rows.length > 0) {
        initialized.add(sheetId);
        return;
      }

      for (let index = 0; index < 5; index += 1) {
        await api(`/group-review/sheets/${sheetId}/rows`, {
          method: "POST",
          body: JSON.stringify({})
        });
      }

      initialized.add(sheetId);
      await groupReviewApi?.refresh?.();
    } catch (_) {
      // 기본 그룹리뷰 화면과 수동 행 추가 기능은 그대로 유지한다.
    } finally {
      pending.delete(sheetId);
    }
  }

  const observer = new MutationObserver(() => schedule());
  const startObserver = () => {
    const body = document.getElementById("groupReviewBody");
    if (!body) return setTimeout(startObserver, 100);
    observer.observe(body, { childList: true, subtree: true });
    schedule(0);
  };

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".grv2-project-badge,.grv2-tab,#grv2Refresh")) schedule(250);
  }, true);

  startObserver();
}
