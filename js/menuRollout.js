const API_ROOT = "/api/v1";
const LAW_PRIORITY_ROLLOUT_VERSION = 3;

const LAW_PRIORITY_TITLES = new Set([
  "법정선순위임차미진행주택",
  "법정선순위임차미진행상가",
  "법정선순위임차경매진행",
  "법정선순위임차그외관련내용",
  "법정선순위임금",
  "법정선순위조세당해세"
]);

let persistInFlight = false;
let persistCompleted = false;

function titleKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}&]+/gu, "");
}

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

function normalizeLawPriorityMenus(snapshot) {
  if (!Array.isArray(snapshot?.menus)) return false;

  const before = snapshot.menus;
  const next = [];
  let changed = false;

  for (const source of before) {
    const menu = { ...source };
    const panelIndex = Number(menu?.panelIndex);
    const key = titleKey(menu?.title);

    // 기존 고정 임대차/임금/조세 메뉴는 메뉴 목록에서 완전히 제거한다.
    // page_contents 데이터는 백엔드에 그대로 남으므로 내용 자체는 삭제되지 않는다.
    if (panelIndex >= 1 && panelIndex <= 3) {
      changed = true;
      continue;
    }

    if (panelIndex === 4 || key === "선순위임차인q&a" || key === "선순위임차인qa") {
      if (menu.group !== "qna") {
        menu.group = "qna";
        changed = true;
      }
      next.push(menu);
      continue;
    }

    if (LAW_PRIORITY_TITLES.has(key)) {
      if (menu.group !== "work" || menu.hidden === true || Number(menu.lawPriorityRolloutVersion) !== LAW_PRIORITY_ROLLOUT_VERSION) {
        menu.group = "work";
        menu.hidden = false;
        menu.lawPriorityRolloutVersion = LAW_PRIORITY_ROLLOUT_VERSION;
        changed = true;
      }
      next.push(menu);
      continue;
    }

    if (String(menu.group || "").trim().toLowerCase() === "work") {
      menu.group = "reference";
      menu.hidden = true;
      menu.lawPriorityRolloutVersion = LAW_PRIORITY_ROLLOUT_VERSION;
      changed = true;
    }

    next.push(menu);
  }

  if (changed) snapshot.menus = next;
  return changed;
}

async function persistMenus(snapshot, changed) {
  if (!changed || persistInFlight || persistCompleted || !Array.isArray(snapshot?.menus)) return;
  persistInFlight = true;
  try {
    let user;
    try {
      user = await api("/auth/me");
    } catch (error) {
      if (error.status === 401) return;
      throw error;
    }
    if (user?.role !== "ADMIN") return;

    await api("/shared-pages/menus", {
      method: "PUT",
      body: JSON.stringify({ menus: snapshot.menus, notice: {}, page_contents: {} })
    });
    persistCompleted = true;
    window.localSharedPagesApi?.refresh?.();
  } catch (error) {
    console.error("메뉴 단일화 저장 실패:", error);
  } finally {
    persistInFlight = false;
  }
}

window.addEventListener("local-shared-pages-loaded", event => {
  const snapshot = event?.detail;
  if (!snapshot) return;
  const changed = normalizeLawPriorityMenus(snapshot);
  void persistMenus(snapshot, changed);
});
