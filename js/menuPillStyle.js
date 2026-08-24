function installMenuTextStyle() {
  if (!document.getElementById("menu-text-style")) {
    const style = document.createElement("style");
    style.id = "menu-text-style";
    style.textContent = `
      body.limited-deployment-mode #topNav .nav-item,
      body.limited-deployment-mode #bottomNav .nav-item {
        width:calc(100% - 24px)!important;
        min-width:0!important;
        height:36px!important;
        margin:0 12px!important;
        padding:0 8px!important;
        justify-content:flex-start!important;
        text-align:left!important;
        border:0!important;
        border-radius:0!important;
        background:transparent!important;
        box-shadow:none!important;
        color:#ffffff!important;
        font-size:13px!important;
        font-weight:500!important;
        line-height:1.2!important;
        transform:none!important;
        transition:font-size .12s ease,font-weight .12s ease,opacity .12s ease!important;
      }

      body.limited-deployment-mode #topNav .nav-item:hover,
      body.limited-deployment-mode #bottomNav .nav-item:hover {
        background:transparent!important;
        border:0!important;
        box-shadow:none!important;
        color:#ffffff!important;
        font-size:17px!important;
        font-weight:800!important;
        transform:none!important;
      }

      body.limited-deployment-mode #topNav .nav-item.active,
      body.limited-deployment-mode #bottomNav .nav-item.active {
        width:calc(100% - 24px)!important;
        margin:0 12px!important;
        padding:0 8px!important;
        background:transparent!important;
        border:0!important;
        border-radius:0!important;
        box-shadow:none!important;
        color:#ffffff!important;
        font-size:13px!important;
        font-weight:600!important;
        transform:none!important;
      }

      body.limited-deployment-mode #topNav .nav-item.active:hover,
      body.limited-deployment-mode #bottomNav .nav-item.active:hover {
        font-size:17px!important;
        font-weight:800!important;
      }

      body.limited-deployment-mode #topNav .local-board-subgroup > .nav-item.local-board-sub-item {
        width:calc(100% - 38px)!important;
        height:30px!important;
        margin:1px 14px 1px 24px!important;
        padding:0 6px!important;
        border:0!important;
        border-radius:0!important;
        background:transparent!important;
        box-shadow:none!important;
        color:#ffffff!important;
        font-size:12px!important;
        font-weight:500!important;
      }

      body.limited-deployment-mode #topNav .local-board-subgroup > .nav-item.local-board-sub-item:hover {
        font-size:16px!important;
        font-weight:800!important;
      }
    `;
    document.head.appendChild(style);
  }

  applyMenuTextPresentation();
}

function applyMenuTextPresentation() {
  document.querySelectorAll("#topNav .nav-item, #bottomNav .nav-item").forEach(button => {
    button.style.setProperty("background", "transparent", "important");
    button.style.setProperty("border-color", "transparent", "important");
    button.style.setProperty("box-shadow", "none", "important");
    button.style.setProperty("color", "#ffffff", "important");
  });
}

installMenuTextStyle();

window.addEventListener("local-shared-pages-loaded", () => {
  queueMicrotask(applyMenuTextPresentation);
  setTimeout(applyMenuTextPresentation, 0);
});

[100, 300, 800, 1600].forEach(delay => setTimeout(applyMenuTextPresentation, delay));
