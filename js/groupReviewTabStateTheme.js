export function installGroupReviewTabStateTheme() {
  if (document.getElementById("grv2-tab-state-theme")) return;

  const style = document.createElement("style");
  style.id = "grv2-tab-state-theme";
  style.textContent = `
    #groupReviewBody .grv2-tab:not(.done):not(.grv2-admin-complete):not(.grv2-worker-complete):not(.grv2-admin-reuse) {
      background: #ffffff !important;
      border: 2px solid #1f4e79 !important;
      border-bottom-color: #1f4e79 !important;
      color: #334155 !important;
      font-weight: 700 !important;
      box-shadow: none !important;
    }

    #groupReviewBody .grv2-tab:not(.done):not(.grv2-admin-complete):not(.grv2-worker-complete):not(.grv2-admin-reuse).active {
      background: #ffffff !important;
      border: 3px solid #1f4e79 !important;
      border-bottom-color: #1f4e79 !important;
      color: #1f2937 !important;
      font-weight: 800 !important;
      box-shadow: none !important;
    }

    #groupReviewBody .grv2-tab.done:not(.grv2-admin-reuse),
    #groupReviewBody .grv2-tab.grv2-admin-complete:not(.grv2-admin-reuse),
    #groupReviewBody .grv2-tab.grv2-worker-complete:not(.grv2-admin-reuse) {
      background: #facc15 !important;
      border: 2px solid #ca8a04 !important;
      border-bottom-color: #ca8a04 !important;
      color: #713f12 !important;
      font-weight: 800 !important;
      box-shadow: none !important;
    }

    #groupReviewBody .grv2-tab.done.active:not(.grv2-admin-reuse),
    #groupReviewBody .grv2-tab.grv2-admin-complete.active:not(.grv2-admin-reuse),
    #groupReviewBody .grv2-tab.grv2-worker-complete.active:not(.grv2-admin-reuse) {
      background: #facc15 !important;
      border: 4px solid #dc2626 !important;
      border-bottom-color: #dc2626 !important;
      color: #713f12 !important;
      font-weight: 900 !important;
      box-shadow: none !important;
    }

    #groupReviewBody .grv2-tab.grv2-admin-reuse {
      background: #dc2626 !important;
      border: 2px solid #991b1b !important;
      border-bottom-color: #991b1b !important;
      color: #ffffff !important;
      font-weight: 900 !important;
      box-shadow: none !important;
    }

    #groupReviewBody .grv2-tab.grv2-admin-reuse.active {
      border-width: 4px !important;
      border-color: #7f1d1d !important;
      border-bottom-color: #7f1d1d !important;
    }
  `;

  document.head.appendChild(style);
}
