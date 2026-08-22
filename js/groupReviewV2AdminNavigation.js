export function installGroupReviewAdminNavigationV2() {
  if (window.__grv2AdminNavigationInstalled) return;
  window.__grv2AdminNavigationInstalled = true;

  const state = { selected: null };

  function isAdminView() {
    return document.querySelector("#groupReviewBody .grv2-role")?.textContent?.trim() === "ADMIN";
  }

  function gridCells() {
    return Array.from(document.querySelectorAll("#groupReviewBody .grv2-row .grv2-cell"));
  }

  function selectCell(cell) {
    if (!cell || !isAdminView()) return;
    document.querySelectorAll("#groupReviewBody .grv2-cell.grv2-admin-selected")
      .forEach(item => item.classList.remove("grv2-admin-selected"));
    cell.classList.add("grv2-admin-selected");
    cell.setAttribute("tabindex", "0");
    cell.focus({ preventScroll: true });
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    state.selected = cell;
  }

  function directionalTarget(cell, key) {
    const row = cell.closest(".grv2-row");
    if (!row) return null;
    const rowCells = Array.from(row.querySelectorAll(".grv2-cell"));
    const columnIndex = rowCells.indexOf(cell);
    if (columnIndex < 0) return null;

    if (key === "ArrowLeft") return rowCells[columnIndex - 1] || null;
    if (key === "ArrowRight") return rowCells[columnIndex + 1] || null;

    const rows = Array.from(document.querySelectorAll("#groupReviewBody .grv2-row"));
    const rowIndex = rows.indexOf(row);
    const nextRowIndex = rowIndex + (key === "ArrowUp" ? -1 : 1);
    if (nextRowIndex < 0 || nextRowIndex >= rows.length) return null;
    return Array.from(rows[nextRowIndex].querySelectorAll(".grv2-cell"))[columnIndex] || null;
  }

  function onPointerDown(event) {
    if (!isAdminView()) return;
    const cell = event.target instanceof Element ? event.target.closest("#groupReviewBody .grv2-cell") : null;
    if (!cell) return;
    selectCell(cell);
  }

  function onKeyDown(event) {
    if (!isAdminView() || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const cell = event.target instanceof Element ? event.target.closest("#groupReviewBody .grv2-cell") : null;
    const current = cell || state.selected;
    if (!current) return;
    const target = directionalTarget(current, event.key);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    selectCell(target);
  }

  function ensureStyles() {
    if (document.getElementById("grv2-admin-navigation-styles")) return;
    const style = document.createElement("style");
    style.id = "grv2-admin-navigation-styles";
    style.textContent = `
      #groupReviewBody .grv2-cell.grv2-admin-selected{
        box-shadow:inset 0 0 0 2px #2563eb!important;
        outline:none!important;
      }
    `;
    document.head.appendChild(style);
  }

  ensureStyles();
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
}
