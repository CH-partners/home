export function installGroupReviewTopShell() {
  if (window.__grv2TopShellInstalled) return;
  window.__grv2TopShellInstalled = true;

  let observer = null;
  let timer = null;

  function ensureStyles() {
    if (document.getElementById("grv2-top-shell-styles")) return;

    const style = document.createElement("style");
    style.id = "grv2-top-shell-styles";
    style.textContent = `
      .sheet-panel[data-index="13"] .grv2-shell-projectbar {
        display: flex;
        align-items: center;
        gap: 14px;
        min-height: 60px;
        padding: 10px 16px;
        margin-bottom: 16px;
        background: #ffffff;
        border: 1px solid #d9e2ef;
        border-radius: 12px;
        box-sizing: border-box;
      }

      .sheet-panel[data-index="13"] .grv2-shell-projectbar > .work-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        box-shadow: none;
      }

      .sheet-panel[data-index="13"] .grv2-shell-projectbar > .work-toolbar button {
        min-height: 34px;
        padding: 0 12px;
        border-radius: 8px;
        font-weight: 700;
        white-space: nowrap;
      }

      .sheet-panel[data-index="13"] .grv2-shell-projectbar > .work-toolbar button[onclick="downloadGroupReviewExcel()"] {
        order: 0;
        color: #ffffff !important;
        background: linear-gradient(135deg, #5b45f5, #4936e8) !important;
        border-color: #5b45f5 !important;
        box-shadow: 0 3px 8px rgba(79, 62, 230, .18);
      }

      .sheet-panel[data-index="13"] .grv2-shell-projectbar > .work-toolbar button[onclick="createGroupReviewProjectPrompt()"] {
        order: 1;
      }

      .sheet-panel[data-index="13"] .grv2-shell-projectbar > .work-toolbar button[onclick="deleteSelectedGroupReviewProject()"] {
        order: 2;
      }

      .sheet-panel[data-index="13"] .grv2-shell-projectbar > .work-toolbar button[onclick="deleteAllGroupReviewProjects()"] {
        order: 3;
      }

      .sheet-panel[data-index="13"] #groupReviewProjectBadges {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        flex: 1 1 auto;
        min-width: 0;
        margin: 0;
        padding: 0;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: thin;
      }

      .sheet-panel[data-index="13"] #groupReviewProjectBadges .grv2-project-badge {
        flex: 0 0 auto;
        min-height: 34px;
        margin: 0 !important;
        padding: 0 14px !important;
        color: #334155;
        background: #f4f7fb !important;
        border: 1px solid #dbe4ef !important;
        border-radius: 8px !important;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        box-shadow: none;
      }

      .sheet-panel[data-index="13"] #groupReviewProjectBadges .grv2-project-badge:hover {
        background: #edf2f8 !important;
        border-color: #c7d4e3 !important;
      }

      .sheet-panel[data-index="13"] #groupReviewProjectBadges .grv2-project-badge.active {
        color: #ffffff !important;
        background: linear-gradient(135deg, #5b45f5, #4936e8) !important;
        border-color: #5b45f5 !important;
        font-weight: 800;
        box-shadow: 0 3px 8px rgba(79, 62, 230, .18);
      }

      #groupReviewBody .grv2-userbar {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
        min-height: 58px;
        margin: 0 0 16px;
        padding: 10px 18px;
        background: #ffffff;
        border: 1px solid #d9e2ef;
        border-radius: 12px;
        box-sizing: border-box;
      }

      #groupReviewBody .grv2-user {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        font-size: 13px;
      }

      #groupReviewBody .grv2-user strong {
        margin: 0;
        color: #0f172a;
        font-weight: 800;
      }

      #groupReviewBody .grv2-role {
        display: none !important;
      }

      #groupReviewBody .grv2-live {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        margin: 0;
        padding: 0 9px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
      }

      #groupReviewBody .grv2-live.on {
        color: #059669 !important;
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
      }

      #groupReviewBody .grv2-live.off {
        color: #b45309 !important;
        background: #fffbeb;
        border: 1px solid #fde68a;
      }

      #groupReviewBody #grv2Refresh,
      #groupReviewBody #grv2Logout {
        min-height: 36px;
        padding: 0 14px;
        color: #334155;
        background: #ffffff;
        border: 1px solid #cbd8e7;
        border-radius: 9px;
        font-weight: 700;
        box-shadow: none;
      }

      #groupReviewBody #grv2Refresh {
        margin-left: auto;
      }

      #groupReviewBody #grv2Refresh ~ #grv2Logout {
        margin-left: 0;
      }

      #groupReviewBody .grv2-project-title {
        display: none !important;
      }

      @media (max-width: 980px) {
        .sheet-panel[data-index="13"] .grv2-shell-projectbar {
          align-items: stretch;
          flex-direction: column;
          gap: 10px;
        }

        .sheet-panel[data-index="13"] #groupReviewProjectBadges {
          justify-content: flex-start;
        }
      }

      @media (max-width: 640px) {
        #groupReviewBody .grv2-userbar {
          flex-wrap: wrap;
        }

        #groupReviewBody #grv2Refresh {
          margin-left: 0;
        }

        #groupReviewBody .grv2-user {
          width: 100%;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function ensureShell() {
    const panel = document.querySelector('.sheet-panel[data-index="13"]');
    const card = panel?.querySelector('.major-card');
    const toolbar = card?.querySelector(':scope > .work-toolbar') || panel?.querySelector('.work-toolbar');
    const badges = document.getElementById('groupReviewProjectBadges');
    if (!card || !toolbar || !badges) return false;

    let shell = document.getElementById('grv2ProjectShell');
    if (!shell) {
      shell = document.createElement('div');
      shell.id = 'grv2ProjectShell';
      shell.className = 'grv2-shell-projectbar';
      card.insertBefore(shell, card.firstChild);
    }

    if (toolbar.parentElement !== shell) shell.appendChild(toolbar);
    if (badges.parentElement !== shell) shell.appendChild(badges);
    return true;
  }

  function decorateDynamicControls() {
    const excel = document.querySelector('.sheet-panel[data-index="13"] button[onclick="downloadGroupReviewExcel()"]');
    if (excel && excel.textContent.trim() === '엑셀 다운로드') excel.textContent = '📊 엑셀 다운로드';

    const logout = document.getElementById('grv2Logout');
    if (logout && logout.textContent !== '로그아웃') logout.textContent = '로그아웃';
  }

  function apply() {
    ensureStyles();
    ensureShell();
    decorateDynamicControls();
  }

  function schedule(delay = 30) {
    clearTimeout(timer);
    timer = setTimeout(apply, delay);
  }

  function start() {
    apply();

    const panel = document.querySelector('.sheet-panel[data-index="13"]');
    if (!panel) {
      setTimeout(start, 100);
      return;
    }

    observer = new MutationObserver(() => schedule());
    observer.observe(panel, { childList: true, subtree: true });
    [0, 100, 300, 700].forEach(delay => setTimeout(() => schedule(0), delay));
  }

  start();

  return {
    refresh: () => schedule(0),
    destroy() {
      clearTimeout(timer);
      observer?.disconnect();
    }
  };
}
