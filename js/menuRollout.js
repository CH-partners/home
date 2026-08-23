const VISIBILITY_PRESET_VERSION = 2;

function compact(value) {
  return String(value || "").replace(/\s+/g, "").trim().toLowerCase();
}

function isLawPriorityMenu(menu) {
  const group = String(menu?.group || "").trim().toLowerCase();
  if (group === "work") return true;

  const panelIndex = Number(menu?.panelIndex);
  if (panelIndex >= 1 && panelIndex <= 3) return true;

  const title = compact(menu?.title);
  return title.includes("임대차") || title.includes("임차") || title.includes("임금") || title.includes("조세");
}

function activateLawPriorityGroup(snapshot) {
  if (!Array.isArray(snapshot?.menus)) return;

  snapshot.menus.forEach(menu => {
    if (!isLawPriorityMenu(menu)) return;
    menu.group = "work";
    menu.hidden = false;
    menu.visibilityInitialized = true;
    menu.visibilityPresetVersion = VISIBILITY_PRESET_VERSION;
  });
}

function removeLawPriorityEmoji() {
  const toggle = document.querySelector('[data-unified-group-toggle="work"]');
  const label = toggle?.querySelector("span:first-child");
  if (label && label.textContent !== "법정선순위") label.textContent = "법정선순위";
}

window.addEventListener("local-shared-pages-loaded", event => {
  const snapshot = event?.detail;
  if (!snapshot) return;

  activateLawPriorityGroup(snapshot);
  queueMicrotask(removeLawPriorityEmoji);
  setTimeout(removeLawPriorityEmoji, 0);
});
