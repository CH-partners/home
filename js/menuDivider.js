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
    }

    html body.limited-deployment-mode .sidebar-content {
      flex:0 0 auto!important;
      min-height:0!important;
      overflow-x:hidden!important;
      overflow-y:visible!important;
    }

    html body.limited-deployment-mode #topNav,
    html body.limited-deployment-mode #bottomNav,
    html body.limited-deployment-mode #topNav .local-board-subgroup,
    html body.limited-deployment-mode #topNav .nav-sub-group,
    html body.limited-deployment-mode #topNav [data-authoritative-group-wrap] {
      max-height:none!important;
      overflow-y:visible!important;
    }
  `;
  document.head.appendChild(style);
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

function scheduleNoticeDivider() {
  ensureSidebarPresentationOverrides();
  applyNoticeDivider();
  [0, 30, 120, 350, 900, 1800].forEach(delay => setTimeout(() => {
    ensureSidebarPresentationOverrides();
    applyNoticeDivider();
  }, delay));
}

window.addEventListener("local-shared-pages-loaded", scheduleNoticeDivider);
window.addEventListener("load", scheduleNoticeDivider, { once: true });
scheduleNoticeDivider();
