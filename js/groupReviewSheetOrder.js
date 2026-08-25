export function installGroupReviewSheetOrder() {
  if (window.__grv2SheetOrderInstalled) return;
  window.__grv2SheetOrderInstalled = true;

  let timer = null;

  function normalizedName(tab) {
    return String(tab.textContent || '')
      .replace(/\s*·\s*나\s*$/g, '')
      .trim();
  }

  function applySheetOrder() {
    const host = document.querySelector('#groupReviewBody .grv2-tabs');
    if (!host) return;

    const tabs = Array.from(host.querySelectorAll(':scope > .grv2-tab[data-sheet-id]'));
    if (!tabs.length) return;

    const kimIndex = tabs.findIndex(tab => normalizedName(tab) === '김학년');
    const leeIndex = tabs.findIndex(tab => normalizedName(tab) === '이중근');

    tabs.forEach((tab, index) => {
      let order = index;
      if (index === kimIndex && leeIndex >= 0) order = leeIndex;
      else if (index === leeIndex && kimIndex >= 0) order = kimIndex;
      tab.style.order = String(order);
    });
  }

  function schedule(delay = 0) {
    clearTimeout(timer);
    timer = setTimeout(applySheetOrder, delay);
  }

  function start() {
    const body = document.getElementById('groupReviewBody');
    if (!body) {
      setTimeout(start, 100);
      return;
    }

    // 렌더링으로 탭 노드가 새로 생길 때만 order를 다시 계산한다.
    // DOM 노드 자체는 이동/교체하지 않아 기존 클릭 이벤트를 보존한다.
    const observer = new MutationObserver(mutations => {
      const tabsRebuilt = mutations.some(mutation => mutation.addedNodes.length || mutation.removedNodes.length);
      if (tabsRebuilt) schedule(0);
    });
    observer.observe(body, { childList: true, subtree: true });

    applySheetOrder();
    [50, 150].forEach(delay => setTimeout(() => schedule(0), delay));
  }

  start();
}
