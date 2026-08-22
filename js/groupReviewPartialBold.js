const API_ROOT = "/api/v1";

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json; charset=utf-8";
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers, credentials: "include" });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeRanges(ranges, textLength) {
  const sorted = (Array.isArray(ranges) ? ranges : [])
    .map(range => [Number(range?.[0]), Number(range?.[1])])
    .filter(([start, end]) => Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && start < textLength)
    .map(([start, end]) => [start, Math.min(end, textLength)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

function renderBoldText(text, ranges) {
  const safeRanges = normalizeRanges(ranges, text.length);
  if (!safeRanges.length) return escapeHtml(text);

  let cursor = 0;
  let html = "";
  for (const [start, end] of safeRanges) {
    html += escapeHtml(text.slice(cursor, start));
    html += `<strong>${escapeHtml(text.slice(start, end))}</strong>`;
    cursor = end;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
}

function selectionOffsets(cell) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!cell.contains(range.startContainer) || !cell.contains(range.endContainer)) return null;

  const startRange = document.createRange();
  startRange.selectNodeContents(cell);
  startRange.setEnd(range.startContainer, range.startOffset);

  const endRange = document.createRange();
  endRange.selectNodeContents(cell);
  endRange.setEnd(range.endContainer, range.endOffset);

  const start = startRange.toString().length;
  const end = endRange.toString().length;
  return end > start ? [start, end] : null;
}

export function installGroupReviewPartialBoldV2() {
  if (window.__grv2PartialBoldInstalled) return;
  window.__grv2PartialBoldInstalled = true;

  let savedSelection = null;
  let decorateTimer = null;
  let decorating = false;
  const clearing = new Set();

  function activeSheetId() {
    return Number(document.querySelector("#groupReviewBody .grv2-tab.active[data-sheet-id]")?.dataset?.sheetId || 0);
  }

  async function fetchActiveRows() {
    const sheetId = activeSheetId();
    if (!sheetId) return [];
    return api(`/group-review/sheets/${sheetId}/rows`);
  }

  async function decorate() {
    if (decorating) return;
    const body = document.getElementById("groupReviewBody");
    if (!body || body.querySelector(".grv2-role")?.textContent?.trim() !== "WORKER") return;
    decorating = true;
    try {
      const rows = await fetchActiveRows();
      const byId = new Map((Array.isArray(rows) ? rows : []).map(row => [Number(row.id), row]));
      body.querySelectorAll(".grv2-cell[data-row-id][data-style-key]").forEach(cell => {
        if (document.activeElement === cell) return;
        const row = byId.get(Number(cell.dataset.rowId));
        if (!row) return;
        const style = row.cell_styles?.[cell.dataset.styleKey] || {};
        const text = String(row[cell.dataset.field] ?? "");
        const html = renderBoldText(text, style.boldRanges);
        if (cell.innerHTML !== html) cell.innerHTML = html;
      });
    } catch (_) {
      // 기본 그룹리뷰 동작은 유지한다.
    } finally {
      decorating = false;
    }
  }

  function scheduleDecorate(delay = 100) {
    clearTimeout(decorateTimer);
    decorateTimer = setTimeout(() => {
      decorateTimer = null;
      void decorate();
    }, delay);
  }

  async function applyBoldSelection() {
    const target = savedSelection;
    savedSelection = null;
    if (!target) return alert("굵게 표시할 단어 또는 문구를 먼저 드래그해서 선택하세요.");

    const rows = await fetchActiveRows();
    const row = (Array.isArray(rows) ? rows : []).find(item => Number(item.id) === target.rowId);
    if (!row) return;

    const styleKey = target.styleKey;
    row.cell_styles ||= {};
    row.cell_styles[styleKey] ||= {};
    const style = row.cell_styles[styleKey];
    style.bold = false;
    style.boldRanges = normalizeRanges([...(style.boldRanges || []), target.range], String(row[target.field] ?? "").length);

    const updated = await api(`/group-review/rows/${target.rowId}`, {
      method: "PATCH",
      body: JSON.stringify({ cell_styles: row.cell_styles })
    });

    const cell = document.querySelector(`#groupReviewBody .grv2-cell[data-row-id="${target.rowId}"][data-field="${target.field}"]`);
    if (cell) {
      const updatedStyle = updated.cell_styles?.[styleKey] || {};
      cell.innerHTML = renderBoldText(String(updated[target.field] ?? ""), updatedStyle.boldRanges);
    }
  }

  async function clearBoldRangesAfterEdit(cell) {
    const rowId = Number(cell.dataset.rowId || 0);
    const styleKey = cell.dataset.styleKey;
    if (!rowId || !styleKey) return;
    const clearKey = `${rowId}:${styleKey}`;
    if (clearing.has(clearKey)) return;
    clearing.add(clearKey);
    try {
      await new Promise(resolve => setTimeout(resolve, 120));
      const rows = await fetchActiveRows();
      const row = (Array.isArray(rows) ? rows : []).find(item => Number(item.id) === rowId);
      if (!row?.cell_styles?.[styleKey]?.boldRanges?.length) return;
      row.cell_styles[styleKey].boldRanges = [];
      row.cell_styles[styleKey].bold = false;
      await api(`/group-review/rows/${rowId}`, {
        method: "PATCH",
        body: JSON.stringify({ cell_styles: row.cell_styles })
      });
    } catch (_) {
      // 텍스트 저장 동작은 그대로 유지한다.
    } finally {
      clearing.delete(clearKey);
    }
  }

  document.addEventListener("pointerdown", event => {
    const button = event.target instanceof Element ? event.target.closest("#grv2Bold") : null;
    if (!button) return;
    const cell = document.activeElement?.classList?.contains("grv2-cell") ? document.activeElement : null;
    if (!cell?.classList.contains("editable")) {
      savedSelection = null;
      return;
    }
    const range = selectionOffsets(cell);
    savedSelection = range ? {
      rowId: Number(cell.dataset.rowId),
      field: cell.dataset.field,
      styleKey: cell.dataset.styleKey,
      range
    } : null;
    event.preventDefault();
  }, true);

  document.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest("#grv2Bold") : null;
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void applyBoldSelection().catch(error => alert(`굵게 저장 실패: ${error.message}`));
  }, true);

  document.addEventListener("input", event => {
    const cell = event.target instanceof Element ? event.target.closest("#groupReviewBody .grv2-cell.editable") : null;
    if (cell) cell.dataset.partialBoldEdited = "1";
  }, true);

  document.addEventListener("blur", event => {
    const cell = event.target instanceof Element ? event.target.closest("#groupReviewBody .grv2-cell.editable[data-partial-bold-edited=\"1\"]") : null;
    if (!cell) return;
    delete cell.dataset.partialBoldEdited;
    void clearBoldRangesAfterEdit(cell);
  }, true);

  const startObserver = () => {
    const body = document.getElementById("groupReviewBody");
    if (!body) return setTimeout(startObserver, 100);
    new MutationObserver(() => {
      if (!decorating) scheduleDecorate();
    }).observe(body, { childList: true, subtree: true });
    [0, 200, 600].forEach(delay => setTimeout(() => scheduleDecorate(0), delay));
  };

  startObserver();
}
