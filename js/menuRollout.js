const API_ROOT = "/api/v1";
const VISIBILITY_PRESET_VERSION = 2;
const LAW_PRIORITY_ROLLOUT_VERSION = 2;

const LAW_PRIORITY_ITEMS = new Map([
  ["법정선순위임차미진행주택", "✍️법정선순위: 임차(미진행_주택)"],
  ["법정선순위임차미진행상가", "✍️법정선순위: 임차(미진행_상가)"],
  ["법정선순위임차경매진행", "✍️법정선순위: 임차(경매진행)"],
  ["법정선순위임차그외관련내용", "✍️법정선순위: 임차(그외 관련내용)"],
  ["법정선순위임금", "✍️법정선순위 [임금]"],
  ["법정선순위조세당해세", "✍️법정선순위 [조세·당해세]"]
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

function markVisibility(menu, hidden) {
  menu.hidden = hidden;
  menu.visibilityInitialized = true;
  menu.visibilityPresetVersion = VISIBILITY_PRESET_VERSION;
  menu.lawPriorityRolloutVersion = LAW_PRIORITY_ROLLOUT_VERSION;
}

function applyLawPriorityRules(snapshot) {
  if (!Array.isArray(snapshot?.menus)) return false;

  let changed = false;
  for (const menu of snapshot.menus) {
    const panelIndex = Number(menu?.panelIndex);
    const key = titleKey(menu?.title);
    const canonicalTitle = LAW_PRIORITY_ITEMS.get(key);
    const currentVersion = Number(menu?.lawPriorityRolloutVersion) || 0;

    if (canonicalTitle) {
      if (
        currentVersion < LAW_PRIORITY_ROLLOUT_VERSION ||
        menu.title !== canonicalTitle ||
        menu.group !== "work" ||
        menu.hidden !== false
      ) {
        menu.title = canonicalTitle;
        menu.group = "work";
        markVisibility(menu, false);
        changed = true;
      }
      continue;
    }

    // 구형 고정 임대차/임금/조세 메뉴는 더 이상 법정선순위에 표시하지 않는다.
    if (panelIndex >= 1 && panelIndex <= 3) {
      if (
        currentVersion < LAW_PRIORITY_ROLLOUT_VERSION ||
        menu.group !== "reference" ||
        menu.hidden !== true
      ) {
        menu.group = "reference";
        markVisibility(menu, true);
        changed = true;
      }
      continue;
    }

    // 선순위임차인Q&A는 법정선순위가 아니라 Q&A 펼침메뉴 소속이다.
    if (panelIndex === 4 || key === "선순위임차인q&a" || key === "선순위임차인qa") {
      if (
        currentVersion < LAW_PRIORITY_ROLLOUT_VERSION ||
        menu.group !== "qna" ||
        menu.hidden !== true
      ) {
        menu.group = "qna";
        markVisibility(menu, true);
        changed = true;
      }
      continue;
    }

    // 이전의 넓은 자동분류로 work에 잘못 들어간 메뉴는 법정선순위에서 제거한다.
    if (String(menu?.group || "").trim().toLowerCase() === "work") {
      if (currentVersion < LAW_PRIORITY_ROLLOUT_VERSION || menu.group !== "reference" || menu.hidden !== true) {
        menu.group = "reference";
        markVisibility(menu, true);
        changed = true;
      }
    }
  }

  return changed;
}

function removeLawPriorityEmoji() {
  const toggle = document.querySelector('[data-unified-group-toggle="work"]');
  const label = toggle?.querySelector("span:first-child");
  if (label && label.textContent !== "법정선순위") label.textContent = "법정선순위";
}

async function persistRules(snapshot, changed) {
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
      body: JSON.stringify({
        menus: snapshot.menus,
        notice: {},
        page_contents: {}
      })
    });
    persistCompleted = true;
    window.localSharedPagesApi?.refresh?.();
  } catch (error) {
    console.error("법정선순위 메뉴 정리 저장 실패:", error);
  } finally {
    persistInFlight = false;
  }
}

window.addEventListener("local-shared-pages-loaded", event => {
  const snapshot = event?.detail;
  if (!snapshot) return;

  const changed = applyLawPriorityRules(snapshot);
  void persistRules(snapshot, changed);
  queueMicrotask(removeLawPriorityEmoji);
  setTimeout(removeLawPriorityEmoji, 0);
});
