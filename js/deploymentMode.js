const ALLOWED_PANEL_INDEXES = new Set([11, 13]);
const ALLOWED_LABELS = new Set(["분배표", "그룹리뷰"]);
const WORKER_ALLOCATION_NOTICE = "조회 전용입니다. 분배표 수정은 관리자만 가능합니다.";

function normalizeLabel(value) {
  return String(value || "").replace(/\s+/g, "").replace(/[📊📝]/g, "").trim();
}

export function installLimitedDeploymentMode() {
  if (window.__limitedDeploymentModeInstalled) return;
  window.__limitedDeploymentModeInstalled = true;

  let sidebarUserSyncing = false;
  let lastSidebarUserSync = 0;

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

      body.limited-deployment-mode .sidebar-content {
        padding-right:0;
      }
      body.limited-deployment-mode #topNav {
        gap:7px;
      }
      body.limited-deployment-mode #topNav > .nav-item,
      body.limited-deployment-mode #topNav > div > .nav-item,
      body.limited-deployment-mode #bottomNav > .nav-item {
        width:calc(100% - 12px)!important;
        min-width:0!important;
        height:44px!important;
        margin:0 0 0 12px!important;
        padding:0 16px!important;
        justify-content:flex-start!important;
        text-align:left!important;
        border:1px solid rgba(255,255,255,.28)!important;
        border-right:0!important;
        border-radius:12px 0 0 12px!important;
        background:rgba(255,255,255,.08)!important;
        color:#e8eef8!important;
        font-size:13px!important;
        font-weight:700!important;
        box-shadow:none!important;
        transition:all .15s ease!important;
      }
      body.limited-deployment-mode #topNav > .nav-item:hover,
      body.limited-deployment-mode #topNav > div > .nav-item:hover,
      body.limited-deployment-mode #bottomNav > .nav-item:hover {
        background:rgba(255,255,255,.16)!important;
        color:#ffffff!important;
        transform:translateX(3px);
      }
      body.limited-deployment-mode #topNav > .nav-item.active,
      body.limited-deployment-mode #topNav > div > .nav-item.active,
      body.limited-deployment-mode #bottomNav > .nav-item.active {
        width:100%!important;
        margin-left:12px!important;
        padding-left:18px!important;
        background:#f7f9fc!important;
        border-color:#f7f9fc!important;
        color:#1f4e79!important;
        font-size:14px!important;
        font-weight:900!important;
        transform:none!important;
        position:relative;
        z-index:2;
        box-shadow:-4px 0 14px rgba(15,23,42,.12)!important;
      }

      #limitedLoginBox {
        display:none;
        flex-shrink:0;
        min-height:48px;
        margin:10px 16px 18px;
        padding:7px 10px;
        border:1px solid rgba(255,255,255,.20);
        border-radius:10px;
        background:#ece2a1;
        color:#ffffff;
        box-shadow:0 5px 14px rgba(0,0,0,.12);
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
        gap:7px;
        white-space:nowrap;
      }
      #limitedLoginBox .limited-login-caption {
        flex:0 0 auto;
        display:inline-flex;
        align-items:center;
        height:23px;
        padding:0 7px;
        border:1px solid rgba(255,255,255,.30);
        border-radius:999px;
        background:rgba(31,78,121,.48);
        color:#ffffff;
        font-size:9px;
        font-weight:900;
        letter-spacing:.04em;
      }
      #limitedLoginBox .limited-login-icon {
        flex:0 0 auto;
        font-size:14px;
        line-height:1;
      }
      #limitedLoginBox .limited-login-name {
        min-width:0;
        overflow:hidden;
        text-overflow:ellipsis;
        color:#ffffff;
        font-size:13px;
        font-weight:900;
        line-height:1.2;
      }
      #limitedLoginBox .limited-login-role {
        flex:0 0 auto;
        margin-left:auto;
        padding:2px 6px;
        border-radius:999px;
        background:rgba(255,255,255,.14);
        color:#eaf0f6;
        font-size:9px;
        font-weight:800;
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
      box.innerHTML = `
        <div class="limited-login-line">
          <span class="limited-login-caption">LOGIN</span>
          <span class="limited-login-icon">👤</span>
          <span class="limited-login-name"></span>
          <span class="limited-login-role"></span>
        </div>
      `;
      sidebar.appendChild(box);
    }
    return box;
  }

  function renderLoginBox(user) {
    const box = ensureLoginBox();
    if (!box) return;
    if (!user) {
      box.classList.remove("visible");
      return;
    }

    const name = user.display_name || user.login_id || "";
    const role = user.role === "ADMIN" ? "관리자" : user.role === "WORKER" ? "작업자" : String(user.role || "");
    const nameEl = box.querySelector(".limited-login-name");
    const roleEl = box.querySelector(".limited-login-role");
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = role;
    box.classList.add("visible");
  }

  async function syncSidebarLogin(force = false) {
    const now = Date.now();
    if (sidebarUserSyncing || (!force && now - lastSidebarUserSync < 1200)) return;
    sidebarUserSyncing = true;
    lastSidebarUserSync = now;
    try {
      const response = await fetch("/api/v1/auth/me", { credentials: "include" });
      if (response.status === 401) {
        renderLoginBox(null);
        return;
      }
      if (!response.ok) return;
      renderLoginBox(await response.json());
    } catch (_) {
      // 사이드바 로그인 표시는 부가 UI이므로 본문 동작은 유지한다.
    } finally {
      sidebarUserSyncing = false;
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
      const index = Number(panel.dataset.index);
      if (Number.isFinite(index) && !ALLOWED_PANEL_INDEXES.has(index)) {
        panel.style.display = "none";
        panel.classList.remove("active");
      } else if (ALLOWED_PANEL_INDEXES.has(index)) {
        panel.style.display = "";
      }
    });

    document.querySelectorAll("#topNav .nav-item, #bottomNav .nav-item, #topNav .nav-group-toggle, #topNav .nav-sub-group, #topNav .nav-divider, #bottomNav .nav-divider").forEach(node => {
      if (node.classList.contains("nav-item")) {
        const label = normalizeLabel(node.textContent);
        node.style.display = ALLOWED_LABELS.has(label) ? "" : "none";
        if (label === "분배표" && !node.dataset.allocationV2RefreshBound) {
          node.dataset.allocationV2RefreshBound = "1";
          node.addEventListener("click", () => setTimeout(() => window.allocationApi?.refresh?.(), 0));
        }
      } else {
        node.style.display = "none";
      }
    });

    document.querySelectorAll("#workAllocationBody .work-info").forEach(info => {
      if (info.textContent?.trim() === WORKER_ALLOCATION_NOTICE) info.remove();
    });

    const active = document.querySelector(".sheet-panel.active");
    const activeIndex = Number(active?.dataset?.index);
    if (!ALLOWED_PANEL_INDEXES.has(activeIndex)) {
      const allocationButton = Array.from(document.querySelectorAll(".nav-item"))
        .find(button => normalizeLabel(button.textContent) === "분배표");
      if (allocationButton) allocationButton.click();
      else {
        document.querySelector('.sheet-panel[data-index="11"]')?.classList.add("active");
        window.allocationApi?.refresh?.();
      }
    }
  }

  let timer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(applyDeploymentMode, 20);
  });

  document.addEventListener("submit", event => {
    if (event.target?.matches?.("#grv2LoginForm,#allocationLoginForm")) {
      setTimeout(() => void syncSidebarLogin(true), 250);
      setTimeout(() => void syncSidebarLogin(true), 900);
    }
  }, true);

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("#grv2Logout")) {
      setTimeout(() => void syncSidebarLogin(true), 250);
    }
  }, true);

  applyDeploymentMode();
  observer.observe(document.body, { childList: true, subtree: true });
  [100, 300, 700, 1200].forEach(delay => setTimeout(applyDeploymentMode, delay));
}
