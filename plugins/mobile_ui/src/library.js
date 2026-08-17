export function createFeature() {
  const primarySelectors = [
    '#v3-songs-artist',
    '#v3-songs-album',
    '#v3-songs-sort',
    '#v3-songs-format',
    '#v3-songs-filters'
  ];
  const secondarySelectors = [
    '#v3-songs-grid-btn',
    '#v3-songs-tree-btn',
    '#v3-songs-albums-btn',
    '#v3-songs-folder-btn',
    '#v3-songs-select',
    '#v3-songs-refresh',
    '#v3-songs-refresh-meta',
    '#v3-songs-unmatched',
    '#v3-songs-upload'
  ];

  const summarySelectors = [
    '#v3-songs-artist',
    '#v3-songs-album',
    '#v3-songs-sort',
    '#v3-songs-format'
  ];

  let refineOpen = false;
  let moreOpen = false;
  let observer = null;
  let observerRoot = null;
  let pendingApply = 0;
  let selectListeners = [];
  let offlineReturnParent = null;
  let offlineReturnNextSibling = null;
  let touchLibraryActive = false;

  return {
    name: 'library',
    mount(ctx) {
      refresh(ctx);
    },
    refresh,
    unmount() {
      disconnectObserver();
      cleanup();
    }
  };

  function refresh(ctx) {
    if (ctx?.state?.disabled || !ctx?.state?.isV3 || ctx?.state?.screen !== 'library') {
      disconnectObserver();
      touchLibraryActive = false;
      cleanup(true);
      return;
    }

    touchLibraryActive = isTouchLibrary(ctx);
    applyToolbarClasses();
    connectObserver();
  }

  function applyToolbarClasses() {
    const toolbar = document.getElementById('v3-songs-toolbar');
    if (!toolbar) return;

    toolbar.classList.add('mobile-ui-library-toolbar');

    primarySelectors.forEach((selector) => {
      document.querySelector(selector)?.classList.add('mobile-ui-library-primary-control');
    });

    secondarySelectors.forEach((selector) => {
      document.querySelector(selector)?.classList.add('mobile-ui-library-secondary-control');
    });

    document.getElementById('v3-songs-offline')?.classList.remove('mobile-ui-library-secondary-control');

    const gridButton = document.getElementById('v3-songs-grid-btn');
    const viewGroup = gridButton?.parentElement;
    if (viewGroup) {
      viewGroup.classList.add('mobile-ui-library-secondary-control', 'mobile-ui-library-view-toggle-group');
    }

    const moreButton = ensureMoreButton(toolbar);
    const refineRow = ensureRefineRow(toolbar);
    bindSummaryListeners();
    updateSummary(refineRow);
    syncRefineState(toolbar, refineRow);
    syncMoreState(toolbar, moreButton);
    syncOfflineChip(refineRow, touchLibraryActive);
  }

  function ensureMoreButton(toolbar) {
    let button = document.getElementById('mobile-ui-library-more');
    if (!button) {
      button = document.createElement('button');
      button.id = 'mobile-ui-library-more';
      button.type = 'button';
      button.className = 'mobile-ui-library-more-toggle';
      button.setAttribute('aria-controls', 'v3-songs-toolbar');
      button.addEventListener('click', () => {
        moreOpen = !moreOpen;
        syncMoreState(toolbar, button);
      });

      const filters = document.getElementById('v3-songs-filters');
      if (filters?.parentElement) {
        filters.insertAdjacentElement('afterend', button);
      } else {
        toolbar.appendChild(button);
      }
    }

    return button;
  }

  function ensureRefineRow(toolbar) {
    let row = document.getElementById('mobile-ui-library-refine');
    if (!row) {
      row = document.createElement('div');
      row.id = 'mobile-ui-library-refine';
      row.className = 'mobile-ui-library-refine-row';
      row.innerHTML =
        '<div class="mobile-ui-library-refine-summary" aria-live="polite"></div>' +
        '<button id="mobile-ui-library-refine-toggle" type="button" class="mobile-ui-library-refine-toggle" aria-controls="v3-songs-toolbar" aria-expanded="false">Options</button>';

      const toggle = row.querySelector('#mobile-ui-library-refine-toggle');
      toggle?.addEventListener('click', () => {
        refineOpen = !refineOpen;
        if (!refineOpen) moreOpen = false;
        syncRefineState(toolbar, row);
        syncMoreState(toolbar, document.getElementById('mobile-ui-library-more'));
      });

      const toolbarBody = toolbar.firstElementChild;
      const countRow = toolbarBody?.firstElementChild;
      if (countRow?.parentElement) {
        countRow.insertAdjacentElement('afterend', row);
      } else {
        toolbar.prepend(row);
      }
    }

    return row;
  }

  function syncMoreState(toolbar, button) {
    toolbar.classList.toggle('mobile-ui-library-more-open', moreOpen);
    if (button) {
      button.setAttribute('aria-expanded', moreOpen ? 'true' : 'false');
      button.textContent = moreOpen ? 'Less' : 'More';
    }
  }

  function syncRefineState(toolbar, row) {
    toolbar.classList.toggle('mobile-ui-library-refine-open', refineOpen);

    const button = row?.querySelector('#mobile-ui-library-refine-toggle');
    if (button) {
      button.setAttribute('aria-expanded', refineOpen ? 'true' : 'false');
      button.textContent = refineOpen ? 'Hide' : 'Options';
    }
  }

  function updateSummary(row) {
    const summary = row?.querySelector('.mobile-ui-library-refine-summary');
    if (!summary) return;

    const artist = selectedText('#v3-songs-artist');
    const album = selectedText('#v3-songs-album');
    const sort = selectedText('#v3-songs-sort');
    const format = selectedText('#v3-songs-format');
    const parts = [artist];

    if (album && !/choose artist first|all albums/i.test(album)) {
      parts.push(album);
    }

    parts.push(sort, format);
    summary.textContent = parts.filter(Boolean).join(' · ') || 'Library filters';
  }

  function selectedText(selector) {
    const select = document.querySelector(selector);
    const option = select?.selectedOptions?.[0];
    return option?.textContent?.replace(/\s+/g, ' ').trim() || '';
  }

  function bindSummaryListeners() {
    removeSummaryListeners();

    summarySelectors.forEach((selector) => {
      const select = document.querySelector(selector);
      if (!select) return;
      const handler = () => updateSummary(document.getElementById('mobile-ui-library-refine'));
      select.addEventListener('change', handler);
      selectListeners.push(() => select.removeEventListener('change', handler));
    });
  }

  function removeSummaryListeners() {
    selectListeners.splice(0).forEach((remove) => remove());
  }

  function connectObserver() {
    const root = document.getElementById('v3-songs');
    if (!root || observerRoot === root) return;

    disconnectObserver();
    observerRoot = root;
    observer = new MutationObserver(() => {
      if (pendingApply) return;
      pendingApply = window.requestAnimationFrame(() => {
        pendingApply = 0;
        applyToolbarClasses();
      });
    });
    observer.observe(root, { childList: true });
  }

  function disconnectObserver() {
    if (pendingApply) {
      window.cancelAnimationFrame(pendingApply);
      pendingApply = 0;
    }

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    observerRoot = null;
  }

  function cleanup(resetState = false) {
    if (resetState) {
      refineOpen = false;
      moreOpen = false;
    }

    removeSummaryListeners();
    restoreOfflineButton();
    document.getElementById('mobile-ui-library-refine')?.remove();
    document.getElementById('mobile-ui-library-more')?.remove();
    document.getElementById('v3-songs-toolbar')?.classList.remove(
      'mobile-ui-library-toolbar',
      'mobile-ui-library-refine-open',
      'mobile-ui-library-more-open'
    );

    document.querySelectorAll(
      '.mobile-ui-library-primary-control, ' +
      '.mobile-ui-library-secondary-control, ' +
      '.mobile-ui-library-view-toggle-group'
    ).forEach((el) => {
      el.classList.remove(
        'mobile-ui-library-primary-control',
        'mobile-ui-library-secondary-control',
        'mobile-ui-library-view-toggle-group'
      );
    });
  }

  function isTouchLibrary(ctx) {
    const deviceClass = ctx?.state?.viewport?.deviceClass || ctx?.viewport?.deviceClass;
    return deviceClass === 'phone' || deviceClass === 'tablet';
  }

  function syncOfflineChip(refineRow, shouldMove) {
    const button = document.getElementById('v3-songs-offline');
    if (!button) {
      offlineReturnParent = null;
      offlineReturnNextSibling = null;
      return;
    }

    button.classList.remove('mobile-ui-library-secondary-control');

    if (!shouldMove || !refineRow) {
      restoreOfflineButton();
      return;
    }

    if (button.parentElement === refineRow) return;

    offlineReturnParent = button.parentElement;
    offlineReturnNextSibling = button.nextSibling;
    refineRow.appendChild(button);
  }

  function restoreOfflineButton() {
    const button = document.getElementById('v3-songs-offline');
    if (!button || !offlineReturnParent) {
      offlineReturnParent = null;
      offlineReturnNextSibling = null;
      return;
    }

    if (offlineReturnParent.isConnected) {
      if (offlineReturnNextSibling?.parentElement === offlineReturnParent) {
        offlineReturnParent.insertBefore(button, offlineReturnNextSibling);
      } else {
        offlineReturnParent.appendChild(button);
      }
    }

    offlineReturnParent = null;
    offlineReturnNextSibling = null;
  }
}
