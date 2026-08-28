const API_ROOT = "/api/v1";

let currentUser = null;
let syncing = false;
let groupReviewObserver = null;
let groupReviewAuthHint = null;
let heartbeatTimer = null;

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
    body.ch-auth-gated{
      overflow:hidden!important;
    }
    body.ch-auth-gated > .app{
      visibility:hidden!important;
      pointer-events:none!important;
      user-select:none!important;
    }
    #chAuthGate{
      position:fixed!important;
      inset:0!important;
      z-index:2147483000!important;
      display:flex!important;
      align-items:center!important;
      justify-content:center!important;
      box-sizing:border-box!important;
      padding:24px!important;
      background:#f7f8fa!important;
      font-family:"Gmarket Sans","Noto Sans KR",Arial,sans-serif!important;
    }
    #chAuthGate[hidden]{display:none!important}
    #chAuthGate .ch-auth-card{
      width:min(378px,calc(100vw - 40px))!important;
      box-sizing:border-box!important;
      padding:46px 40px 48px!important;
      border:1px solid #e0e4e8!important;
      border-radius:16px!important;
      background:#ffffff!important;
      box-shadow:0 2px 8px rgba(15,23,42,.04)!important;
    }
    #chAuthGate .ch-auth-brand{
      display:flex!important;
      align-items:baseline!important;
      justify-content:center!important;
      gap:7px!important;
      margin:0!important;
      color:#171b20!important;
      white-space:nowrap!important;
    }
    #chAuthGate .ch-auth-brand-prefix{
      font-size:21px!important;
      font-weight:700!important;
      letter-spacing:-1.4px!important;
    }
    #chAuthGate .ch-auth-brand-name{
      font-family:"Noto Serif KR",serif!important;
      font-size:37px!important;
      font-weight:900!important;
      line-height:1!important;
      letter-spacing:-2px!important;
    }
    #chAuthGate .ch-auth-subtitle{
      margin:8px 0 31px!important;
      text-align:center!important;
      color:#9a7b68!important;
      font-size:11px!important;
      font-weight:400!important;
      letter-spacing:.5px!important;
    }
    #chAuthGate .ch-auth-form{
      display:grid!important;
      gap:20px!important;
    }
    #chAuthGate .ch-auth-field{
      display:grid!important;
      gap:7px!important;
    }
    #chAuthGate .ch-auth-label{
      color:#262b30!important;
      font-size:12px!important;
      font-weight:700!important;
      line-height:1.3!important;
    }
    #chAuthGate .ch-auth-input{
      width:100%!important;
      height:46px!important;
      box-sizing:border-box!important;
      padding:0 16px!important;
      border:1px solid #cbd3dc!important;
      border-radius:8px!important;
      outline:none!important;
      background:#ffffff!important;
      color:#1f2937!important;
      font:inherit!important;
      font-size:13px!important;
      transition:border-color .15s ease,box-shadow .15s ease!important;
    }
    #chAuthGate .ch-auth-input::placeholder{
      color:#8d98a6!important;
      opacity:1!important;
    }
    #chAuthGate .ch-auth-input:focus{
      border-color:#7b8794!important;
      box-shadow:0 0 0 3px rgba(31,41,55,.07)!important;
    }
    #chAuthGate .ch-auth-submit{
      width:100%!important;
      height:48px!important;
      margin-top:10px!important;
      border:0!important;
      border-radius:8px!important;
      background:#23272b!important;
      color:#ffffff!important;
      font:inherit!important;
      font-size:14px!important;
      font-weight:700!important;
      cursor:pointer!important;
      transition:background .15s ease,transform .05s ease!important;
    }
    #chAuthGate .ch-auth-submit:hover{background:#15191d!important}
    #chAuthGate .ch-auth-submit:active{transform:translateY(1px)!important}
    #chAuthGate .ch-auth-submit:disabled{
      cursor:wait!important;
      opacity:.7!important;
    }
    #chAuthGate .ch-auth-error{
      min-height:18px!important;
      margin-top:-7px!important;
      color:#b42318!important;
      font-size:11px!important;
      font-weight:600!important;
      line-height:1.45!important;
      text-align:left!important;
    }
    #chAuthGate .ch-auth-checking{
      min-height:18px!important;
      margin-top:-7px!important;
      color:#667085!important;
      font-size:11px!important;
      font-weight:500!important;
      line-height:1.45!important;
      text-align:center!important;
    }
    @media (max-width:520px){
      #chAuthGate{padding:16px!important}
      #chAuthGate .ch-auth-card{
        width:min(378px,calc(100vw - 32px))!important;
        padding:40px 28px 42px!important;
      }
      #chAuthGate .ch-auth-brand-prefix{font-size:19px!important}
      #chAuthGate .ch-auth-brand-name{font-size:34px!important}
    }

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
  `;
  document.head.appendChild(style);
}

function ensureGate() {
  let gate = document.getElementById("chAuthGate");
  if (gate) return gate;

  gate = document.createElement("div");
  gate.id = "chAuthGate";
  gate.setAttribute("role", "dialog");
  gate.setAttribute("aria-modal", "true");
  gate.setAttribute("aria-label", "CH HOME 로그인");
  gate.innerHTML = `
    <section class="ch-auth-card">
      <h1 class="ch-auth-brand">
        <span class="ch-auth-brand-prefix">법무법인</span>
        <span class="ch-auth-brand-name">淸賢</span>
      </h1>
      <p class="ch-auth-subtitle">CH HOME</p>
      <form class="ch-auth-form" id="chAuthForm">
        <label class="ch-auth-field" for="chAuthLoginId">
          <span class="ch-auth-label">아이디</span>
          <input class="ch-auth-input" id="chAuthLoginId" autocomplete="username" placeholder="아이디 입력" required>
        </label>
        <label class="ch-auth-field" for="chAuthPassword">
          <span class="ch-auth-label">비밀번호</span>
          <input class="ch-auth-input" id="chAuthPassword" type="password" autocomplete="current-password" placeholder="비밀번호" required>
        </label>
        <button class="ch-auth-submit" id="chAuthSubmit" type="submit">접속</button>
        <div class="ch-auth-error" id="chAuthError" role="alert" aria-live="polite"></div>
        <div class="ch-auth-checking" id="chAuthChecking">로그인 상태를 확인하고 있습니다.</div>
      </form>
    </section>`;
  document.body.prepend(gate);
  gate.querySelector("#chAuthForm")?.addEventListener("submit", login);
  return gate;
}

function showGate({ checking = false } = {}) {
  ensureStyles();
  const gate = ensureGate();
  gate.hidden = false;
  document.body.classList.add("ch-auth-gated");
  const checkingEl = document.getElementById("chAuthChecking");
  if (checkingEl) checkingEl.hidden = !checking;
  const submit = document.getElementById("chAuthSubmit");
  const loginId = document.getElementById("chAuthLoginId");
  const password = document.getElementById("chAuthPassword");
  if (submit) submit.disabled = checking;
  if (loginId) loginId.disabled = checking;
  if (password) password.disabled = checking;
  if (!checking) setTimeout(() => document.getElementById("chAuthLoginId")?.focus(), 0);
}

function hideGate() {
  const gate = ensureGate();
  gate.hidden = true;
  document.body.classList.remove("ch-auth-gated");
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

  if (!currentUser) {
    box.classList.remove("visible");
    box.replaceChildren();
    return;
  }

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
  box.classList.add("visible");
  document.getElementById("sidebarLogoutBtn")?.addEventListener("click", logout);
}

async function login(event) {
  event?.preventDefault?.();
  const errorEl = document.getElementById("chAuthError");
  const checkingEl = document.getElementById("chAuthChecking");
  const submit = document.getElementById("chAuthSubmit");
  const loginIdEl = document.getElementById("chAuthLoginId");
  const passwordEl = document.getElementById("chAuthPassword");
  if (errorEl) errorEl.textContent = "";
  if (checkingEl) checkingEl.hidden = true;

  const loginId = loginIdEl?.value?.trim() || "";
  const password = passwordEl?.value || "";
  if (!loginId || !password) return;

  if (submit) submit.disabled = true;
  if (loginIdEl) loginIdEl.disabled = true;
  if (passwordEl) passwordEl.disabled = true;
  try {
    await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ login_id: loginId, password })
    });
    location.reload();
  } catch (error) {
    if (errorEl) errorEl.textContent = error.message || "로그인에 실패했습니다.";
    if (submit) submit.disabled = false;
    if (loginIdEl) loginIdEl.disabled = false;
    if (passwordEl) passwordEl.disabled = false;
    passwordEl?.select?.();
    passwordEl?.focus?.();
  }
}

async function logout() {
  try { await request("/auth/logout", { method: "POST" }); }
  catch (_) {}
  location.reload();
}

function stopHeartbeat() {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function sendHeartbeat() {
  if (!currentUser) return;
  try {
    await request("/auth/heartbeat", { method: "POST" });
  } catch (error) {
    if (error.status === 401) {
      stopHeartbeat();
      currentUser = null;
      render();
      showGate();
      location.reload();
    }
  }
}

function syncHeartbeat() {
  stopHeartbeat();
  if (!currentUser) return;
  heartbeatTimer = setInterval(() => void sendHeartbeat(), 60_000);
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

async function syncSession() {
  if (syncing) return;
  syncing = true;
  showGate({ checking: true });
  try {
    try {
      currentUser = await request("/auth/me");
    } catch (error) {
      if (error.status === 401) currentUser = null;
      else throw error;
    }

    render();
    syncHeartbeat();
    markSchedulePublic();

    if (currentUser) hideGate();
    else showGate();
  } catch (error) {
    currentUser = null;
    render();
    showGate();
    const errorEl = document.getElementById("chAuthError");
    if (errorEl) errorEl.textContent = "서버 연결을 확인해주세요.";
  } finally {
    syncing = false;
  }
}

function syncSessionFromGroupReview() {
  const body = document.getElementById("groupReviewBody");
  if (!body) return;

  const nextHint = body.querySelector(".grv2-userbar")
    ? "signed-in"
    : body.querySelector(".grv2-login")
      ? "signed-out"
      : null;

  if (!nextHint || nextHint === groupReviewAuthHint) return;
  groupReviewAuthHint = nextHint;

  const sessionChanged =
    (nextHint === "signed-in" && !currentUser) ||
    (nextHint === "signed-out" && !!currentUser);

  if (sessionChanged) void syncSession();
}

function watchGroupReviewSession() {
  const body = document.getElementById("groupReviewBody");
  if (!body || groupReviewObserver) return;

  groupReviewObserver = new MutationObserver(syncSessionFromGroupReview);
  groupReviewObserver.observe(body, { childList: true, subtree: true });
  syncSessionFromGroupReview();
}

ensureStyles();
showGate({ checking: true });
window.addEventListener("local-shared-pages-loaded", markSchedulePublic);
window.addEventListener("beforeunload", stopHeartbeat);
watchGroupReviewSession();
[0, 250, 800, 1600].forEach(delay => setTimeout(() => {
  markSchedulePublic();
  if (delay === 0) void syncSession();
}, delay));
