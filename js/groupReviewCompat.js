/*
 * Compatibility layer for the group-review workflow.
 *
 * It must load BEFORE groupReviewWorkflow.js so the workflow captures an
 * updateGroupReviewCell implementation that does not mark admin checkbox
 * changes as a dirty local sheet. Admin checkbox decisions are owned by the
 * workflow's pendingChecks map instead.
 */

let originalGuardInstalled = false;
let uiObserverInstalled = false;
let patchFrame = 0;

function installNoDirtyCheckboxGuard() {
  if (originalGuardInstalled) return true;
  if (!window.groupReviewApi || typeof window.updateGroupReviewCell !== "function") return false;

  const originalUpdate = window.updateGroupReviewCell;
  if (originalUpdate.__groupReviewNoDirtyCheckboxGuard) {
    originalGuardInstalled = true;
    return true;
  }

  function noDirtyCheckboxUpdate(rowIndex, field, value) {
    // groupReviewWorkflow.js owns admin checkbox state in pendingChecks.
    // Calling the legacy handler here would add the sheet to dirtySheetKeys,
    // which makes preserveDirtyLocalSheets discard newer Firestore snapshots.
    if (field === "checked") return;
    return originalUpdate.call(this, rowIndex, field, value);
  }

  noDirtyCheckboxUpdate.__groupReviewNoDirtyCheckboxGuard = true;
  window.updateGroupReviewCell = noDirtyCheckboxUpdate;
  originalGuardInstalled = true;
  return true;
}

function isAdminReviewScreen() {
  return Boolean(document.querySelector("#groupReviewBody .review-admin-actions"));
}

function normalizeWorkflowBadgeText(text) {
  return String(text || "")
    .replace(/^검토대기\s*·?\s*v(\d+)$/u, "대기 v$1")
    .replace(/^완료\s*·?\s*v(\d+)$/u, "완료 v$1")
    .replace(/^확인완료\s*·?\s*v(\d+)$/u, "완료 v$1")
    .replace(/^재수정요청\s*·?\s*v(\d+)$/u, "수정요청 v$1");
}

function patchVisibleLabels() {
  const body = document.getElementById("groupReviewBody");
  if (!body) return;

  const admin = isAdminReviewScreen();

  body.querySelectorAll('button[onclick="completeGroupReviewUse()"]').forEach(button => {
    if (admin) {
      button.style.display = "none";
      button.disabled = true;
      return;
    }
    button.style.display = "";
    button.disabled = false;
    if (button.textContent !== "입력 완료") button.textContent = "입력 완료";
  });

  body.querySelectorAll(".review-workflow-badge").forEach(badge => {
    const next = normalizeWorkflowBadgeText(badge.textContent);
    if (badge.textContent !== next) badge.textContent = next;
  });

  body.querySelectorAll(".review-workflow-revise").forEach(button => {
    if (button.textContent !== "수정요청") button.textContent = "수정요청";
  });

  if (admin) {
    body.querySelectorAll(".review-complete-action").forEach(button => {
      if (button.textContent !== "리뷰 재개" && button.textContent !== "리뷰 완료") {
        button.textContent = "리뷰 완료";
      }
    });
  }
}

function scheduleLabelPatch() {
  if (patchFrame) cancelAnimationFrame(patchFrame);
  patchFrame = requestAnimationFrame(() => {
    patchFrame = 0;
    patchVisibleLabels();
  });
}

function installUiObserver() {
  if (uiObserverInstalled) return true;
  const body = document.getElementById("groupReviewBody");
  if (!body) return false;

  const observer = new MutationObserver(() => scheduleLabelPatch());
  observer.observe(body, { childList: true, subtree: true });
  uiObserverInstalled = true;
  patchVisibleLabels();
  return true;
}

function bootstrap() {
  const guarded = installNoDirtyCheckboxGuard();
  installUiObserver();

  // Poll faster than the workflow bootstrap (100ms) so the guard is installed
  // before groupReviewWorkflow.js captures the legacy update handler.
  if (!guarded || !uiObserverInstalled) {
    setTimeout(bootstrap, 20);
  }
}

bootstrap();
