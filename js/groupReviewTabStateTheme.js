export function installGroupReviewTabStateTheme() {
  if (document.getElementById("grv2-tab-state-theme")) return;

  const style = document.createElement("style");
  style.id = "grv2-tab-state-theme";
  style.textContent = `
    #groupReviewBody .grv2-tab:not(.done):not(.grv2-admin-complete):not(.grv2-worker-complete):not(.grv2-admin-reuse) {
      background: #e7edf4 !important;
      border-top: 1px solid #a8b7c6 !important;
      border-left: 1px solid #a8b7c6 !important;
      border-right: 1px solid #a8b7c6 !important;
      border-bottom: 0 !important;
      color: #334155 !important;
      font-weight: 700 !important;
      box-shadow: none !important;
    }

    #groupReviewBody .grv2-tab:not(.done):not(.grv2-admin-complete):not(.grv2-worker-complete):not(.grv2-admin-reuse).active {
      background: #dfe8f1 !important;
      border-top-color: #94a8bb !important;
      border-left-color: #94a8bb !important;
      border-right-color: #94a8bb !important;
      border-bottom: 0 !important;
      color: #1f2937 !important;
      font-weight: 800 !important;
      box-shadow: none !important;
    }

    #groupReviewBody .grv2-tab.done:not(.grv2-admin-reuse),
    #groupReviewBody .grv2-tab.grv2-admin-complete:not(.grv2-admin-reuse),
    #groupReviewBody .grv2-tab.grv2-worker-complete:not(.grv2-admin-reuse) {
      background: #facc15 !important;
      border-top: 1px solid #d6b95c !important;
      border-left: 1px solid #d6b95c !important;
      border-right: 1px solid #d6b95c !important;
      border-bottom: 0 !important;
      color: #713f12 !important;
      font-weight: 800 !important;
      box-shadow: none !important;
    }

    #groupReviewBody .grv2-tab.done.active:not(.grv2-admin-reuse),
    #groupReviewBody .grv2-tab.grv2-admin-complete.active:not(.grv2-admin-reuse),
    #groupReviewBody .grv2-tab.grv2-worker-complete.active:not(.grv2-admin-reuse) {
      background: #facc15 !important;
      border-top: 2px solid #c96767 !important;
      border-left: 2px solid #c96767 !important;
      border-right: 2px solid #c96767 !important;
      border-bottom: 0 !important;
      color: #713f12 !important;
      font-weight: 900 !important;
      box-shadow: none !important;
    }

    #groupReviewBody .grv2-tab.grv2-admin-reuse {
      background: #dc2626 !important;
      border-top: 1px solid #b96a6a !important;
      border-left: 1px solid #b96a6a !important;
      border-right: 1px solid #b96a6a !important;
      border-bottom: 0 !important;
      color: #ffffff !important;
      font-weight: 900 !important;
      box-shadow: none !important;
    }

    #groupReviewBody .grv2-tab.grv2-admin-reuse.active {
      border-top: 2px solid #a95454 !important;
      border-left: 2px solid #a95454 !important;
      border-right: 2px solid #a95454 !important;
      border-bottom: 0 !important;
    }
  `;

  document.head.appendChild(style);
}
