const API_ROOT = "/api/v1";

let currentUser = null;
let syncing = false;

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json; charset=utf-8";
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers,
    credentials: "include"
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.detail || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function ensureStyles() {
  if (document.getElementById("sidebar-session-styles")) return;
  const style = document.createElement("style");
  style.id = "sidebar-session-styles";
  style.textContent = `
    #limitedLoginBox{
      display:flex!important;
      flex-direction:column!important;
      align-items:stretch!important;
      gap:4px!important;
      min-height:34px!important;
      margin:5px 16px 10px!important;
      padding:4px 8px!important;
      overflow:hidden!important;
    }
    #limitedLoginBox .limited-login-line{
      display:flex!important;
      align-items:center!important;
      gap:6px!important;
      min-height:26px!important;
      width:100%!important;
      min-width:0!important;
    }
    #limitedLoginBox .limited-login-caption,
    #limitedLoginBox .limited-login-icon{display:none!important}
    #limitedLoginBox .limited-login-name{
      flex:1 1 auto!important;
      min-width:0!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
      font-size:11px!important;
      font-weight:800!important;
    }
    #limitedLoginBox .limited-login-role{
      flex:0 0 auto!important;
      margin:0!important;
      padding:0!important;
      border:0!important;
      border-radius:0!important;
      background:transparent!important;
      font-size:9px!important;
      font-weight:700!important;
    }
    #limitedLoginBox .sidebar-session-actions{
      display:flex!important;
      flex:0 0 auto!important;
      gap:4px!important;
      width:auto!important;
      margin-left:auto!important;
    }
    #limitedLoginBox .sidebar-session-btn{
      height:24px!important;
      padding:0 8px!important;
      border:1px solid rgba(0,0,0,.20)!important;
      border-radius:6px!important;
      background:rgba(255,255,255,.48)!important;
      color:#111!important;
      font-size:9px!important;
      font-weight:900!important;
      cursor:pointer!important;
      white-space:nowrap!important;
    }
    #limitedLoginBox .sidebar-session-btn.primary{
      background:#1f4e79!important;
      color:#fff!important;
      border-color:#1f4e79!important;
    }
    #limitedLoginBox .sidebar-session-form{
      display:grid!important;
      grid-template-columns:1fr!important;
      gap:4px!important;
      width:100%!important;
      margin-top:2px!important;
    }
    #limitedLoginBox .sidebar-session-form[hidden]{display:none!important}
    #limitedLoginBox .sidebar-session-input{
      width:100%!important;
      height:27px!important;
      box-sizing:border-box!important;
      padding:0 8px!important;
      border:1px solid rgba(0,0,0,.22)!important;
      border-radius:6px!important;
      background:#fff!important;
      color:#111!important;
      font-size:10px!important;
    }
    #limitedLoginBox .sidebar-session-error{
      min-height:0!important;
      color:#b91c1c!important;
      font-size:9px!important;
      font-weight:700!important;
      white-space:normal!important;
    }
  `;
  document.head.appendChild(style);
}

function ensureBox() {
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

function render() {
  ensureStyles();
  const box = ensureBox();
  if (!box) return;
  box.classList.add("visible");

  if (currentUser) {
    const role = currentUser.role === "ADMIN" ? "관리자" : currentUser.role === "WORKER" ? "작업자" : String(currentUser.role || "");
    box.innerHTML = `
      <div class="limited-login-line">
        <span class="limited-login-name"></span>
        <span class="limited-login-role"></span>
        <div class="sidebar-session-actions">
          <button type="button" class="sidebar-session-btn" id="sidebarLogoutBtn">로그아웃</button>
        </div>
      </div>`;
    box.querySelector(".limited-login-name").textContent = currentUser.display_name || currentUser.login_id || "";
    box.querySelector(".limited-login-role").textContent = role;
    document.getElementById("sidebarLogoutBtn")?.addEventListener("click", logout);
    return;
  }

  box.innerHTML = `
    <div class="limited-login-line">
      <span class="limited-login-name">로그인 전</span>
      <div class="sidebar-session-actions">
        <button type="button" class="sidebar-session-btn primary" id="sidebarLoginOpenBtn">로그인</button>
      </div>
    </div>
    <form class="sidebar-session-form" id="sidebarLoginForm" hidden>
      <input class="sidebar-session-input" id="sidebarLoginId" autocomplete="username" placeholder="아이디" required>
      <input class="sidebar-session-input" id="sidebarPassword" type="password" autocomplete="current-password" placeholder="비밀번호" required>
      <button type="submit" class="sidebar-session-btn primary">로그인</button>
      <div class="sidebar-session-error" id="sidebarLoginError"></div>
    </form>`;

  document.getElementById("sidebarLoginOpenBtn")?.addEventListener("click", () => {
    const form = document.getElementById("sidebarLoginForm");
    if (!form) return;
    form.hidden = !form.hidden;
    if (!form.hidden) document.getElementById("sidebarLoginId")?.focus();
  });
  document.getElementById("sidebarLoginForm")?.addEventListener("submit", login);
}

async function login(event) {
  event?.preventDefault?.();
  const errorEl = document.getElementById("sidebarLoginError");
  if (errorEl) errorEl.textContent = "";
  const loginId = document.getElementById("sidebarLoginId")?.value?.trim() || "";
  const password = document.getElementById("sidebarPassword")?.value || "";
  if (!loginId || !password) return;
  try {
    await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ login_id: loginId, password })
    });
    location.reload();
  } catch (error) {
    if (errorEl) errorEl.textContent = error.message || "로그인에 실패했습니다.";
  }
}

async function logout() {
  try { await request("/auth/logout", { method: "POST" }); }
  catch (_) {}
  location.reload();
}

function markSchedulePublic() {
  const panel = document.querySelector('.sheet-panel[data-index="12"]');
  if (panel) panel.dataset.localSharedPublicReady = "1";

  const buttons = Array.from(document.querySelectorAll("#topNav .nav-item, #bottomNav .nav-item"));
  const schedule = buttons.find(button => String(button.textContent || "").replace(/\s+/g, "").includes("스케줄"));
  if (schedule) {
    schedule.dataset.localSharedPublic = "1";
    schedule.style.display = "";
  }
}

async function syncPublicMenu() {
  try {
    const snapshot = await request("/shared-pages/public-menu");
    window.dispatchEvent(new CustomEvent("local-shared-pages-loaded", {
      detail: { menus: snapshot?.menus || [], notice: {}, page_contents: {} }
    }));
    markSchedulePublic();
  } catch (error) {
    console.error("공개 메뉴 설정 불러오기 실패:", error);
  }
}

async function syncSession() {
  if (syncing) return;
  syncing = true;
  try {
    try { currentUser = await request("/auth/me"); }
    catch (error) { if (error.status === 401) currentUser = null; else throw error; }
    render();
    if (!currentUser) await syncPublicMenu();
    markSchedulePublic();
  } finally {
    syncing = false;
  }
}

window.addEventListener("local-shared-pages-loaded", markSchedulePublic);
[0, 250, 800, 1600].forEach(delay => setTimeout(() => {
  markSchedulePublic();
  if (delay === 0) void syncSession();
}, delay));
