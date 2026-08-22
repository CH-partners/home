export function installGroupReviewKeyboardV2() {
  if (window.__grv2KeyboardInstalled) return;
  window.__grv2KeyboardInstalled = true;

  function role() {
    return document.querySelector("#groupReviewBody .grv2-role")?.textContent?.trim() || "";
  }

  function isAdmin() {
    return role() === "ADMIN";
  }

  function isWorker() {
    return role() === "WORKER";
  }

  function currentCell(event) {
    const fromTarget = event.target instanceof Element
      ? event.target.closest("#groupReviewBody .grv2-cell")
      : null;
    if (fromTarget) return fromTarget;

    const active = document.activeElement instanceof Element
      ? document.activeElement.closest("#groupReviewBody .grv2-cell")
      : null;
    if (active) return active;

    return document.querySelector(
      "#groupReviewBody .grv2-cell.selected, #groupReviewBody .grv2-cell.grv2-admin-selected"
    );
  }

  function navigableCells() {
    const selector = isAdmin()
      ? "#groupReviewBody .grv2-row .grv2-cell"
      : "#groupReviewBody .grv2-row .grv2-cell.editable";
    return Array.from(document.querySelectorAll(selector));
  }

  function tabTarget(cell, backwards) {
    const cells = navigableCells();
    const index = cells.indexOf(cell);
    if (index < 0) return null;
    return cells[index + (backwards ? -1 : 1)] || null;
  }

  function dispatchCellSelection(cell) {
    if (!cell?.isConnected) return;
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    cell.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "mouse"
    }));
  }

  function placeCaretAtEnd(cell) {
    if (!cell?.isConnected || cell.getAttribute("contenteditable") !== "true") return;
    const selection = window.getSelection?.();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function onKeyDown(event) {
    if (event.key !== "Tab" || (!isAdmin() && !isWorker())) return;

    const cell = currentCell(event);
    if (!cell) return;
    if (isWorker() && !cell.classList.contains("editable")) return;

    event.preventDefault();
    event.stopPropagation();

    const target = tabTarget(cell, event.shiftKey);
    if (!target) return;

    if (isWorker()) {
      // blur commits the current cell through the existing save-on-move logic.
      cell.blur();
      requestAnimationFrame(() => dispatchCellSelection(target));
      return;
    }

    // Admin navigation is selection-only. Existing admin pointer handling applies
    // the highlight and focus without PATCH/save behavior.
    dispatchCellSelection(target);
  }

  function onFocusIn(event) {
    if (!isWorker()) return;
    const cell = event.target instanceof Element
      ? event.target.closest("#groupReviewBody .grv2-cell.editable")
      : null;
    if (!cell) return;

    // A cell that was reached by mouse/arrow/Tab becomes immediately ready for
    // typing. No extra Enter/double-click is required.
    requestAnimationFrame(() => placeCaretAtEnd(cell));
  }

  function ensureLayout() {
    if (document.getElementById("grv2-keyboard-layout-styles")) return;
    const style = document.createElement("style");
    style.id = "grv2-keyboard-layout-styles";
    style.textContent = `
      /* Keep the original Group Review card proportions; only remove the shared
         1280px horizontal cap so the card uses the full workspace on the right. */
      .sheet-panel[data-index="13"]{
        width:100%!important;
        max-width:none!important;
        min-width:0!important;
      }
      .sheet-panel[data-index="13"] .major-card{
        width:100%!important;
        max-width:none!important;
      }
      .sheet-panel[data-index="13"] #groupReviewBody,
      .sheet-panel[data-index="13"] .grv2,
      .sheet-panel[data-index="13"] .grv2-grid{
        width:100%!important;
        max-width:none!important;
        min-width:0!important;
      }
    `;
    document.head.appendChild(style);
  }

  ensureLayout();
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("focusin", onFocusIn, true);
}
