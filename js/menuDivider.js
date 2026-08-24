function compact(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[📊📝📢]/g, "")
    .trim();
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
  applyNoticeDivider();
  [0, 30, 120, 350, 900, 1800].forEach(delay => setTimeout(applyNoticeDivider, delay));
}

window.addEventListener("local-shared-pages-loaded", scheduleNoticeDivider);
window.addEventListener("load", scheduleNoticeDivider, { once: true });
scheduleNoticeDivider();
