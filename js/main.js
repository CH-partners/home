import "./sharedPageImages.js";
import { initAllocation } from "./allocation.js";
import { initSchedule } from "./schedule.js";
import { initGroupReview } from "./groupReview.js";

let workspaceFullscreen = false;

function updateWorkspaceFullscreenUI() {
  document.body.classList.toggle("workspace-fullscreen", workspaceFullscreen);
  const btn = document.getElementById("workspaceFullscreenBtn");
  if (btn) {
    btn.textContent = workspaceFullscreen ? "원래 화면" : "오른쪽 창 전체화면";
    btn.classList.toggle("active", workspaceFullscreen);
  }
  requestAnimationFrame(() => {
    window.groupReviewApi?.fitTextareas?.();
    window.scheduleApi?.updateSize?.();
  });
}

window.toggleWorkspaceFullscreen = function() {
  workspaceFullscreen = !workspaceFullscreen;
  updateWorkspaceFullscreenUI();
};

window.addEventListener("keydown", event => {
  if (event.key === "Escape" && workspaceFullscreen) {
    workspaceFullscreen = false;
    updateWorkspaceFullscreenUI();
  }
});

function showSheet(index, title = "") {
  document.querySelectorAll(".sheet-panel").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  const panel = document.querySelector('.sheet-panel[data-index="' + index + '"]');
  if (panel) panel.classList.add("active");
  const matchedButton = Array.from(document.querySelectorAll(".nav-item"))
    .find(btn => btn.textContent.trim() === title || btn.textContent.trim().includes(title));
  if (matchedButton) matchedButton.classList.add("active");
  if (Number(index) === 12 && window.scheduleApi) {
    requestAnimationFrame(() => window.scheduleApi.updateSize());
  }
  if (Number(index) === 13) {
    window.groupReviewApi?.requireMemberSelection?.();
  }
}
window.showSheet = showSheet;

function openModal(id) {
  document.getElementById(id)?.classList.add("show");
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove("show");
}

window.allocationApi = initAllocation();
window.scheduleApi = initSchedule({ openModal, closeModal });
window.groupReviewApi = initGroupReview();

window.scheduleApi.initCalendar();
window.scheduleApi.subscribeSchedules();
showSheet(0, "청현 공지사항");