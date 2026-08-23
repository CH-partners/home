const LOCAL_TOOLS = [
  {
    key: "small-deposit",
    title: "소액조회",
    panelIndex: 1000,
    src: "/tools/small-deposit"
  },
  {
    key: "rent-trades",
    title: "전월세실거래가조회",
    panelIndex: 1003,
    src: "/tools/rent-trades"
  },
  {
    key: "priority-wage",
    title: "최우선임금 계산기",
    panelIndex: 1001,
    src: "/tools/priority-wage"
  },
  {
    key: "mortgage-extract",
    title: "근저당추출",
    panelIndex: 1002,
    src: "/tools/mortgage-extract"
  }
];

function showPanel(panelIndex, button) {
  document.querySelectorAll(".sheet-panel").forEach(panel => panel.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));

  const panel = document.querySelector(`.sheet-panel[data-index="${panelIndex}"]`);
  panel?.classList.add("active");
  button?.classList.add("active");
}

function ensureStyles() {
  if (document.getElementById("local-tools-styles")) return;
  const style = document.createElement("style");
  style.id = "local-tools-styles";
  style.textContent = `
    .local-tool-panel {
      padding:0!important;
      overflow:hidden;
      background:#f8fafc;
    }
    .local-tool-frame {
      display:block;
      width:100%;
      height:calc(100vh - 24px);
      min-height:720px;
      border:0;
      background:#fff;
    }
  `;
  document.head.appendChild(style);
}

function ensureTool(tool) {
  const main = document.querySelector(".main");
  const topNav = document.getElementById("topNav");
  if (!main || !topNav) return;

  let panel = document.querySelector(`.sheet-panel[data-local-tool="${tool.key}"]`);
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "sheet-panel local-tool-panel";
    panel.dataset.index = String(tool.panelIndex);
    panel.dataset.localTool = tool.key;
    panel.dataset.localSharedPublicReady = "1";
    panel.innerHTML = `
      <iframe
        class="local-tool-frame"
        title="${tool.title}"
        src="${tool.src}">
      </iframe>
    `;
    main.appendChild(panel);
  } else {
    const frame = panel.querySelector("iframe");
    if (frame && frame.getAttribute("src") !== tool.src) frame.setAttribute("src", tool.src);
  }

  let button = topNav.querySelector(`.nav-item[data-local-tool="${tool.key}"]`);
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "nav-item";
    button.dataset.localTool = tool.key;
    button.dataset.localSharedPublic = "1";
    button.dataset.localToolPanelIndex = String(tool.panelIndex);
    button.textContent = tool.title;
    button.addEventListener("click", () => showPanel(tool.panelIndex, button));
    topNav.appendChild(button);
  } else {
    button.textContent = tool.title;
    button.style.display = "";
    button.dataset.localSharedPublic = "1";
  }
}

function removeLegacySmallDepositMenu() {
  const topNav = document.getElementById("topNav");
  if (!topNav) return;

  Array.from(topNav.querySelectorAll(":scope > .nav-item")).forEach(button => {
    const label = String(button.textContent || "").replace(/\s+/g, "").trim();
    if (label !== "소액조회") return;
    if (button.dataset.localTool === "small-deposit") return;
    button.style.display = "none";
  });

  const legacyPanel = document.querySelector('.sheet-panel[data-index="10"]');
  if (legacyPanel) {
    legacyPanel.style.display = "none";
    legacyPanel.classList.remove("active");
  }
}

function applyLocalTools() {
  ensureStyles();
  LOCAL_TOOLS.forEach(ensureTool);
  removeLegacySmallDepositMenu();
}

export function installLocalTools() {
  if (window.__localToolsInstalled) return;
  window.__localToolsInstalled = true;

  applyLocalTools();

  let timer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(applyLocalTools, 50);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

installLocalTools();
