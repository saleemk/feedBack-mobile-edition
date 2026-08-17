import { PLUGIN_ID } from './state.js';

let pendingFrame = 0;

export function openMobileUiPluginSettings() {
  openPluginSettings(PLUGIN_ID);
}

export function createFeature() {
  let root = null;
  let clickHandler = null;
  let keydownHandler = null;

  return {
    name: 'plugins',
    mount(ctx) {
      refresh(ctx);
    },
    refresh,
    unmount() {
      cleanup();
      cancelPendingFrame();
    }
  };

  function refresh(ctx) {
    if (
      ctx?.state?.disabled ||
      !ctx?.state?.isV3 ||
      ctx?.state?.screen !== 'plugins' ||
      ctx?.viewport?.deviceClass !== 'phone'
    ) {
      cleanup();
      return;
    }

    const nextRoot = document.getElementById('v3-plugins');
    if (!nextRoot || nextRoot === root) return;

    cleanup();
    root = nextRoot;
    clickHandler = (event) => handlePedalActivate(event, 'click');
    keydownHandler = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      handlePedalActivate(event, 'keyboard');
    };
    root.addEventListener('click', clickHandler, true);
    root.addEventListener('keydown', keydownHandler, true);
  }

  function handlePedalActivate(event, source) {
    if (!root || shouldIgnoreActivation(event.target)) return;

    const pedal = event.target?.closest?.('.v3-pedal[data-id]');
    if (!pedal || !root.contains(pedal)) return;

    const pluginId = pedal.getAttribute('data-id');
    if (!pluginId) return;

    event.preventDefault();
    event.stopPropagation();
    openPluginSettings(pluginId, source);
  }

  function shouldIgnoreActivation(target) {
    return !!target?.closest?.(
      '.v3-pedal-foot, [data-foot], .v3-board-title, [data-toggle], ' +
      '#v3-pedal-reset, #v3-open-inspector, button, a, input, select, textarea, label, summary'
    );
  }

  function cleanup() {
    if (root && clickHandler) {
      root.removeEventListener('click', clickHandler, true);
    }
    if (root && keydownHandler) {
      root.removeEventListener('keydown', keydownHandler, true);
    }

    root = null;
    clickHandler = null;
    keydownHandler = null;
  }
}

function openPluginSettings(pluginId) {
  cancelPendingFrame();

  if (typeof window.showScreen === 'function') {
    window.showScreen('settings');
  }

  setSettingsTab('plugins');
  focusPluginSettings(pluginId, 14);
}

function focusPluginSettings(pluginId, attemptsLeft) {
  cancelPendingFrame();

  const details = findPluginDetails(pluginId);
  if (details) {
    const panel = details.closest('#settings .fb-tabpanel[data-tab]');
    const tab = panel?.getAttribute('data-tab') || 'plugins';
    setSettingsTab(tab);
    details.open = true;
    try {
      details.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_) {
      details.scrollIntoView();
    }
    return;
  }

  if (attemptsLeft <= 0) return;
  pendingFrame = window.requestAnimationFrame(() => {
    pendingFrame = 0;
    focusPluginSettings(pluginId, attemptsLeft - 1);
  });
}

function findPluginDetails(pluginId) {
  const details = document.querySelectorAll('#settings details[data-plugin-id]');
  for (const item of details) {
    if (item.getAttribute('data-plugin-id') === pluginId) return item;
  }
  return null;
}

function setSettingsTab(tab) {
  const tabs = [...document.querySelectorAll('#settings-tabbar .fb-tab[data-tab]')];
  if (!tabs.length) return;

  const knownTabs = tabs.map((button) => button.getAttribute('data-tab'));
  const selected = knownTabs.includes(tab) ? tab : (knownTabs.includes('plugins') ? 'plugins' : knownTabs[0]);

  tabs.forEach((button) => {
    button.classList.toggle('active', button.getAttribute('data-tab') === selected);
  });
  document.querySelectorAll('#settings .fb-tabpanel[data-tab]').forEach((panel) => {
    panel.classList.toggle('active', panel.getAttribute('data-tab') === selected);
  });

  try {
    window.localStorage.setItem('v3-settings-tab', selected);
  } catch (_) {
    /* private mode */
  }
}

function cancelPendingFrame() {
  if (pendingFrame) {
    window.cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
  }
}
