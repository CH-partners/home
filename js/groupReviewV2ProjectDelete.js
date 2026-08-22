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
  const isAdmin = () => document.querySelector('#groupReviewBody .grv2-role')?.textContent?.trim() === 'ADMIN';

  function updateButtonVisibility() {
    if (destroyed) return;
    const buttons = panel()?.querySelectorAll('.work-toolbar button') || [];
    if (buttons[2]) buttons[2].style.display = isAdmin() ? '' : 'none';
    if (buttons[3]) buttons[3].style.display = 'none';
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
    if (!confirm(`"${projectName}" 그룹리뷰 프로젝트를 삭제하시겠습니까?\n시트와 입력 행도 함께 삭제되며 복구할 수 없습니다.`)) return;

    try {
      await api(`/group-review/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
      // Core V2 keeps the selected project id in memory. Reloading after delete clears
      // that stale id, including when the deleted project was the final project.
      alert('그룹리뷰 프로젝트를 삭제했습니다.');
      window.location.reload();
    } catch (error) {
      alert(`프로젝트 삭제 실패: ${error.message}`);
    }
  };

  window.deleteAllGroupReviewProjects = function() {
    alert('전체 프로젝트 삭제는 배포 안정화를 위해 비활성화했습니다. 프로젝트별 삭제를 사용하세요.');
  };

  const body = document.getElementById('groupReviewBody');
  const observer = body ? new MutationObserver(() => scheduleUpdate()) : null;
  observer?.observe(body, { childList: true, subtree: true });
  [0, 100, 300, 700].forEach(delay => setTimeout(() => scheduleUpdate(0), delay));

  return {
    refresh: () => scheduleUpdate(0),
    destroy: () => {
      destroyed = true;
      clearTimeout(timer);
      observer?.disconnect();
    }
  };
}
