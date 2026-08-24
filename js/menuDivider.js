function compact(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[📊📝📢]/g, "")
    .trim();
}

function ensureSidebarPresentationOverrides() {
  if (document.getElementById("sidebar-presentation-overrides")) return;
  const style = document.createElement("style");
  style.id = "sidebar-presentation-overrides";
  style.textContent = `
    html body.limited-deployment-mode #topNav .nav-item:hover,
    html body.limited-deployment-mode #bottomNav .nav-item:hover,
    html body.limited-deployment-mode #topNav .nav-group-toggle:hover,
    html body.limited-deployment-mode #topNav [data-authoritative-group]:hover,
    html body.limited-deployment-mode #topNav .nav-item.active:hover,
    html body.limited-deployment-mode #bottomNav .nav-item.active:hover {
      font-size:calc(13px + 1pt)!important;
    }

    html body.limited-deployment-mode #topNav .local-board-subgroup > .nav-item.local-board-sub-item:hover,
    html body.limited-deployment-mode #topNav .nav-sub-group > .nav-item:hover {
      font-size:calc(12px + 1pt)!important;
    }

    html body.limited-deployment-mode .sidebar {
      overflow-x:hidden!important;
      overflow-y:auto!important;
      overflow-anchor:none!important;
    }

    html body.limited-deployment-mode .sidebar-content {
      flex:0 0 auto!important;
      min-height:0!important;
      overflow-x:hidden!important;
      overflow-y:visible!important;
      overflow-anchor:none!important;
    }

    html body.limited-deployment-mode #topNav,
    html body.limited-deployment-mode #bottomNav,
    html body.limited-deployment-mode #topNav .local-board-subgroup,
    html body.limited-deployment-mode #topNav .nav-sub-group,
    html body.limited-deployment-mode #topNav [data-authoritative-group-wrap] {
      max-height:none!important;
      overflow-y:visible!important;
      overflow-anchor:none!important;
    }

    html body.limited-deployment-mode #limitedLoginBox.visible {
      position:sticky!important;
      bottom:10px!important;
      z-index:30!important;
      flex:0 0 auto!important;
      margin-top:auto!important;
      margin-bottom:10px!important;
      background:#ece2a1!important;
      overflow-anchor:none!important;
    }
  `;
  document.head.appendChild(style);
}

function applyMenuStateColors() {
  document.querySelectorAll("#topNav .nav-item, #bottomNav .nav-item").forEach(button => {
    const isGroupToggle = button.matches("[data-authoritative-group], .nav-group-toggle, .local-board-group-toggle");
    const isSelected = !isGroupToggle && button.classList.contains("active");
    button.style.setProperty("color", isSelected ? "#facc15" : "#ffffff", "important");
  });

  document.querySelectorAll("#topNav [data-authoritative-group], #topNav .nav-group-toggle").forEach(toggle => {
    toggle.style.setProperty("color", "#ffffff", "important");
  });
}

function installMenuStateObserver() {
  const topNav = document.getElementById("topNav");
  if (!topNav || topNav.dataset.menuStateColorObserver === "1") return;
  topNav.dataset.menuStateColorObserver = "1";

  const observer = new MutationObserver(() => applyMenuStateColors());
  observer.observe(topNav, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });
}

function findNoticeButton(topNav) {
  return Array.from(topNav.querySelectorAll(".nav-item"))
    .find(button => compact(button.textContent).includes("공지사항")) || null;
}

function applyNoticeDivider() {
  const topNav = document.getElementById("topNav");
  if (!topNav) return;

  // Remove the previous standalone divider. Its DOM position could be changed
  // by the authoritative menu renderer, which made the line appear above notice.
  topNav.querySelectorAll(":scope > .fixed-notice-menu-divider").forEach(node => node.remove());

  const noticeButton = findNoticeButton(topNav);
  if (!noticeButton) return;

  // Attach the separator to the notice button itself. It therefore follows the
  // notice item even when another renderer reorders menu DOM nodes.
  noticeButton.style.setProperty("border-bottom", "1px solid rgba(255,255,255,.30)", "important");
  noticeButton.style.setProperty("margin-bottom", "8px", "important");
}

function applySidebarPresentation() {
  ensureSidebarPresentationOverrides();
  installMenuStateObserver();
  applyMenuStateColors();
  applyNoticeDivider();
}

function scheduleSidebarPresentation() {
  applySidebarPresentation();
  [0, 30, 120, 350, 900, 1800].forEach(delay => setTimeout(applySidebarPresentation, delay));
}

window.addEventListener("local-shared-pages-loaded", scheduleSidebarPresentation);
window.addEventListener("load", scheduleSidebarPresentation, { once: true });
document.addEventListener("click", () => queueMicrotask(applyMenuStateColors), true);
scheduleSidebarPresentation();
