function compact(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[📊📝📢]/g, "")
    .trim();
}

function ensureStyles() {
  if (document.getElementById("fixed-notice-menu-divider-style")) return;
  const style = document.createElement("style");
  style.id = "fixed-notice-menu-divider-style";
  style.textContent = `
    #topNav .fixed-notice-menu-divider {
      display:block!important;
      width:calc(100% - 36px)!important;
      min-width:0!important;
      max-width:calc(100% - 36px)!important;
      height:1px!important;
      min-height:1px!important;
      margin:7px 18px 8px!important;
      padding:0!important;
      border:0!important;
      border-radius:0!important;
      background:rgba(255,255,255,.28)!important;
      box-shadow:none!important;
      pointer-events:none!important;
      flex:none!important;
    }
  `;
  document.head.appendChild(style);
}

function findNoticeButton(topNav) {
  return Array.from(topNav.querySelectorAll(".nav-item"))
    .find(button => compact(button.textContent).includes("공지사항")) || null;
}

function ensureNoticeDivider() {
  ensureStyles();
  const topNav = document.getElementById("topNav");
  if (!topNav) return;

  const noticeButton = findNoticeButton(topNav);
  let divider = topNav.querySelector(":scope > .fixed-notice-menu-divider");

  if (!noticeButton) {
    divider?.remove();
    return;
  }

  if (!divider) {
    divider = document.createElement("div");
    divider.className = "fixed-notice-menu-divider";
    divider.dataset.fixedNoticeDivider = "1";
    divider.setAttribute("aria-hidden", "true");
  }

  if (noticeButton.nextElementSibling !== divider) {
    noticeButton.insertAdjacentElement("afterend", divider);
  }
}

window.addEventListener("local-shared-pages-loaded", ensureNoticeDivider);
window.addEventListener("load", ensureNoticeDivider, { once: true });
[0, 100, 300, 800].forEach(delay => setTimeout(ensureNoticeDivider, delay));
