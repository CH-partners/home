import "./sharedPagesLocal.js";
import "./noticeLocalAdmin.js";
import "./menuRollout.js";
import "./menuAdminUnified.js";
import "./menuPillStyle.js";
import "./menuDivider.js";
import "./sidebarSession.js";

const ALLOWED_PANEL_INDEXES = new Set([0, 10, 11, 13]);
const ALLOWED_LABELS = new Set(["청현공지사항", "공지사항", "일반게시판", "소액조회", "분배표", "그룹리뷰"]);
const WORKER_ALLOCATION_NOTICE = "조회 전용입니다. 분배표 수정은 관리자만 가능합니다.";
let scheduleReady = false;

function normalizeLabel(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[📊📝📢]/g, "")
    .trim();
}

function isAllowedPanel(panel) {
  const index = Number(panel?.dataset?.index);
  if (ALLOWED_PANEL_INDEXES.has(index)) return true;
  if (index === 12 && scheduleReady) return true;
  if (panel?.dataset?.localSharedPublicReady === "1") return true;
  const title = normalizeLabel(panel?.querySelector?.(".sheet-header h1")?.textContent || "");
  return title === "일반게시판";
}

function isAllowedNavItem(node) {
  if (node?.dataset?.localSharedPublic === "1") return true;
  const label = normalizeLabel(node?.textContent);
  if (label === "스케줄") return scheduleReady;
  return ALLOWED_LABELS.has(label);
}

export function installLimitedDeploymentMode() {
  if (window.__limitedDeploymentModeInstalled) return;
  window.__limitedDeploymentModeInstalled = true;

  let sidebarUserSyncing = false;
  let lastSidebarUserSync = 0;
  let scheduleStatusSyncing = false;

  function ensureLimitedStyles() {
    if (document.getElementById("limited-deployment-styles")) return;
    const style = document.createElement("style");
    style.id = "limited-deployment-styles";
    style.textContent = `
      #workAllocationBody tr.allocation-row-inactive td,
      #workAllocationBody tr.allocation-row-inactive input {
        background:#f1f5f9!important;
        color:#94a3b8!important;
      }
      #workAllocationBody tr.allocation-row-inactive td {
        opacity:.68;
      }
      #workAllocationBody .allocation-inactive-label {
        display:inline-flex;
        align-items:center;
        margin-left:6px;
        padding:2px 6px;
        border-radius:999px;
        border:1px solid #cbd5e1;
        background:#e2e8f0;
        color:#64748b;
        font-size:10px;
        font-weight:700;
      }

      body.limited-deployment-mode .sidebar,
      body.limited-deployment-mode .sidebar-content,
      body.limited-deployment-mode #topNav,
      body.limited-deployment-mode #bottomNav {
        min-width:0!important;
        max-width:100%!important;
        overflow-x:hidden!important;
      }
      body.limited-deployment-mode .sidebar-content {
        padding-right:18px!important;
      }
      body.limited-deployment-mode #topNav {
        gap:2px!important;
      }

      body.limited-deployment-mode #topNav .nav-item,
      body.limited-deployment-mode #bottomNav .nav-item,
      body.limited-deployment-mode #topNav .nav-group-toggle,
      body.limited-deployment-mode #topNav [data-authoritative-group] {
        width:calc(100% - 24px)!important;
        min-width:0!important;
        max-width:calc(100% - 24px)!important;
        height:36px!important;
        margin:0 12px!important;
        padding:0 8px!important;
        justify-content:flex-start!important;
        text-align:left!important;
        border:0!important;
        border-right:0!important;
        border-radius:0!important;
        background:transparent!important;
        background-image:none!important;
        color:#e8eef8!important;
        box-shadow:none!important;
        outline:none!important;
        appearance:none!important;
        -webkit-appearance:none!important;
        font-size:13px!important;
        font-weight:500!important;
        line-height:1.2!important;
        transform:none!important;
        transition:font-size .12s ease,font-weight .12s ease,opacity .12s ease!important;
      }

      body.limited-deployment-mode #topNav .nav-item:hover,
      body.limited-deployment-mode #bottomNav .nav-item:hover,
      body.limited-deployment-mode #topNav .nav-item.active,
      body.limited-deployment-mode #bottomNav .nav-item.active,
      body.limited-deployment-mode #topNav .nav-group-toggle:hover,
      body.limited-deployment-mode #topNav .nav-group-toggle.expanded,
      body.limited-deployment-mode #topNav .nav-group-toggle:active,
      body.limited-deployment-mode #topNav .nav-group-toggle:focus,
      body.limited-deployment-mode #topNav .nav-group-toggle:focus-visible,
      body.limited-deployment-mode #topNav [data-authoritative-group]:hover,
      body.limited-deployment-mode #topNav [data-authoritative-group].expanded,
      body.limited-deployment-mode #topNav [data-authoritative-group]:active,
      body.limited-deployment-mode #topNav [data-authoritative-group]:focus,
      body.limited-deployment-mode #topNav [data-authoritative-group]:focus-visible {
        width:calc(100% - 24px)!important;
        margin:0 12px!important;
        padding:0 8px!important;
        border:0!important;
        border-radius:0!important;
        background:transparent!important;
        background-image:none!important;
        color:inherit!important;
        box-shadow:none!important;
        outline:none!important;
        transform:none!important;
      }

      body.limited-deployment-mode #topNav .nav-item:hover,
      body.limited-deployment-mode #bottomNav .nav-item:hover,
      body.limited-deployment-mode #topNav .nav-group-toggle:hover,
      body.limited-deployment-mode #topNav [data-authoritative-group]:hover {
        font-size:calc(13px + 2pt)!important;
        font-weight:800!important;
      }

      body.limited-deployment-mode #topNav .nav-item.active,
      body.limited-deployment-mode #bottomNav .nav-item.active {
        font-size:13px!important;
        font-weight:600!important;
        position:static!important;
        z-index:auto!important;
      }

      body.limited-deployment-mode #topNav .local-board-subgroup,
      body.limited-deployment-mode #topNav .nav-sub-group,
      body.limited-deployment-mode #topNav [data-authoritative-group-wrap] {
        width:100%!important;
        max-width:100%!important;
        margin:0!important;
        padding:0!important;
        border:0!important;
        border-radius:0!important;
        background:transparent!important;
        background-image:none!important;
        box-shadow:none!important;
        overflow-x:hidden!important;
      }

      body.limited-deployment-mode #topNav .local-board-subgroup > .nav-item.local-board-sub-item,
      body.limited-deployment-mode #topNav .nav-sub-group > .nav-item {
        width:calc(100% - 38px)!important;
        min-width:0!important;
        max-width:calc(100% - 38px)!important;
        height:30px!important;
        margin:1px 14px 1px 24px!important;
        padding:0 6px!important;
        border:0!important;
        border-radius:0!important;
        background:transparent!important;
        background-image:none!important;
        box-shadow:none!important;
        outline:none!important;
        font-size:12px!important;
        font-weight:500!important;
        transform:none!important;
      }

      body.limited-deployment-mode #topNav .local-board-subgroup > .nav-item.local-board-sub-item:hover,
      body.limited-deployment-mode #topNav .nav-sub-group > .nav-item:hover {
        background:transparent!important;
        border:0!important;
        box-shadow:none!important;
        font-size:calc(12px + 2pt)!important;
        font-weight:800!important;
        transform:none!important;
      }

      body.limited-deployment-mode #topNav .nav-item::before,
      body.limited-deployment-mode #topNav .nav-item::after,
      body.limited-deployment-mode #bottomNav .nav-item::before,
      body.limited-deployment-mode #bottomNav .nav-item::after,
      body.limited-deployment-mode #topNav .nav-group-toggle::before,
      body.limited-deployment-mode #topNav .nav-group-toggle::after,
      body.limited-deployment-mode #topNav [data-authoritative-group]::before,
      body.limited-deployment-mode #topNav [data-authoritative-group]::after {
        border:0!important;
        background:transparent!important;
        background-image:none!important;
        box-shadow:none!important;
      }

      #limitedLoginBox {
        display:none;
        flex-shrink:0;
        min-height:34px;
        margin:5px 16px 10px;
        padding:4px 8px;
        border:1px solid rgba(0,0,0,.14);
        border-radius:8px;
        background:#ece2a1;
        color:#111111;
        box-shadow:none;
        overflow:hidden;
      }
      #limitedLoginBox.visible {
        display:flex;
        align-items:center;
      }
      #limitedLoginBox .limited-login-line {
        width:100%;
        min-width:0;
        display:flex;
        align-items:center;
        gap:6px;
        white-space:nowrap;
      }
      #limitedLoginBox .limited-login-name {
        min-width:0;
        overflow:hidden;
        text-overflow:ellipsis;
        color:#111111;
        font-size:11px;
        font-weight:800;
        line-height:1.2;
      }
      #limitedLoginBox .limited-login-role {
        flex:0 1 auto;
        margin:0;
        padding:0;
        border:0;
        border-radius:0;
        background:transparent;
        color:#475569;
        font-size:9px;
        font-weight:700;
      }
      #limitedLoginBox .limited-login-caption,
      #limitedLoginBox .limited-login-icon {
        display:none!important;
      }

      #groupReviewBody .grv2 th:last-child,
      #groupReviewBody .grv2 td:last-child {
        width:58px!important;
        min-width:58px!important;
        max-width:58px!important;
      }
      #groupReviewBody .grv2 td:last-child {
        text-align:center!important;
        vertical-align:middle!important;
      }
      #groupReviewBody .grv2-approve {
        display:inline-flex!important;
        align-items:center!important;
        justify-content:center!important;
        margin:4px auto!important;
        padding:0 7px!important;
      }
      #groupReviewBody .grv2-del {
        display:block!important;
        width:30px!important;
        min-width:30px!important;
        margin:0 auto!important;
        padding:0!important;
      }
      #groupReviewBody .grv2-approved {
        padding-left:2px!important;
        padding-right:2px!important;
        text-align:center!important;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureLoginBox() {
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar) return null;

    let box = document.getElementById("limitedLoginBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "limitedLoginBox";
      sidebar.appendChild(box);
    }
    return box;
  }

  function renderLoginBox(user) {
    const box = ensureLoginBox();
    if (!box) return;
    if (!user) return;

    const nameEl = box.querySelector(".limited-login-name");
    const roleEl = box.querySelector(".limited-login-role");
    if (nameEl) nameEl.textContent = user.display_name || user.login_id || "";
    if (roleEl) roleEl.textContent = user.role === "ADMIN" ? "관리자" : user.role === "WORKER" ? "작업자" : String(user.role || "");
    box.classList.add("visible");
  }

  async function syncSidebarLogin(force = false) {
    const now = Date.now();
    if (sidebarUserSyncing || (!force && now - lastSidebarUserSync < 1200)) return;
    sidebarUserSyncing = true;
    lastSidebarUserSync = now;
    try {
      const response = await fetch("/api/v1/auth/me", { credentials: "include" });
      if (response.status === 401) return;
      if (!response.ok) return;
      renderLoginBox(await response.json());
    } catch (_) {
    } finally {
      sidebarUserSyncing = false;
    }
  }

  async function syncScheduleReadiness() {
    if (scheduleStatusSyncing) return;
    scheduleStatusSyncing = true;
    try {
      const response = await fetch("/api/v1/schedules/status", { credentials: "include" });
      if (response.status === 401) {
        scheduleReady = false;
        return;
      }
      if (!response.ok) return;
      const status = await response.json();
      scheduleReady = status?.migration_complete === true;
    } catch (_) {
      scheduleReady = false;
    } finally {
      scheduleStatusSyncing = false;
    }
  }

  function applyDeploymentMode() {
    ensureLimitedStyles();
    document.body.classList.add("limited-deployment-mode");
    ensureLoginBox();
    void syncSidebarLogin();

    const adminBox = document.querySelector(".admin-box");
    if (adminBox) adminBox.style.display = "none";

    document.querySelectorAll(".sheet-panel").forEach(panel => {
      if (!isAllowedPanel(panel)) {
        panel.style.display = "none";
        panel.classList.remove("active");
      } else {
        panel.style.display = "";
      }
    });

    document.querySelectorAll("#topNav .nav-item, #bottomNav .nav-item, #topNav .nav-group-toggle, #topNav .nav-sub-group, #topNav .nav-divider, #bottomNav .nav-divider").forEach(node => {
      if (node.classList.contains("nav-item")) {
        const label = normalizeLabel(node.textContent);
        node.style.display = isAllowedNavItem(node) ? "" : "none";
        if (label === "분배표" && !node.dataset.allocationV2RefreshBound) {
          node.dataset.allocationV2RefreshBound = "1";
          node.addEventListener("click", () => setTimeout(() => window.allocationApi?.refresh?.(), 0));
        }
        if (label === "스케줄" && !node.dataset.localScheduleRefreshBound) {
          node.dataset.localScheduleRefreshBound = "1";
          node.addEventListener("click", () => setTimeout(() => window.scheduleApi?.refresh?.(), 0));
        }
      } else {
        node.style.display = "none";
      }
    });

    document.querySelectorAll("#workAllocationBody .work-info").forEach(info => {
      if (info.textContent?.trim() === WORKER_ALLOCATION_NOTICE) info.remove();
    });

    const active = document.querySelector(".sheet-panel.active");
    if (!isAllowedPanel(active)) {
      const allocationButton = Array.from(document.querySelectorAll(".nav-item"))
        .find(button => normalizeLabel(button.textContent) === "분배표");
      allocationButton?.click();
    }
  }

  void syncScheduleReadiness().finally(applyDeploymentMode);
  setTimeout(() => void syncScheduleReadiness().finally(applyDeploymentMode), 500);
  setTimeout(applyDeploymentMode, 1200);

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("#sidebarLoginOpenBtn, #sidebarLoginSubmitBtn, #sidebarLogoutBtn")) {
      setTimeout(() => {
        void syncSidebarLogin(true);
        applyDeploymentMode();
      }, 150);
    }
  }, true);

  const observer = new MutationObserver(() => {
    clearTimeout(observerTimer);
    observerTimer = setTimeout(applyDeploymentMode, 30);
  });
  const sidebar = document.querySelector(".sidebar");
  const main = document.querySelector(".main");
  if (sidebar) observer.observe(sidebar, { childList: true, subtree: true });
  if (main) observer.observe(main, { childList: true, subtree: true });
}

let observerTimer = null;
installLimitedDeploymentMode();
