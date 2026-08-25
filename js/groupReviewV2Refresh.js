function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function selectedProjectId() {
  return document.querySelector("#groupReviewProjectBadges .grv2-project-badge.active")?.dataset?.projectId || "";
}

function selectedSheetId() {
  return document.querySelector("#groupReviewBody .grv2-tab.active")?.dataset?.sheetId || "";
}

function captureScroll() {
  const grid = document.querySelector("#groupReviewBody .grv2-grid");
  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    gridTop: grid?.scrollTop || 0,
    gridLeft: grid?.scrollLeft || 0
  };
}

function restoreScroll(snapshot) {
  if (!snapshot) return;
  const apply = () => {
    window.scrollTo(snapshot.windowX, snapshot.windowY);
    const grid = document.querySelector("#groupReviewBody .grv2-grid");
    if (grid) {
      grid.scrollTop = snapshot.gridTop;
      grid.scrollLeft = snapshot.gridLeft;
    }
  };
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
}

export function installGroupReviewRefreshV2(groupReviewApi) {
  if (!groupReviewApi?.refresh) return;

  let refreshing = false;

  function ensureStyles() {
    if (document.getElementById("grv2-refresh-fixed-header-style")) return;
    const style = document.createElement("style");
    style.id = "grv2-refresh-fixed-header-style";
    style.textContent = `
      .sheet-panel[data-index="13"] .sheet-header .sheet-tools > #grv2Refresh {
        order: 2;
        flex: 0 0 auto;
        min-height: 34px;
        padding: 0 12px;
        margin: 0;
        color: #334155;
        background: #ffffff;
        border: 1px solid #cbd8e7;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 700;
        line-height: normal;
        white-space: nowrap;
        box-shadow: none;
        cursor: pointer;
      }

      .sheet-panel[data-index="13"] .sheet-header .sheet-tools > #grv2Refresh:hover {
        background: #f8fafc;
      }

      .sheet-panel[data-index="13"] .sheet-header .sheet-tools > #grv2Refresh:disabled {
        opacity: .6;
        cursor: wait;
      }

      .sheet-panel[data-index="13"]:not(:has(#groupReviewBody .grv2-userbar)) .sheet-header #grv2Refresh {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  async function refreshInPlace() {
    if (refreshing) return;
    refreshing = true;

    const projectId = selectedProjectId();
    const sheetId = selectedSheetId();
    const scroll = captureScroll();
    const button = document.getElementById("grv2Refresh");
    if (button) {
      button.disabled = true;
      button.textContent = "↻ 새로고침 중";
    }

    try {
      await groupReviewApi.refresh();

      if (projectId) {
        const currentProjectId = selectedProjectId();
        if (currentProjectId !== projectId) {
          const projectButton = document.querySelector(`#groupReviewProjectBadges .grv2-project-badge[data-project-id="${CSS.escape(projectId)}"]`);
          projectButton?.click();
          await wait(120);
        }
      }

      if (sheetId) {
        const sheetButton = document.querySelector(`#groupReviewBody .grv2-tab[data-sheet-id="${CSS.escape(sheetId)}"]`);
        if (sheetButton && !sheetButton.classList.contains("active")) {
          sheetButton.click();
          await wait(120);
        }
      }

      restoreScroll(scroll);
    } catch (error) {
      console.error("그룹리뷰 새로고침 실패:", error);
      alert("그룹리뷰 새로고침 실패: " + (error?.message || error));
    } finally {
      refreshing = false;
      const currentButton = document.getElementById("grv2Refresh");
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.textContent = "↻ 새로고침";
      }
    }
  }

  function ensureButton() {
    const headerTools = document.querySelector('.sheet-panel[data-index="13"] .sheet-header .sheet-tools');
    if (!headerTools) return null;

    let button = document.getElementById("grv2Refresh");
    if (button) return button;

    button = document.createElement("button");
    button.id = "grv2Refresh";
    button.type = "button";
    button.className = "action-btn grv2-fixed-refresh";
    button.textContent = "↻ 새로고침";
    button.title = "현재 프로젝트와 작업자 탭을 유지한 채 그룹리뷰 데이터만 다시 불러옵니다.";
    button.addEventListener("click", refreshInPlace);
    headerTools.appendChild(button);
    return button;
  }

  ensureStyles();
  ensureButton();

  return {
    refreshInPlace,
    ensureButton
  };
}
