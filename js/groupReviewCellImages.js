const API_ROOT = "/api/v1";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MIN_WIDTH = 80;
const MAX_WIDTH = 1600;
const MAX_Y = 1200;
const DRAG_THRESHOLD = 4;

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof Blob)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json; charset=utf-8";
  }
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers, credentials: "include" });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.detail || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function activeSheetId() {
  return Number(document.querySelector("#groupReviewBody .grv2-tab.active[data-sheet-id]")?.dataset?.sheetId || 0);
}

function setStatus(text) {
  const target = document.getElementById("grv2Status");
  if (target) target.textContent = text;
}

function imageUrl(rowId, styleKey, imageId) {
  return `${API_ROOT}/group-review/rows/${rowId}/cells/${encodeURIComponent(styleKey)}/image?v=${encodeURIComponent(imageId || "")}`;
}

function currentSelectedEditableCell() {
  const active = document.activeElement instanceof Element
    ? document.activeElement.closest("#groupReviewBody .grv2-cell.editable")
    : null;
  if (active) return active;
  return document.querySelector("#groupReviewBody .grv2-cell.selected.editable");
}

function clipboardImage(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const item = items.find(candidate => candidate.kind === "file" && String(candidate.type || "").startsWith("image/"));
  return item?.getAsFile?.() || null;
}

function ensureStyles() {
  if (document.getElementById("grv2-cell-image-styles")) return;
  const style = document.createElement("style");
  style.id = "grv2-cell-image-styles";
  style.textContent = `
    #groupReviewBody .grv2-cell-image-host{
      position:relative;
      width:100%;
      min-height:40px;
      padding:0;
      line-height:0;
      overflow:hidden;
      box-sizing:border-box;
    }
    #groupReviewBody .grv2-cell-image-box{
      position:absolute;
      display:block;
      min-width:40px;
      max-width:calc(100% - 2px);
      border:1px solid #cbd5e1;
      border-radius:4px;
      background:#fff;
      box-sizing:border-box;
      overflow:hidden;
      touch-action:none;
    }
    #groupReviewBody .grv2-cell-image-box.editable{cursor:move}
    #groupReviewBody .grv2-cell-image-box.dragging{opacity:.94;box-shadow:0 4px 16px rgba(15,23,42,.24)}
    #groupReviewBody .grv2-cell-image-box img{
      display:block;
      width:100%;
      height:auto;
      max-height:600px;
      object-fit:contain;
      user-select:none;
      -webkit-user-drag:none;
      cursor:zoom-in;
      pointer-events:none;
    }
    #groupReviewBody .grv2-cell-image-box.editable img{cursor:move}
    #groupReviewBody .grv2-cell-image-delete{
      position:absolute;
      top:4px;
      right:4px;
      z-index:3;
      width:24px;
      height:24px;
      padding:0;
      border:1px solid rgba(255,255,255,.85);
      border-radius:50%;
      background:rgba(15,23,42,.76);
      color:#fff;
      font-size:16px;
      line-height:20px;
      cursor:pointer;
    }
    #groupReviewBody .grv2-cell-image-resize{
      position:absolute;
      right:0;
      bottom:0;
      z-index:3;
      width:18px;
      height:18px;
      cursor:nwse-resize;
      background:linear-gradient(135deg,transparent 0 48%,rgba(37,99,235,.9) 49% 58%,transparent 59% 67%,rgba(37,99,235,.9) 68% 77%,transparent 78%);
      touch-action:none;
    }
    #grv2ImageLightbox{
      position:fixed;
      inset:0;
      z-index:99999;
      display:none;
      align-items:center;
      justify-content:center;
      padding:24px;
      background:rgba(15,23,42,.82);
      box-sizing:border-box;
    }
    #grv2ImageLightbox.open{display:flex}
    #grv2ImageLightbox img{max-width:94vw;max-height:92vh;object-fit:contain;background:#fff;box-shadow:0 10px 40px rgba(0,0,0,.35)}
    #grv2ImageLightbox button{
      position:absolute;top:16px;right:18px;width:38px;height:38px;border:1px solid rgba(255,255,255,.65);
      border-radius:50%;background:rgba(0,0,0,.38);color:#fff;font-size:24px;cursor:pointer
    }
  `;
  document.head.appendChild(style);
}

function ensureLightbox() {
  let lightbox = document.getElementById("grv2ImageLightbox");
  if (lightbox) return lightbox;
  lightbox = document.createElement("div");
  lightbox.id = "grv2ImageLightbox";
  lightbox.innerHTML = '<button type="button" aria-label="닫기">×</button><img alt="그룹리뷰 첨부 이미지">';
  const close = () => {
    lightbox.classList.remove("open");
    lightbox.querySelector("img")?.removeAttribute("src");
  };
  lightbox.addEventListener("click", event => {
    if (event.target === lightbox || event.target.closest("button")) close();
  });
  document.body.appendChild(lightbox);
  return lightbox;
}

function openLightbox(src) {
  const lightbox = ensureLightbox();
  const image = lightbox.querySelector("img");
  if (image) image.src = src;
  lightbox.classList.add("open");
}

function layoutHost(host, box, x, y) {
  const height = Math.ceil(y + box.getBoundingClientRect().height + 8);
  host.style.height = `${Math.max(40, height)}px`;
  box.style.left = `${Math.round(x)}px`;
  box.style.top = `${Math.round(y)}px`;
}

export function installGroupReviewCellImagesV2(baseApi) {
  if (window.__grv2CellImagesInstalled) return;
  window.__grv2CellImagesInstalled = true;

  ensureStyles();
  ensureLightbox();

  let decorateTimer = null;
  let decorating = false;
  let operationInFlight = false;

  async function fetchRows() {
    const sheetId = activeSheetId();
    if (!sheetId) return [];
    return api(`/group-review/sheets/${sheetId}/rows`);
  }

  function removeStaleHosts(validKeys) {
    document.querySelectorAll("#groupReviewBody .grv2-cell-image-host[data-image-key]").forEach(host => {
      if (!validKeys.has(host.dataset.imageKey)) host.remove();
    });
  }

  async function savePosition(rowId, styleKey, x, y) {
    return api(`/group-review/rows/${rowId}/cells/${encodeURIComponent(styleKey)}/image-position`, {
      method: "PATCH",
      body: JSON.stringify({ x: Math.round(x), y: Math.round(y) })
    });
  }

  function bindImageControls(host, cell, row, meta) {
    const rowId = Number(row.id);
    const styleKey = cell.dataset.styleKey;
    const box = host.querySelector(".grv2-cell-image-box");
    const image = host.querySelector("img");
    const editable = cell.classList.contains("editable");
    if (!box || !image || !styleKey) return;

    image.onload = () => {
      const maxX = Math.max(0, host.clientWidth - box.getBoundingClientRect().width);
      const x = clamp(Number(meta.x || 0), 0, maxX);
      const y = clamp(Number(meta.y || 0), 0, MAX_Y);
      layoutHost(host, box, x, y);
    };

    if (!editable) {
      box.onclick = event => {
        if (event.target instanceof Element && event.target.closest("button,.grv2-cell-image-resize")) return;
        event.preventDefault();
        event.stopPropagation();
        openLightbox(image.src);
      };
      return;
    }

    const deleteButton = host.querySelector(".grv2-cell-image-delete");
    if (deleteButton) {
      deleteButton.onclick = async event => {
        event.preventDefault();
        event.stopPropagation();
        if (operationInFlight || !confirm("이 셀의 이미지를 삭제할까요?")) return;
        operationInFlight = true;
        try {
          setStatus("이미지 삭제 중...");
          await api(`/group-review/rows/${rowId}/cells/${encodeURIComponent(styleKey)}/image`, { method: "DELETE" });
          await baseApi?.refresh?.();
          scheduleDecorate(0);
          setStatus("이미지 삭제됨");
        } catch (error) {
          alert(`이미지 삭제 실패: ${error.message}`);
          setStatus("이미지 삭제 실패");
        } finally {
          operationInFlight = false;
        }
      };
    }

    box.onpointerdown = event => {
      if (operationInFlight) return;
      if (event.target instanceof Element && event.target.closest("button,.grv2-cell-image-resize")) return;
      event.preventDefault();
      event.stopPropagation();

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = parseFloat(box.style.left || "0") || 0;
      const startTop = parseFloat(box.style.top || "0") || 0;
      let nextX = startLeft;
      let nextY = startTop;
      let moved = false;

      try { box.setPointerCapture(pointerId); } catch (_) {}

      const onMove = moveEvent => {
        if (moveEvent.pointerId !== pointerId) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        moved = true;
        box.classList.add("dragging");
        const maxX = Math.max(0, host.clientWidth - box.getBoundingClientRect().width);
        nextX = clamp(startLeft + dx, 0, maxX);
        nextY = clamp(startTop + dy, 0, MAX_Y);
        layoutHost(host, box, nextX, nextY);
      };

      const finish = async upEvent => {
        if (upEvent.pointerId !== pointerId) return;
        box.removeEventListener("pointermove", onMove);
        box.removeEventListener("pointerup", finish);
        box.removeEventListener("pointercancel", finish);
        box.classList.remove("dragging");
        try { box.releasePointerCapture(pointerId); } catch (_) {}

        if (!moved) {
          openLightbox(image.src);
          return;
        }

        const savedX = Math.round(nextX);
        const savedY = Math.round(nextY);
        if (savedX === Number(meta.x || 0) && savedY === Number(meta.y || 0)) return;
        operationInFlight = true;
        try {
          setStatus("이미지 위치 저장 중...");
          await savePosition(rowId, styleKey, savedX, savedY);
          await baseApi?.refresh?.();
          scheduleDecorate(0);
          setStatus("이미지 위치 저장됨");
        } catch (error) {
          alert(`이미지 위치 저장 실패: ${error.message}`);
          scheduleDecorate(0);
          setStatus("이미지 위치 저장 실패");
        } finally {
          operationInFlight = false;
        }
      };

      box.addEventListener("pointermove", onMove);
      box.addEventListener("pointerup", finish);
      box.addEventListener("pointercancel", finish);
    };

    const handle = host.querySelector(".grv2-cell-image-resize");
    if (!handle) return;
    handle.onpointerdown = event => {
      event.preventDefault();
      event.stopPropagation();
      if (operationInFlight) return;

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = box.getBoundingClientRect().width;
      const visualMax = Math.max(MIN_WIDTH, host.clientWidth);
      let nextWidth = clamp(startWidth, MIN_WIDTH, Math.min(MAX_WIDTH, visualMax));

      try { handle.setPointerCapture(pointerId); } catch (_) {}

      const onMove = moveEvent => {
        if (moveEvent.pointerId !== pointerId) return;
        nextWidth = clamp(startWidth + (moveEvent.clientX - startX), MIN_WIDTH, Math.min(MAX_WIDTH, visualMax));
        box.style.width = `${Math.round(nextWidth)}px`;
        const maxX = Math.max(0, host.clientWidth - nextWidth);
        const currentX = clamp(parseFloat(box.style.left || "0") || 0, 0, maxX);
        const currentY = parseFloat(box.style.top || "0") || 0;
        layoutHost(host, box, currentX, currentY);
      };

      const finish = async upEvent => {
        if (upEvent.pointerId !== pointerId) return;
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        try { handle.releasePointerCapture(pointerId); } catch (_) {}

        const savedWidth = Math.round(nextWidth);
        const maxX = Math.max(0, host.clientWidth - savedWidth);
        const savedX = Math.round(clamp(parseFloat(box.style.left || "0") || 0, 0, maxX));
        const savedY = Math.round(clamp(parseFloat(box.style.top || "0") || 0, 0, MAX_Y));
        const widthChanged = savedWidth !== Number(meta.width || 320);
        const positionChanged = savedX !== Number(meta.x || 0) || savedY !== Number(meta.y || 0);
        if (!widthChanged && !positionChanged) return;

        operationInFlight = true;
        try {
          setStatus("이미지 크기 저장 중...");
          if (widthChanged) {
            await api(`/group-review/rows/${rowId}/cells/${encodeURIComponent(styleKey)}/image-size`, {
              method: "PATCH",
              body: JSON.stringify({ width: savedWidth })
            });
          }
          if (positionChanged) await savePosition(rowId, styleKey, savedX, savedY);
          await baseApi?.refresh?.();
          scheduleDecorate(0);
          setStatus("이미지 크기 저장됨");
        } catch (error) {
          alert(`이미지 크기 저장 실패: ${error.message}`);
          scheduleDecorate(0);
          setStatus("이미지 크기 저장 실패");
        } finally {
          operationInFlight = false;
        }
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    };
  }

  async function decorate() {
    if (decorating || operationInFlight) return;
    const body = document.getElementById("groupReviewBody");
    if (!body || !body.querySelector(".grv2-role")) return;

    decorating = true;
    try {
      const rows = await fetchRows();
      const byId = new Map((Array.isArray(rows) ? rows : []).map(row => [Number(row.id), row]));
      const validKeys = new Set();

      body.querySelectorAll(".grv2-cell[data-row-id][data-style-key]").forEach(cell => {
        const row = byId.get(Number(cell.dataset.rowId));
        const styleKey = cell.dataset.styleKey;
        const meta = row?.cell_styles?.[styleKey]?.image;
        const td = cell.closest("td");
        if (!td) return;
        const key = `${cell.dataset.rowId}:${styleKey}`;
        let host = td.querySelector(`:scope > .grv2-cell-image-host[data-image-key="${CSS.escape(key)}"]`);

        if (!meta?.id) {
          host?.remove();
          return;
        }
        validKeys.add(key);

        const editable = cell.classList.contains("editable");
        const visualMax = Math.max(MIN_WIDTH, (td.clientWidth || MAX_WIDTH) - 2);
        const width = clamp(Number(meta.width || 320), MIN_WIDTH, Math.min(MAX_WIDTH, visualMax));
        const maxX = Math.max(0, visualMax - width);
        const x = clamp(Number(meta.x || 0), 0, maxX);
        const y = clamp(Number(meta.y || 0), 0, MAX_Y);
        const needsRender = !host
          || host.dataset.imageId !== String(meta.id)
          || host.dataset.imageWidth !== String(width)
          || host.dataset.imageX !== String(x)
          || host.dataset.imageY !== String(y)
          || host.dataset.imageEditable !== String(editable);

        if (!needsRender) return;
        if (!host) {
          host = document.createElement("div");
          host.className = "grv2-cell-image-host";
          host.dataset.imageKey = key;
          td.appendChild(host);
        }
        host.dataset.imageId = String(meta.id);
        host.dataset.imageWidth = String(width);
        host.dataset.imageX = String(x);
        host.dataset.imageY = String(y);
        host.dataset.imageEditable = String(editable);
        const src = imageUrl(Number(row.id), styleKey, meta.id);
        host.innerHTML = `<div class="grv2-cell-image-box ${editable ? "editable" : ""}" style="width:${width}px;left:${x}px;top:${y}px"><img src="${src}" alt="셀 첨부 이미지" draggable="false">${editable ? '<button type="button" class="grv2-cell-image-delete" aria-label="이미지 삭제">×</button><span class="grv2-cell-image-resize" title="드래그하여 크기 조절"></span>' : ""}</div>`;
        bindImageControls(host, cell, row, meta);
      });

      removeStaleHosts(validKeys);
    } catch (_) {
      // 이미지 기능 실패가 기본 그룹리뷰 입력을 막지 않도록 한다.
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

  async function uploadImage(cell, file) {
    if (operationInFlight) return;
    const rowId = Number(cell.dataset.rowId || 0);
    const styleKey = cell.dataset.styleKey;
    if (!rowId || !styleKey) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) return alert("PNG, JPG, WebP 이미지만 붙여넣을 수 있습니다.");
    if (file.size > MAX_IMAGE_BYTES) return alert("이미지는 10MB 이하만 붙여넣을 수 있습니다.");

    operationInFlight = true;
    try {
      setStatus("이미지 저장 중...");
      const response = await fetch(`${API_ROOT}/group-review/rows/${rowId}/cells/${encodeURIComponent(styleKey)}/image`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
        credentials: "include"
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`);
      await baseApi?.refresh?.();
      scheduleDecorate(0);
      setStatus("이미지 저장됨");
    } catch (error) {
      alert(`이미지 저장 실패: ${error.message}`);
      setStatus("이미지 저장 실패");
    } finally {
      operationInFlight = false;
    }
  }

  document.addEventListener("paste", event => {
    const file = clipboardImage(event);
    if (!file) return;
    const cell = event.target instanceof Element
      ? event.target.closest("#groupReviewBody .grv2-cell.editable") || currentSelectedEditableCell()
      : currentSelectedEditableCell();
    if (!cell) return;
    event.preventDefault();
    event.stopPropagation();
    void uploadImage(cell, file);
  }, true);

  document.addEventListener("click", event => {
    const clearButton = event.target instanceof Element ? event.target.closest("#grv2Clear") : null;
    if (!clearButton) return;
    const cell = currentSelectedEditableCell();
    if (!cell) return;

    const rowId = Number(cell.dataset.rowId || 0);
    const styleKey = cell.dataset.styleKey;
    if (!rowId || !styleKey) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    void (async () => {
      try {
        const rows = await fetchRows();
        const row = rows.find(item => Number(item.id) === rowId);
        if (!row) return;
        const image = row.cell_styles?.[styleKey]?.image;
        const styles = { ...(row.cell_styles || {}) };
        styles[styleKey] = image ? { image } : {};
        await api(`/group-review/rows/${rowId}`, { method: "PATCH", body: JSON.stringify({ cell_styles: styles }) });
        await baseApi?.refresh?.();
        scheduleDecorate(0);
        setStatus("서식 지움");
      } catch (error) {
        alert(`서식 지우기 실패: ${error.message}`);
      }
    })();
  }, true);

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const lightbox = document.getElementById("grv2ImageLightbox");
    if (!lightbox?.classList.contains("open")) return;
    lightbox.classList.remove("open");
    lightbox.querySelector("img")?.removeAttribute("src");
  }, true);

  const body = document.getElementById("groupReviewBody");
  if (body) {
    const observer = new MutationObserver(mutations => {
      const externalMutation = mutations.some(mutation => {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
        return !target?.closest?.(".grv2-cell-image-host");
      });
      if (externalMutation) scheduleDecorate(80);
    });
    observer.observe(body, { childList: true, subtree: true });
  }

  window.addEventListener("resize", () => scheduleDecorate(80));
  window.addEventListener("local-shared-pages-loaded", () => scheduleDecorate(100));
  [0, 200, 600, 1200].forEach(delay => setTimeout(() => scheduleDecorate(0), delay));
}
