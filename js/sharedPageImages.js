const API_ROOT = "/api/v1";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 120;

let activeContentKey = "";
let selectedBlock = null;
let dragState = null;

function editorRoot() {
  return document.querySelector("#contentEditor .ql-editor");
}

function editorQuill() {
  if (typeof Quill === "undefined") return null;
  const host = document.getElementById("contentEditor");
  if (!host) return null;
  try {
    const instance = Quill.find(host);
    return instance && typeof instance.insertEmbed === "function" ? instance : null;
  } catch (_) {
    return null;
  }
}

function modal() {
  return document.getElementById("contentModal");
}

function imageFileFromClipboard(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const item = items.find(candidate => candidate.kind === "file" && String(candidate.type || "").startsWith("image/"));
  return item?.getAsFile?.() || null;
}

function imageUrl(contentKey, imageId) {
  return `${API_ROOT}/shared-pages/contents/${encodeURIComponent(contentKey)}/images/${encodeURIComponent(imageId)}`;
}

function blockWidth(block) {
  const parsed = Number.parseInt(block.style.width || "", 10);
  return Number.isFinite(parsed) && parsed >= MIN_WIDTH ? parsed : DEFAULT_WIDTH;
}

function applyAlignmentStyle(block, align) {
  const next = ["left", "center", "right"].includes(align) ? align : "center";
  block.dataset.align = next;
  block.style.display = "block";
  if (next === "left") {
    block.style.margin = "12px auto 12px 0";
  } else if (next === "right") {
    block.style.margin = "12px 0 12px auto";
  } else {
    block.style.margin = "12px auto";
  }
}

function hydrateBlock(block) {
  if (!(block instanceof HTMLElement)) return;
  const imageId = block.dataset.imageId || "";
  const contentKey = block.dataset.contentKey || activeContentKey || "";
  if (!imageId || !contentKey) return;

  block.dataset.contentKey = contentKey;
  block.setAttribute("contenteditable", "false");
  if (!block.style.width) block.style.width = `${DEFAULT_WIDTH}px`;
  applyAlignmentStyle(block, block.dataset.align || "center");

  let image = block.querySelector("img");
  if (!image) {
    image = document.createElement("img");
    image.alt = "게시판 이미지";
    block.appendChild(image);
  }
  const expected = imageUrl(contentKey, imageId);
  if (!image.getAttribute("src") || !image.getAttribute("src").includes(`/images/${imageId}`)) {
    image.src = expected;
  }
  image.alt = image.alt || "게시판 이미지";
  image.draggable = false;
}

function hydrateEditorImages() {
  editorRoot()?.querySelectorAll(".board-image-block").forEach(hydrateBlock);
}

function registerBoardImageBlot() {
  if (typeof Quill === "undefined" || window.__boardImageBlotRegistered) return;
  const BlockEmbed = Quill.import("blots/block/embed");

  class BoardImageBlot extends BlockEmbed {
    static create(value = {}) {
      const node = super.create();
      node.dataset.imageId = String(value.id || "");
      node.dataset.contentKey = String(value.contentKey || "");
      node.dataset.align = String(value.align || "center");
      node.style.width = `${Math.max(MIN_WIDTH, Number(value.width) || DEFAULT_WIDTH)}px`;
      applyAlignmentStyle(node, node.dataset.align);

      const image = document.createElement("img");
      image.src = String(value.url || imageUrl(node.dataset.contentKey, node.dataset.imageId));
      image.alt = "게시판 이미지";
      image.draggable = false;
      node.appendChild(image);
      return node;
    }

    static value(node) {
      const image = node.querySelector("img");
      return {
        id: node.dataset.imageId || "",
        contentKey: node.dataset.contentKey || "",
        align: node.dataset.align || "center",
        width: blockWidth(node),
        url: image?.getAttribute("src") || ""
      };
    }

    format(name, value) {
      if (name === "width") {
        const width = Math.max(MIN_WIDTH, Number(value) || DEFAULT_WIDTH);
        this.domNode.style.width = `${Math.round(width)}px`;
        return;
      }
      if (name === "align") {
        applyAlignmentStyle(this.domNode, String(value || "center"));
        return;
      }
      super.format(name, value);
    }
  }

  BoardImageBlot.blotName = "boardImage";
  BoardImageBlot.tagName = "div";
  BoardImageBlot.className = "board-image-block";
  Quill.register(BoardImageBlot, true);
  window.__boardImageBlotRegistered = true;
}

async function uploadImage(contentKey, file) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("PNG, JPG, WebP 이미지만 사용할 수 있습니다.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("이미지는 10MB 이하만 사용할 수 있습니다.");
  }

  const response = await fetch(`${API_ROOT}/shared-pages/contents/${encodeURIComponent(contentKey)}/images`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/octet-stream" },
    body: file
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`);
  return data;
}

async function deleteImage(contentKey, imageId) {
  const response = await fetch(`${API_ROOT}/shared-pages/contents/${encodeURIComponent(contentKey)}/images/${encodeURIComponent(imageId)}`, {
    method: "DELETE",
    credentials: "include"
  });
  if (!response.ok && response.status !== 404) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.detail || `HTTP ${response.status}`);
  }
}

function setAlignment(block, align) {
  const next = ["left", "center", "right"].includes(align) ? align : "center";
  const quill = editorQuill();
  let formatted = false;
  if (quill && typeof Quill !== "undefined") {
    try {
      const blot = Quill.find(block);
      if (blot && typeof blot.format === "function") {
        blot.format("align", next);
        quill.update("user");
        formatted = true;
      }
    } catch (_) {}
  }
  if (!formatted) applyAlignmentStyle(block, next);
  updateToolbar();
}

function clearSelection() {
  selectedBlock?.classList.remove("board-image-selected");
  selectedBlock = null;
  updateToolbar();
}

function selectBlock(block) {
  if (selectedBlock === block) return updateToolbar();
  selectedBlock?.classList.remove("board-image-selected");
  selectedBlock = block;
  selectedBlock.classList.add("board-image-selected");
  updateToolbar();
}

function toolbar() {
  let bar = document.getElementById("boardImageToolbar");
  if (bar) return bar;
  const host = document.getElementById("contentEditor");
  if (!host?.parentElement) return null;

  bar = document.createElement("div");
  bar.id = "boardImageToolbar";
  bar.innerHTML = `
    <span class="board-image-toolbar-label">이미지</span>
    <button type="button" data-image-align="left">왼쪽</button>
    <button type="button" data-image-align="center">가운데</button>
    <button type="button" data-image-align="right">오른쪽</button>
    <button type="button" data-image-delete="1" class="danger">삭제</button>
    <span class="board-image-toolbar-hint">위치는 왼쪽·가운데·오른쪽으로 조절하고, 우측 아래 모서리를 드래그하면 크기를 조절할 수 있습니다.</span>
  `;
  host.parentElement.insertBefore(bar, host);

  bar.addEventListener("click", async event => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || !selectedBlock) return;
    const align = button.dataset.imageAlign;
    if (align) {
      setAlignment(selectedBlock, align);
      return;
    }
    if (!button.dataset.imageDelete) return;

    const block = selectedBlock;
    const contentKey = block.dataset.contentKey || activeContentKey;
    const imageId = block.dataset.imageId || "";
    if (!contentKey || !imageId || !confirm("이 이미지를 삭제할까요?")) return;
    button.disabled = true;
    try {
      await deleteImage(contentKey, imageId);
      const quill = editorQuill();
      let removed = false;
      if (quill && typeof Quill !== "undefined") {
        try {
          const blot = Quill.find(block);
          if (blot && typeof blot.remove === "function") {
            blot.remove();
            quill.update("user");
            removed = true;
          }
        } catch (_) {}
      }
      if (!removed) block.remove();
      clearSelection();
    } catch (error) {
      alert(`이미지 삭제 실패: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  });
  return bar;
}

function updateToolbar() {
  const bar = toolbar();
  if (!bar) return;
  bar.classList.toggle("visible", Boolean(selectedBlock));
  const align = selectedBlock?.dataset.align || "center";
  bar.querySelectorAll("[data-image-align]").forEach(button => {
    button.classList.toggle("active", button.dataset.imageAlign === align);
  });
}

function ensureStyles() {
  if (document.getElementById("board-image-editor-styles")) return;
  const style = document.createElement("style");
  style.id = "board-image-editor-styles";
  style.textContent = `
    #boardImageToolbar{display:none;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 8px;padding:7px 9px;border:1px solid #dbe2ea;border-radius:8px;background:#f8fafc}
    #boardImageToolbar.visible{display:flex}
    #boardImageToolbar button{height:30px;padding:0 9px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#334155;font-size:12px;font-weight:700;cursor:pointer}
    #boardImageToolbar button.active{border-color:#2563eb;background:#dbeafe;color:#1d4ed8}
    #boardImageToolbar button.danger{border-color:#fecaca;color:#b91c1c}
    #boardImageToolbar .board-image-toolbar-label{font-size:12px;font-weight:800;color:#334155;margin-right:2px}
    #boardImageToolbar .board-image-toolbar-hint{font-size:11px;color:#64748b;margin-left:4px}
    #contentEditor .ql-editor .board-image-block{position:relative;box-sizing:border-box;max-width:100%;min-width:${MIN_WIDTH}px;padding:0;line-height:0}
    #contentEditor .ql-editor .board-image-block img{display:block;width:100%;height:auto;max-width:100%;user-select:none;-webkit-user-drag:none}
    #contentEditor .ql-editor .board-image-block.board-image-selected{outline:2px solid #2563eb;outline-offset:2px}
    #contentEditor .ql-editor .board-image-block.board-image-selected::after{content:"";position:absolute;right:-6px;bottom:-6px;width:13px;height:13px;border:2px solid #fff;border-radius:2px;background:#2563eb;box-shadow:0 0 0 1px #1d4ed8;cursor:nwse-resize}
    .rich-preview .board-image-block{display:block;box-sizing:border-box;max-width:100%;padding:0;line-height:0}
    .rich-preview .board-image-block img{display:block;width:100%;height:auto;max-width:100%}
  `;
  document.head.appendChild(style);
}

function insertBlock(root, quill, insertionIndex, upload) {
  if (quill) {
    const index = Math.max(0, Math.min(Number(insertionIndex) || 0, Math.max(0, quill.getLength() - 1)));
    quill.insertEmbed(index, "boardImage", {
      id: upload.id,
      contentKey: activeContentKey,
      align: "center",
      width: DEFAULT_WIDTH,
      url: upload.url || imageUrl(activeContentKey, upload.id)
    }, "user");
    quill.insertText(index + 1, "\n", "user");
    quill.setSelection(index + 2, 0, "silent");
    quill.update("user");
    const block = Array.from(root.querySelectorAll(".board-image-block"))
      .find(node => node.dataset.imageId === upload.id);
    if (block) {
      hydrateBlock(block);
      selectBlock(block);
    }
    return;
  }

  const block = document.createElement("div");
  block.className = "board-image-block";
  block.dataset.imageId = upload.id;
  block.dataset.contentKey = activeContentKey;
  block.dataset.align = "center";
  block.setAttribute("contenteditable", "false");
  block.style.width = `${DEFAULT_WIDTH}px`;
  applyAlignmentStyle(block, "center");

  const image = document.createElement("img");
  image.src = upload.url || imageUrl(activeContentKey, upload.id);
  image.alt = "게시판 이미지";
  image.draggable = false;
  block.appendChild(image);

  const spacer = document.createElement("p");
  spacer.innerHTML = "<br>";
  root.append(block, spacer);
  root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
  selectBlock(block);
}

function pointerNearResizeCorner(block, event) {
  const rect = block.getBoundingClientRect();
  return event.clientX >= rect.right - 20 && event.clientY >= rect.bottom - 20;
}

function beginResize(block, event) {
  const root = editorRoot();
  if (!root) return;
  event.preventDefault();
  event.stopPropagation();
  selectBlock(block);

  const rect = block.getBoundingClientRect();
  const maxWidth = Math.max(MIN_WIDTH, root.clientWidth - 8);
  dragState = {
    block,
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: rect.width,
    maxWidth
  };
  try { block.setPointerCapture(event.pointerId); } catch (_) {}
}

function moveResize(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const width = Math.max(MIN_WIDTH, Math.min(dragState.maxWidth, dragState.startWidth + event.clientX - dragState.startX));
  dragState.block.style.width = `${Math.round(width)}px`;
}

function endResize(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const block = dragState.block;
  const width = blockWidth(block);
  try { block.releasePointerCapture(event.pointerId); } catch (_) {}
  dragState = null;

  const quill = editorQuill();
  let formatted = false;
  if (quill && typeof Quill !== "undefined") {
    try {
      const blot = Quill.find(block);
      if (blot && typeof blot.format === "function") {
        blot.format("width", width);
        quill.update("user");
        formatted = true;
      }
    } catch (_) {}
  }
  if (!formatted) {
    editorRoot()?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "formatSetBlockTextDirection" }));
  }
}

function bindEvents() {
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const editButton = target.closest(".local-shared-edit-btn[data-local-shared-content-key]");
    if (editButton) {
      activeContentKey = editButton.dataset.localSharedContentKey || "";
      clearSelection();
      queueMicrotask(() => {
        hydrateEditorImages();
        toolbar();
      });
      requestAnimationFrame(hydrateEditorImages);
      return;
    }

    const block = target.closest("#contentEditor .ql-editor .board-image-block");
    if (block) {
      hydrateBlock(block);
      selectBlock(block);
      return;
    }

    if (target.closest("#boardImageToolbar")) return;
    if (modal()?.classList.contains("show")) clearSelection();
  }, true);

  document.addEventListener("paste", async event => {
    const root = editorRoot();
    const target = event.target instanceof Element ? event.target : null;
    if (!root || !target || !root.contains(target) || !activeContentKey) return;
    const file = imageFileFromClipboard(event);
    if (!file) return;

    event.preventDefault();
    event.stopPropagation();

    const quill = editorQuill();
    const insertionIndex = quill?.getSelection(true)?.index ?? Math.max(0, (quill?.getLength?.() || 1) - 1);
    try {
      const upload = await uploadImage(activeContentKey, file);
      insertBlock(root, quill, insertionIndex, upload);
    } catch (error) {
      alert(`이미지 붙여넣기 실패: ${error.message}`);
    }
  }, true);

  document.addEventListener("pointerdown", event => {
    const target = event.target instanceof Element ? event.target : null;
    const block = target?.closest?.("#contentEditor .ql-editor .board-image-block");
    if (!block || !pointerNearResizeCorner(block, event)) return;
    beginResize(block, event);
  }, true);

  document.addEventListener("pointermove", moveResize, true);
  document.addEventListener("pointerup", endResize, true);
  document.addEventListener("pointercancel", endResize, true);

  const observer = new MutationObserver(() => {
    const active = modal()?.classList.contains("show");
    if (!active) {
      activeContentKey = "";
      clearSelection();
      return;
    }
    hydrateEditorImages();
  });
  const contentModal = modal();
  if (contentModal) observer.observe(contentModal, { attributes: true, attributeFilter: ["class"] });
}

registerBoardImageBlot();
ensureStyles();
toolbar();
bindEvents();
