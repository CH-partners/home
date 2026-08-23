function installMenuPillStyle() {
  if (document.getElementById("menu-pill-style")) return;

  const style = document.createElement("style");
  style.id = "menu-pill-style";
  style.textContent = `
    body.limited-deployment-mode #topNav > button.nav-item,
    body.limited-deployment-mode #topNav > div > button.nav-item,
    body.limited-deployment-mode #bottomNav > button.nav-item {
      width:calc(100% - 24px)!important;
      min-width:0!important;
      height:42px!important;
      margin:0 12px!important;
      padding:0 17px!important;
      border:1px solid rgba(255,255,255,.30)!important;
      border-radius:999px!important;
      justify-content:flex-start!important;
      text-align:left!important;
      box-shadow:0 2px 7px rgba(15,23,42,.08)!important;
    }

    body.limited-deployment-mode #topNav > button.nav-item:hover,
    body.limited-deployment-mode #topNav > div > button.nav-item:hover,
    body.limited-deployment-mode #bottomNav > button.nav-item:hover {
      transform:translateX(2px)!important;
      box-shadow:0 4px 10px rgba(15,23,42,.12)!important;
    }

    body.limited-deployment-mode #topNav > button.nav-item.active,
    body.limited-deployment-mode #topNav > div > button.nav-item.active,
    body.limited-deployment-mode #bottomNav > button.nav-item.active {
      width:calc(100% - 24px)!important;
      margin:0 12px!important;
      padding-left:18px!important;
      border-radius:999px!important;
      transform:none!important;
      box-shadow:0 4px 12px rgba(15,23,42,.16)!important;
    }

    body.limited-deployment-mode #topNav .local-board-subgroup > button.nav-item.local-board-sub-item {
      width:calc(100% - 38px)!important;
      height:32px!important;
      margin:2px 14px 2px 24px!important;
      padding:4px 13px!important;
      border:1px solid rgba(255,255,255,.18)!important;
      border-radius:999px!important;
      box-shadow:none!important;
    }

    body.limited-deployment-mode #topNav .local-board-subgroup > button.nav-item.local-board-sub-item.active {
      width:calc(100% - 38px)!important;
      margin:2px 14px 2px 24px!important;
      border-radius:999px!important;
    }
  `;
  document.head.appendChild(style);
}

installMenuPillStyle();
