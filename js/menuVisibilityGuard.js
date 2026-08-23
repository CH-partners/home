function applyHiddenMenuState(snapshot) {
  const menus = Array.isArray(snapshot?.menus) ? snapshot.menus : [];

  for (const menu of menus) {
    const panelIndex = Number(menu?.panelIndex);
    if (!Number.isFinite(panelIndex)) continue;
    const hidden = Boolean(menu?.hidden);

    const panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);
    if (panel) {
      panel.classList.toggle("local-menu-hidden", hidden);
      if (hidden) panel.classList.remove("active");
    }

    document.querySelectorAll(`.nav-item[data-local-shared-panel-index="${panelIndex}"]`).forEach(button => {
      button.classList.toggle("local-menu-hidden", hidden);
    });
  }
}

function ensureStyles() {
  if (document.getElementById("local-menu-visibility-guard-styles")) return;
  const style = document.createElement("style");
  style.id = "local-menu-visibility-guard-styles";
  style.textContent = `
    .local-menu-hidden{display:none!important}
  `;
  document.head.appendChild(style);
}

ensureStyles();
window.addEventListener("local-shared-pages-loaded", event => {
  if (event?.detail) applyHiddenMenuState(event.detail);
});
