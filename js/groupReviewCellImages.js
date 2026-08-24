const API_ROOT = "/api/v1";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MIN_WIDTH = 80;
const MAX_WIDTH = 1600;

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof Blob) && typeof options.body !== "string") {
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
      padding:0 8px 8px;
      line-height:0;
      text-align:left;
    }
    #groupReviewBody .grv2-cell-image-box{
      position:relative;
      display:inline-block;
      max-width:100%;
      min-width:40px;
      border:1px solid #cbd5e1;
      border-radius:4px;
      background:#fff;
      box-sizing:border-box;
      overflow:hidden;
      vertical-align:top;
    }
    #groupReviewBody .grv2-cell-image-box img{
      display:block;
      width:100%;
      height:auto;
      max-height:600px;
      object-fit:contain;
      user-select:none;
      -webkit-user-drag:none;
      cursor:zoom-in;
    }
    #groupReviewBody .grv2-cell-image-delete{
      position:absolute;
      top:4px;
      right:4px;
      z-index:2;
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
      z-index:2;
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
    #grv2ImageLightbox img{
      max-width:94vw;
      max-height:92vh;
      object-fit:contain;
      background:#fff;
      box-shadow:0 10px 40px rgba(0,0,0,.35);
    }
    #grv2ImageLightbox button{
      position:absolute;
      top:16px;
      right:18px;
      width:38px;
      height:38px;
      border:1px solid rgba(255,255,255,.65);
      border-radius:50%;
      background:rgba(0,0,0,.38);
      color:#fff;
      font-size:24px;
      cursor:pointer;
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
    const image = lightbox.querySelector("img");
    if (image) image.removeAttribute("src");
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

  function bindImageControls(host, cell, row, meta) {
    const rowId = Number(row.id);
    const styleKey = cell.dataset.styleKey;
    const box = host.querySelector(".grv2-cell-image-box");
    const image = host.querySelector("img");
    const editable = cell.classList.contains("editable");
    if (!box || !image || !styleKey) return;

    image.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      openLightbox(image.src);
    };

    const deleteButton = host.querySelector(".grv2-cell-image-delete");
    if (deleteButton && editable) {
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

    const handle = host.querySelector(".grv2-cell-image-resize");
    if (!handle || !editable) return;
    handle.onpointerdown = event => {
      event.preventDefault();
      event.stopPropagation();
      if (operationInFlight) return;

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = box.getBoundingClientRect().width;
      const td = cell.closest("td");
      const visualMax = Math.max(MIN_WIDTH, (td?.clientWidth || MAX_WIDTH) - 16);
      let nextWidth = clamp(startWidth, MIN_WIDTH, Math.min(MAX_WIDTH, visualMax));

      try { handle.setPointerCapture(pointerId); } catch (_) {}

      const onMove = moveEvent => {
        if (moveEvent.pointerId !== pointerId) return;
        nextWidth = clamp(startWidth + (moveEvent.clientX - startX), MIN_WIDTH, Math.min(MAX_WIDTH, visualMax));
        box.style.width = `${Math.round(nextWidth)}px`;
      };

      const finish = async upEvent => {
        if (upEvent.pointerId !== pointerId) return;
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        try { handle.releasePointerCapture(pointerId); } catch (_) {}

        const savedWidth = Math.round(nextWidth);
        if (savedWidth === Number(meta.width || 320)) return;
        operationInFlight = true;
        try {
          setStatus("이미지 크기 저장 중...");
          await api(`/group-review/rows/${rowId}/cells/${encodeURIComponent(styleKey)}/image-size`, {
            method: "PATCH",
            body: JSON.stringify({ width: savedWidth })
          });
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
        const width = clamp(Number(meta.width || 320), MIN_WIDTH, MAX_WIDTH);
        const needsRender = !host
          || host.dataset.imageId !== String(meta.id)
          || host.dataset.imageWidth !== String(width)
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
        host.dataset.imageEditable = String(editable);
        const src = imageUrl(Number(row.id), styleKey, meta.id);
        host.innerHTML = `<div class="grv2-cell-image-box" style="width:${width}px"><img src="${src}" alt="셀 첨부 이미지" draggable="false">${editable ? '<button type="button" class="grv2-cell-image-delete" aria-label="이미지 삭제">×</button><span class="grv2-cell-image-resize" title="드래그하여 크기 조절"></span>' : ""}</div>`;
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
        const image = row?.cell_styles?.[styleKey]?.image;
        if (!image) {
          const styles = { ...(row?.cell_styles || {}) };
          styles[styleKey] = {};
          await api(`/group-review/rows/${rowId}`, { method: "PATCH", body: JSON.stringify({ cell_styles: styles }) });
        } else {
          const styles = { ...(row.cell_styles || {}) };
          styles[styleKey] = { image };
          await api(`/group-review/rows/${rowId}`, { method: "PATCH", body: JSON.stringify({ cell_styles: styles }) });
        }
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
    document.getElementById("grv2ImageLightbox")?.classList.remove("open");
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

  window.addEventListener("local-shared-pages-loaded", () => scheduleDecorate(100));
  [0, 200, 600, 1200].forEach(delay => setTimeout(() => scheduleDecorate(0), delay));
}
