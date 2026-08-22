export function installGroupReviewTheme() {
  if (document.getElementById("grv2-theme-overrides")) return;

  const style = document.createElement("style");
  style.id = "grv2-theme-overrides";
  style.textContent = `
    #groupReviewBody .grv2-grid {
      border-color: #9db3ca !important;
    }

    #groupReviewBody .grv2 table {
      border-color: #9db3ca !important;
    }

    #groupReviewBody .grv2 th,
    #groupReviewBody .grv2 td {
      border-right-color: #9db3ca !important;
      border-bottom-color: #9db3ca !important;
    }

    #groupReviewBody .grv2 thead th {
      background: #f3ead8 !important;
      color: #334155 !important;
    }
  `;

  document.head.appendChild(style);
}
