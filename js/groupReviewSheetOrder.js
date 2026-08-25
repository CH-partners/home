export function installGroupReviewSheetOrder() {
  if (window.__grv2SheetOrderInstalled) return;
  window.__grv2SheetOrderInstalled = true;

  let timer = null;

  function swapNamedTabs() {
    const host = document.querySelector('#groupReviewBody .grv2-tabs');
    if (!host) return;

    const tabs = Array.from(host.querySelectorAll(':scope > .grv2-tab[data-sheet-id]'));
    const kim = tabs.find(tab => String(tab.textContent || '').replace(/\s*·\s*나\s*$/g, '').trim() === '김학년');
    const lee = tabs.find(tab => String(tab.textContent || '').replace(/\s*·\s*나\s*$/g, '').trim() === '이중근');
    if (!kim || !lee) return;

    const kimIndex = tabs.indexOf(kim);
    const leeIndex = tabs.indexOf(lee);
    if (kimIndex === leeIndex) return;

    const marker = document.createComment('grv2-sheet-order-swap');
    kim.replaceWith(marker);
    lee.replaceWith(kim);
    marker.replaceWith(lee);
  }

  function schedule(delay = 0) {
    clearTimeout(timer);
    timer = setTimeout(swapNamedTabs, delay);
  }

  function start() {
    const body = document.getElementById('groupReviewBody');
    if (!body) {
      setTimeout(start, 100);
      return;
    }

    const observer = new MutationObserver(() => schedule(0));
    observer.observe(body, { childList: true, subtree: true });
    [0, 50, 150, 400].forEach(delay => setTimeout(() => schedule(0), delay));
  }

  start();
}
