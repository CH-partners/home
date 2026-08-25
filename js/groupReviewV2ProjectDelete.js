const API_ROOT = "/api/v1";

async function api(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    credentials: "include",
    headers: { ...(options.headers || {}) }
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`);
  return data;
}

export function installGroupReviewProjectDeleteV2(groupReviewApi) {
  let timer = null;
  let destroyed = false;

  const panel = () => document.querySelector('.sheet-panel[data-index="13"]');
  const activeProjectButton = () => document.querySelector('#groupReviewProjectBadges [data-project-id].active');
  const projectButtons = () => Array.from(document.querySelectorAll('#groupReviewProjectBadges [data-project-id]'));
  const isAdmin = () => document.querySelector('#groupReviewBody .grv2-role')?.textContent?.trim() === 'ADMIN';

  function ensureStyles() {
    if (document.getElementById('grv2-project-header-visibility')) return;
    const style = document.createElement('style');
    style.id = 'grv2-project-header-visibility';
    style.textContent = `
      .sheet-panel[data-index="13"].grv2-admin-mode .grv2-header-toolbar button[onclick="createGroupReviewProjectPrompt()"],
      .sheet-panel[data-index="13"].grv2-admin-mode .grv2-header-toolbar button[onclick="downloadGroupReviewExcel()"],
      .sheet-panel[data-index="13"].grv2-admin-mode .grv2-header-toolbar button[onclick="deleteSelectedGroupReviewProject()"],
      .sheet-panel[data-index="13"].grv2-admin-mode .grv2-header-toolbar button[onclick="deleteAllGroupReviewProjects()"] {
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
      }

      .sheet-panel[data-index="13"].grv2-worker-mode .grv2-header-toolbar button[onclick="createGroupReviewProjectPrompt()"],
      .sheet-panel[data-index="13"].grv2-worker-mode .grv2-header-toolbar button[onclick="deleteSelectedGroupReviewProject()"],
      .sheet-panel[data-index="13"].grv2-worker-mode .grv2-header-toolbar button[onclick="deleteAllGroupReviewProjects()"] {
        display: none !important;
      }

      .sheet-panel[data-index="13"].grv2-worker-mode .grv2-header-toolbar button[onclick="downloadGroupReviewExcel()"] {
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
      }
    `;
    document.head.appendChild(style);
  }

  function updateButtonVisibility() {
    if (destroyed) return;
    const host = panel();
    if (!host) return;

    const role = document.querySelector('#groupReviewBody .grv2-role')?.textContent?.trim() || '';
    if (role === 'ADMIN') {
      host.classList.add('grv2-admin-mode');
      host.classList.remove('grv2-worker-mode');
    } else if (role === 'WORKER') {
      host.classList.add('grv2-worker-mode');
      host.classList.remove('grv2-admin-mode');
    }
  }

  function scheduleUpdate(delay = 30) {
    clearTimeout(timer);
    timer = setTimeout(updateButtonVisibility, delay);
  }

  window.deleteSelectedGroupReviewProject = async function() {
    if (!isAdmin()) return alert('관리자만 그룹리뷰 프로젝트를 삭제할 수 있습니다.');
    const button = activeProjectButton();
    const projectId = button?.dataset.projectId || '';
    if (!projectId) return alert('삭제할 프로젝트를 먼저 선택하세요.');

    const projectName = String(button.textContent || '선택 프로젝트').replace(/\s*·\s*완료\s*$/, '').trim();
    if (!confirm(`"${projectName}" 그룹리뷰 프로젝트를 삭제하시겠습니까?\n시트, 입력 행, 첨부 이미지도 함께 삭제되며 복구할 수 없습니다.`)) return;

    try {
      await api(`/group-review/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
      alert('그룹리뷰 프로젝트를 삭제했습니다.');
      window.location.reload();
    } catch (error) {
      alert(`프로젝트 삭제 실패: ${error.message}`);
    }
  };

  window.deleteAllGroupReviewProjects = async function() {
    if (!isAdmin()) return alert('관리자만 그룹리뷰 프로젝트를 전체 삭제할 수 있습니다.');

    const count = projectButtons().length;
    if (!count) return alert('삭제할 그룹리뷰 프로젝트가 없습니다.');

    const firstConfirm = confirm(`그룹리뷰 프로젝트 ${count}개를 모두 삭제하시겠습니까?\n모든 시트, 입력 행, 첨부 이미지가 함께 삭제되며 복구할 수 없습니다.`);
    if (!firstConfirm) return;

    const typed = prompt('전체 삭제를 최종 확인하려면 아래에 "전체삭제"를 입력하세요.');
    if (typed !== '전체삭제') {
      if (typed !== null) alert('확인 문구가 일치하지 않아 전체 삭제를 취소했습니다.');
      return;
    }

    try {
      await api('/group-review/projects', { method: 'DELETE' });
      alert('그룹리뷰 프로젝트 전체 삭제가 완료되었습니다.');
      window.location.reload();
    } catch (error) {
      alert(`프로젝트 전체 삭제 실패: ${error.message}`);
    }
  };

  ensureStyles();
  const body = document.getElementById('groupReviewBody');
  const observer = body ? new MutationObserver(() => scheduleUpdate()) : null;
  observer?.observe(body, { childList: true, subtree: true });
  updateButtonVisibility();
  [100, 300].forEach(delay => setTimeout(() => scheduleUpdate(0), delay));

  return {
    refresh: () => scheduleUpdate(0),
    destroy: () => {
      destroyed = true;
      clearTimeout(timer);
      observer?.disconnect();
    }
  };
}
