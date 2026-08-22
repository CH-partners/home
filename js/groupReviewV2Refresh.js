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
  let observer = null;

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

      // V2 refresh는 현재 프로젝트를 유지한다. 작업자 탭도 기존 선택을 복원한다.
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
      ensureButton();
    }
  }

  function ensureButton() {
    const userbar = document.querySelector("#groupReviewBody .grv2-userbar");
    const logout = document.getElementById("grv2Logout");
    if (!userbar || !logout || document.getElementById("grv2Refresh")) return;

    const button = document.createElement("button");
    button.id = "grv2Refresh";
    button.type = "button";
    button.className = "grv2-btn";
    button.textContent = refreshing ? "↻ 새로고침 중" : "↻ 새로고침";
    button.disabled = refreshing;
    button.title = "현재 프로젝트와 작업자 탭을 유지한 채 그룹리뷰 데이터만 다시 불러옵니다.";
    button.addEventListener("click", refreshInPlace);
    logout.parentElement?.insertBefore(button, logout);
  }

  const body = document.getElementById("groupReviewBody");
  if (body) {
    observer = new MutationObserver(() => ensureButton());
    observer.observe(body, { childList: true, subtree: true });
  }

  ensureButton();

  return {
    refreshInPlace,
    disconnect() {
      observer?.disconnect();
    }
  };
}
