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
    #limitedLoginBox{display:flex!important;flex-direction:column!important;align-items:stretch!important;gap:7px!important}
    #limitedLoginBox .limited-login-line{display:flex!important;align-items:center!important;gap:7px!important}
    #limitedLoginBox .sidebar-session-actions{display:flex;gap:6px;width:100%}
    #limitedLoginBox .sidebar-session-btn{height:28px;padding:0 10px;border:1px solid rgba(0,0,0,.22);border-radius:999px;background:rgba(255,255,255,.44);color:#111;font-size:10px;font-weight:900;cursor:pointer}
    #limitedLoginBox .sidebar-session-btn.primary{background:#1f4e79;color:#fff;border-color:#1f4e79}
    #limitedLoginBox .sidebar-session-form{display:grid;grid-template-columns:1fr;gap:6px;width:100%}
    #limitedLoginBox .sidebar-session-form[hidden]{display:none!important}
    #limitedLoginBox .sidebar-session-input{width:100%;height:30px;box-sizing:border-box;padding:0 9px;border:1px solid rgba(0,0,0,.24);border-radius:8px;background:#fff;color:#111;font-size:11px}
    #limitedLoginBox .sidebar-session-error{min-height:0;color:#b91c1c;font-size:10px;font-weight:700;white-space:normal}
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

  if (currentUser) {
    const role = currentUser.role === "ADMIN" ? "관리자" : currentUser.role === "WORKER" ? "작업자" : String(currentUser.role || "");
    box.innerHTML = `
      <div class="limited-login-line">
        <span class="limited-login-caption">LOGIN</span>
        <span class="limited-login-icon">👤</span>
        <span class="limited-login-name"></span>
        <span class="limited-login-role"></span>
      </div>
      <div class="sidebar-session-actions">
        <button type="button" class="sidebar-session-btn" id="sidebarLogoutBtn">로그아웃</button>
      </div>`;
    box.querySelector(".limited-login-name").textContent = currentUser.display_name || currentUser.login_id || "";
    box.querySelector(".limited-login-role").textContent = role;
    document.getElementById("sidebarLogoutBtn")?.addEventListener("click", logout);
    return;
  }

  box.innerHTML = `
    <div class="limited-login-line">
      <span class="limited-login-caption">LOGIN</span>
      <span class="limited-login-icon">👤</span>
      <span class="limited-login-name">로그인 전</span>
      <span class="limited-login-role">GUEST</span>
    </div>
    <div class="sidebar-session-actions">
      <button type="button" class="sidebar-session-btn primary" id="sidebarLoginOpenBtn">로그인</button>
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
