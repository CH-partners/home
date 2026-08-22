const ALLOWED_PANEL_INDEXES = new Set([11, 13]);
const ALLOWED_LABELS = new Set(["분배표", "그룹리뷰"]);

function normalizeLabel(value) {
  return String(value || "").replace(/\s+/g, "").replace(/[📊📝]/g, "").trim();
}

function applyDeploymentMode() {
  document.body.classList.add("limited-deployment-mode");

  const adminBox = document.querySelector(".admin-box");
  if (adminBox) adminBox.style.display = "none";

  document.querySelectorAll(".sheet-panel").forEach(panel => {
    const index = Number(panel.dataset.index);
    if (Number.isFinite(index) && !ALLOWED_PANEL_INDEXES.has(index)) {
      panel.style.display = "none";
      panel.classList.remove("active");
    } else if (ALLOWED_PANEL_INDEXES.has(index)) {
      panel.style.display = "";
    }
  });

  document.querySelectorAll("#topNav .nav-item, #bottomNav .nav-item, #topNav .nav-group-toggle, #topNav .nav-sub-group, #topNav .nav-divider, #bottomNav .nav-divider").forEach(node => {
    if (node.classList.contains("nav-item")) {
      const label = normalizeLabel(node.textContent);
      node.style.display = ALLOWED_LABELS.has(label) ? "" : "none";
    } else {
      node.style.display = "none";
    }
  });

  const active = document.querySelector(".sheet-panel.active");
  const activeIndex = Number(active?.dataset?.index);
  if (!ALLOWED_PANEL_INDEXES.has(activeIndex)) {
    const allocationButton = Array.from(document.querySelectorAll(".nav-item"))
      .find(button => normalizeLabel(button.textContent) === "분배표");
    if (allocationButton) allocationButton.click();
    else {
      document.querySelector('.sheet-panel[data-index="11"]')?.classList.add("active");
      window.allocationApi?.renderAllocationUI?.();
    }
  }
}

let timer = null;
const observer = new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(applyDeploymentMode, 20);
});

window.addEventListener("DOMContentLoaded", () => {
  applyDeploymentMode();
  observer.observe(document.body, { childList: true, subtree: true });
  [100, 300, 700, 1200].forEach(delay => setTimeout(applyDeploymentMode, delay));
});
