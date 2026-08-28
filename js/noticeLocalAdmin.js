import "./localTools.js";

const API_ROOT = "/api/v1";
let currentUser = null;
let saving = false;

async function api(path, options = {}) {
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
  if (document.getElementById("local-notice-admin-styles")) return;
  const style = document.createElement("style");
  style.id = "local-notice-admin-styles";
  style.textContent = `
    body.limited-deployment-mode #noticeEditBtn.local-notice-admin-visible {
      display:inline-flex!important;
    }
  `;
  document.head.appendChild(style);
}

function renderAdminButton() {
  ensureStyles();
  const button = document.getElementById("noticeEditBtn");
  if (!button) return;
  button.classList.toggle("local-notice-admin-visible", currentUser?.role === "ADMIN");
}

function renderNotice(notice) {
  const title = document.getElementById("noticeTitle");
  const date = document.getElementById("noticeDate");
  const items = document.getElementById("noticeItems");
  if (!title || !date || !items) return;

  title.textContent = notice?.title || "공지 제목";
  date.textContent = `기준일: ${notice?.date || "-"}`;
  const html = String(notice?.html || "").trim();
  items.innerHTML = html || "<li>공지 내용이 없습니다.</li>";
}

function editorRoot() {
  return document.querySelector("#noticeEditor .ql-editor");
}

async function openEditor() {
  if (currentUser?.role !== "ADMIN") {
    alert("관리자만 수정할 수 있습니다.");
    return;
  }

  const snapshot = await api("/shared-pages");
  const notice = snapshot?.notice || {};
  const titleInput = document.getElementById("noticeFormTitle");
  const dateInput = document.getElementById("noticeFormDate");
  const editor = editorRoot();
  const modal = document.getElementById("noticeModal");
  if (!titleInput || !dateInput || !editor || !modal) {
    throw new Error("공지 편집기를 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.");
  }

  titleInput.value = String(notice.title || "");
  dateInput.value = String(notice.date || "");
  editor.innerHTML = String(notice.html || "");
  modal.classList.add("show");
}

async function saveNotice() {
  if (saving) return;
  if (currentUser?.role !== "ADMIN") {
    alert("관리자만 수정할 수 있습니다.");
    return;
  }

  const saveButton = document.querySelector("#noticeModal .primary-btn");
  const editor = editorRoot();
  if (!editor) throw new Error("공지 편집기를 찾을 수 없습니다.");

  saving = true;
  const previousText = saveButton?.textContent || "저장";
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "저장 중...";
  }

  try {
    const payload = {
      title: document.getElementById("noticeFormTitle")?.value?.trim() || "공지 제목",
      date: document.getElementById("noticeFormDate")?.value || "",
      html: editor.innerHTML
    };
    const snapshot = await api("/shared-pages/notice", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    renderNotice(snapshot?.notice || payload);
    document.getElementById("noticeModal")?.classList.remove("show");
    window.localSharedPagesApi?.refresh?.();
    alert("공지사항이 저장되었습니다.");
  } finally {
    saving = false;
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = previousText;
    }
  }
}

async function syncUser() {
  try {
    currentUser = await api("/auth/me");
  } catch (error) {
    if (error.status === 401) currentUser = null;
    else throw error;
  }
  renderAdminButton();
}

function bindActions() {
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("#noticeEditBtn")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void openEditor().catch(error => alert(`공지 편집 열기 실패: ${error.message}`));
      return;
    }

    if (target.closest("#noticeModal .primary-btn")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void saveNotice().catch(error => alert(`공지 저장 실패: ${error.message}`));
      return;
    }

    if (target.closest("#noticeModal .secondary-btn")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.getElementById("noticeModal")?.classList.remove("show");
      return;
    }

    if (target.closest("#grv2Logout")) {
      setTimeout(() => void syncUser(), 250);
    }
  }, true);

  document.addEventListener("submit", event => {
    if (event.target?.matches?.("#grv2LoginForm,#allocationLoginForm")) {
      setTimeout(() => void syncUser(), 250);
      setTimeout(() => void syncUser(), 900);
    }
  }, true);
}

export function installLocalNoticeAdmin() {
  if (window.__localNoticeAdminInstalled) return;
  window.__localNoticeAdminInstalled = true;
  bindActions();
  [0, 250, 800, 1600].forEach(delay => {
    setTimeout(() => void syncUser().catch(error => console.error("공지 관리자 상태 확인 실패:", error)), delay);
  });
}

installLocalNoticeAdmin();