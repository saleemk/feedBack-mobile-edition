let _slider = null;
let _cluster = null;
let _peekTimer = null;

// Core v3 compatibility points. Keep these centralized because Mobile UI uses
// existing core/player DOM as action targets instead of reimplementing controls.
const SELECTORS = {
  player: '#player',
  controls: '#player-controls',
  speedSlider: '#player-controls .v3-speed-slider',
  speedCluster: '.v3-speed-cluster',
  playButton: '#btn-play',
  rail: '#v3-player-rail',
  railPop: '#v3-railzone .v3-rail-pop',
  pluginControlsSlot: '#v3-plugin-controls-slot',
  stemMixerPanel: '#stem-mixer-panel',
  arrangementSelect: '#arr-select',
  difficultySlider: '#mastery-slider',
  difficultyLabel: '#mastery-label',
  practiceControl: '#section-practice-control',
  practiceBar: '#section-practice-bar',
  practicePill: '#section-practice-pill'
};

const _missingActionTargets = new Set();

const ACTION_SURFACE_SELECTORS = [
  '.mobile-ui-player-controls-trigger',
  '.mobile-ui-player-controls-picker',
  '.mobile-ui-player-quick-settings',
  '.mobile-ui-player-landscape-controls',
  '.mobile-ui-player-tablet-controls',
  SELECTORS.rail,
  SELECTORS.railPop,
  SELECTORS.pluginControlsSlot,
  SELECTORS.stemMixerPanel,
  SELECTORS.practiceControl,
  SELECTORS.practiceBar,
  SELECTORS.practicePill,
  '#mixer-popover'
];

const ACTION_SURFACE_GUARD_SELECTORS = [
  '.mobile-ui-player-controls-trigger',
  '.mobile-ui-player-quick-settings',
  '.mobile-ui-player-landscape-controls',
  '.mobile-ui-player-tablet-controls',
  SELECTORS.railPop,
  SELECTORS.pluginControlsSlot,
  SELECTORS.stemMixerPanel,
  SELECTORS.practiceControl,
  SELECTORS.practiceBar,
  '#mixer-popover'
];

function _isDebugEnabled() {
  try { return window.localStorage.getItem('mobile_ui.debug') === '1'; } catch (_) { return false; }
}

function _debugMissingActionTarget(action) {
  if (!_isDebugEnabled() || !action || _missingActionTargets.has(action.selector)) return;
  _missingActionTargets.add(action.selector);
  console.warn('[mobile_ui] Player action target missing', {
    label: action.label,
    selector: action.selector
  });
}

function _queryActionTarget(action) {
  const btn = document.querySelector(action.selector);
  if (!btn) _debugMissingActionTarget(action);
  return btn;
}

function _handleInput() {
  if (!_slider || !_cluster) return;
  const value = Number(_slider.value).toFixed(2) + 'x';
  _cluster.setAttribute('data-mobile-speed-value', value);
  _cluster.classList.add('mobile-ui-speed-peek');
  clearTimeout(_peekTimer);
  _peekTimer = setTimeout(() => {
    _cluster.classList.remove('mobile-ui-speed-peek');
    _peekTimer = null;
  }, 1000);
}

function _bind() {
  if (_slider) return;
  // Core exposes the speed input via .v3-speed-slider; the visible label is
  // separate and hidden by CSS in touch modes.
  _slider = document.querySelector(SELECTORS.speedSlider);
  if (!_slider) return;
  _cluster = _slider.closest(SELECTORS.speedCluster);
  _slider.addEventListener('input', _handleInput);
}

function _unbind() {
  if (_slider) {
    _slider.removeEventListener('input', _handleInput);
    _slider = null;
  }
  clearTimeout(_peekTimer);
  _peekTimer = null;
  if (_cluster) {
    _cluster.classList.remove('mobile-ui-speed-peek');
    _cluster.removeAttribute('data-mobile-speed-value');
    _cluster = null;
  }
}

function _isPlayerMobileSpeedScope(state) {
  if (state?.screen !== 'player' || !state?.isV3) return false;
  const vp = state?.viewport;
  if (!vp) return false;
  return _isPlayerTouchDevice(state) || _isPlayerLowHeightLandscape(state);
}

// ── Mobile Controls button + category picker ──────────────────────────────
// Rail actions depend on core v3 rail buttons staying in the DOM. CSS may hide
// the old rail visually in touch modes, but JS still clicks these core targets.
// Practice is special: it is not a normal .v3-rail-pop rail panel.

const MORE_ACTIONS = [
  { label: 'Visuals',  selector: SELECTORS.rail + ' [data-rail="viz"]' },
  { label: 'Audio',    selector: SELECTORS.rail + ' [data-rail="audio"]' },
  { label: 'Mixer',    selector: SELECTORS.rail + ' [data-rail="mixer"]', nestedSelector: '#btn-mixer' },
  { label: 'Lyrics',   selector: SELECTORS.rail + ' [data-rail-action="lyrics"]', toggle: true },
  { label: 'Plugins',  selector: SELECTORS.rail + ' [data-rail="plugins"]' },
  { label: 'Practice', selector: SELECTORS.practicePill },
  { label: 'Advanced', selector: SELECTORS.rail + ' [data-rail="advanced"]' },
];

let _controlsBtn = null;
let _controlsPicker = null;
let _controlsOpen = false;
let _activeAction = null;
let _actionClickInProgress = false;
let _landscapeControls = null;
let _tabletControls = null;
let _libraryButton = null;
let _guardedActionSurfaces = new Set();
let _stemMixerDiscoveryObserver = null;
let _stemMixerPanelObserver = null;
let _stemMixerSyncFrame = null;
let _stemMixerPanel = null;
let _stemMixerState = null;
let _quickSettings = null;
let _quickSettingsMode = null;
let _quickArrangement = null;
let _quickDifficulty = null;
let _quickDifficultyValue = null;
let _quickSettingsSource = null;
let _quickSettingsFeedBackListeners = null;
let _quickSettingsTimers = [];
let _quickSettingsSyncing = false;
let _speedPlaceholder = null;
let _speedScrollParent = null;

function _showPicker() {
  if (!_controlsPicker) return;
  _controlsPicker.hidden = false;
  _controlsOpen = true;
  _syncToggleChips();
  _restoreSelection();
}

function _hidePicker() {
  if (!_controlsPicker) return;
  _closeSheets();
  _controlsPicker.hidden = true;
  _controlsOpen = false;
  _activeAction = null;
  _clearSelection();
}

function _togglePicker(e) {
  e.stopPropagation();
  if (_controlsOpen) { _hidePicker(); } else { _openPicker(); }
}

function _openPicker() {
  if (_getPauseOnMoreOpen() && window.feedBack && window.feedBack.isPlaying) {
    var playBtn = document.querySelector(SELECTORS.playButton);
    if (playBtn) playBtn.click();
  }
  _showPicker();
}

function _getPauseOnMoreOpen() {
  try { return window.localStorage.getItem('mobile_ui.pauseOnMoreOpen') === '1'; } catch (_) { return false; }
}

function _isBtnActive(btn) {
  return btn.classList.contains('is-active') || btn.getAttribute('aria-expanded') === 'true';
}

function _clickActionButton(btn) {
  _actionClickInProgress = true;
  try {
    btn.click();
  } finally {
    _actionClickInProgress = false;
  }
}

function _exitPlayerToLibrary() {
  if (window.feedBack && typeof window.feedBack.requestExitSong === 'function') {
    window.feedBack.requestExitSong();
  } else if (_isDebugEnabled()) {
    console.warn('[mobile_ui] Player Library action target missing', {
      target: 'window.feedBack.requestExitSong'
    });
  }
}

function _isNestedActionOpen(action) {
  if (!action?.nestedSelector) return false;
  const btn = document.querySelector(action.nestedSelector);
  return !!btn && (btn.getAttribute('aria-expanded') === 'true' || btn.classList.contains('is-active'));
}

function _openNestedAction(action) {
  if (!action?.nestedSelector || _isNestedActionOpen(action)) return;
  const btn = document.querySelector(action.nestedSelector);
  if (btn) _clickActionButton(btn);
}

function _closeNestedAction(action) {
  if (!action?.nestedSelector || !_isNestedActionOpen(action)) return;
  const btn = document.querySelector(action.nestedSelector);
  if (btn) _clickActionButton(btn);
}

function _openCategory(action) {
  _ensureActionSurfaceGuards();
  if (typeof action?.fn === 'function') {
    action.fn();
    return;
  }
  const btn = _queryActionTarget(action);
  if (!btn) return;
  if (action.toggle) {
    _clickActionButton(btn);
    _syncToggleChips();
    return;
  }
  // If tapping the already-active action, toggle the sheet closed.
  if (_activeAction === action && _isBtnActive(btn)) {
    _closeNestedAction(action);
    _clickActionButton(btn);
    _activeAction = null;
    _clearSelection();
    return;
  }
  // Switch to new action: close previous sheet, open new one.
  _closeSheets();
  _clickActionButton(btn);
  _openNestedAction(action);
  _ensureActionSurfaceGuards();
  _activeAction = action;
  _selectAction(action);
}

function _closeSheets() {
  if (!_activeAction) return;
  _closeNestedAction(_activeAction);
  const btn = _queryActionTarget(_activeAction);
  if (btn && _isBtnActive(btn)) _clickActionButton(btn);
  _activeAction = null;
}

function _selectAction(action) {
  _clearSelection();
  const index = MORE_ACTIONS.indexOf(action);
  if (index < 0) return;
  document.querySelectorAll('[data-mobile-ui-player-action="' + index + '"]').forEach(function (chip) {
    chip.classList.add('is-selected');
  });
}

function _clearSelection() {
  document.querySelectorAll('.mobile-ui-player-controls-option.is-selected, .mobile-ui-player-landscape-chip.is-selected, .mobile-ui-player-tablet-chip.is-selected').forEach(function (c) {
    c.classList.remove('is-selected');
  });
}

function _restoreSelection() {
  if (_activeAction) _selectAction(_activeAction);
}

function _syncToggleChips() {
  MORE_ACTIONS.forEach(function (action, i) {
    if (!action.toggle) return;
    const btn = _queryActionTarget(action);
    const active = btn && (btn.classList.contains('is-active') || btn.getAttribute('aria-pressed') === 'true');
    document.querySelectorAll('[data-mobile-ui-player-action="' + i + '"]').forEach(function (chip) {
      chip.classList.toggle('is-active', !!active);
    });
  });
}

function _createActionButton(action, index, className) {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  const actionIndex = MORE_ACTIONS.indexOf(action);
  button.dataset.mobileUiPlayerAction = actionIndex >= 0 ? String(actionIndex) : action.label.toLowerCase();
  button.textContent = action.label;
  button.addEventListener('click', function (e) {
    e.stopPropagation();
    _openCategory(action);
  });
  return button;
}

function _removeNode(node) {
  if (node) node.remove();
}

function _getQuickSettingsSource() {
  return {
    arrangement: document.querySelector(SELECTORS.arrangementSelect),
    difficulty: document.querySelector(SELECTORS.difficultySlider),
    difficultyLabel: document.querySelector(SELECTORS.difficultyLabel)
  };
}

function _formatDifficultyValue(value, sourceLabel) {
  const text = (sourceLabel?.textContent || '').trim();
  if (text) return text;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) + '%' : '';
}

function _copyArrangementOptions(source, target) {
  if (!target) return;
  target.textContent = '';
  if (!source) {
    target.disabled = true;
    return;
  }
  const selected = source.value;
  Array.from(source.options || []).forEach(function (option) {
    target.appendChild(option.cloneNode(true));
  });
  target.value = selected;
  target.disabled = !!source.disabled || !target.options.length;
}

function _syncQuickSettingsFromCore() {
  if (!_quickSettings) return;
  const source = _getQuickSettingsSource();
  _bindQuickSettingsSourceListeners(source);
  _quickSettingsSyncing = true;
  try {
    if (_quickArrangement) {
      _copyArrangementOptions(source.arrangement, _quickArrangement);
      _quickArrangement.disabled = !source.arrangement || !!source.arrangement.disabled;
    }
    if (_quickDifficulty) {
      if (source.difficulty) {
        ['min', 'max', 'step'].forEach(function (attr) {
          const value = source.difficulty.getAttribute(attr);
          if (value !== null) _quickDifficulty.setAttribute(attr, value);
        });
        _quickDifficulty.value = source.difficulty.value;
        _quickDifficulty.disabled = !!source.difficulty.disabled;
        if (_quickDifficultyValue) {
          _quickDifficultyValue.textContent = _formatDifficultyValue(source.difficulty.value, source.difficultyLabel);
        }
      } else {
        _quickDifficulty.disabled = true;
        if (_quickDifficultyValue) _quickDifficultyValue.textContent = '';
      }
    }
  } finally {
    _quickSettingsSyncing = false;
  }
}

function _dispatchNativeEvent(el, type) {
  if (!el) return;
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

function _onQuickArrangementChange(e) {
  if (_quickSettingsSyncing) return;
  const source = document.querySelector(SELECTORS.arrangementSelect);
  if (!source) return;
  source.value = e.currentTarget.value;
  _dispatchNativeEvent(source, 'change');
  _scheduleQuickSettingsSync();
}

function _onQuickDifficultyInput(e) {
  if (_quickSettingsSyncing) return;
  const source = document.querySelector(SELECTORS.difficultySlider);
  if (!source) return;
  source.value = e.currentTarget.value;
  _dispatchNativeEvent(source, 'input');
  const label = document.querySelector(SELECTORS.difficultyLabel);
  if (_quickDifficultyValue) {
    _quickDifficultyValue.textContent = _formatDifficultyValue(source.value, label);
  }
}

function _createQuickSettings(mode) {
  const wrapper = document.createElement('div');
  wrapper.className = 'mobile-ui-player-quick-settings';
  wrapper.dataset.mobileUiQuickSettingsMode = mode;
  wrapper.setAttribute('data-v3-native', '');
  wrapper.addEventListener('click', function (e) { e.stopPropagation(); });

  const arrangementLabel = document.createElement('label');
  arrangementLabel.className = 'mobile-ui-player-arrangement';
  const arrangementText = document.createElement('span');
  arrangementText.className = 'mobile-ui-player-quick-settings-label';
  arrangementText.textContent = 'Arrangement';
  const arrangement = document.createElement('select');
  arrangement.className = 'mobile-ui-player-arrangement-select';
  arrangement.setAttribute('aria-label', 'Arrangement');
  arrangement.addEventListener('change', _onQuickArrangementChange);
  arrangementLabel.append(arrangementText, arrangement);

  const difficultyLabel = document.createElement('label');
  difficultyLabel.className = 'mobile-ui-player-difficulty';
  const difficultyText = document.createElement('span');
  difficultyText.className = 'mobile-ui-player-quick-settings-label';
  difficultyText.textContent = 'Difficulty';
  const difficulty = document.createElement('input');
  difficulty.className = 'mobile-ui-player-difficulty-slider';
  difficulty.type = 'range';
  difficulty.setAttribute('aria-label', 'Difficulty');
  difficulty.addEventListener('input', _onQuickDifficultyInput);
  difficulty.addEventListener('change', _scheduleQuickSettingsSync);
  const difficultyValue = document.createElement('output');
  difficultyValue.className = 'mobile-ui-player-difficulty-value';
  difficultyLabel.append(difficultyText, difficulty, difficultyValue);

  wrapper.append(arrangementLabel, difficultyLabel);
  _quickSettings = wrapper;
  _quickSettingsMode = mode;
  _quickArrangement = arrangement;
  _quickDifficulty = difficulty;
  _quickDifficultyValue = difficultyValue;
  return wrapper;
}

function _ensureQuickSettings(parent, mode, beforeNode) {
  if (!parent) return null;
  if (!_quickSettings || !_quickSettings.isConnected || _quickSettingsMode !== mode) {
    _removeQuickSettings();
    _createQuickSettings(mode);
  }
  if (_quickSettings.parentElement !== parent) {
    if (beforeNode && beforeNode.parentElement === parent) parent.insertBefore(_quickSettings, beforeNode);
    else parent.appendChild(_quickSettings);
  } else if (beforeNode && beforeNode.parentElement === parent && _quickSettings !== beforeNode && _quickSettings.nextSibling !== beforeNode) {
    parent.insertBefore(_quickSettings, beforeNode);
  }
  _installQuickSettingsFeedBackSync();
  _syncQuickSettingsFromCore();
  return _quickSettings;
}

function _unbindQuickSettingsSourceListeners() {
  if (_quickSettingsSource) {
    if (_quickSettingsSource.arrangement) _quickSettingsSource.arrangement.removeEventListener('change', _syncQuickSettingsFromCore);
    if (_quickSettingsSource.difficulty) {
      _quickSettingsSource.difficulty.removeEventListener('input', _syncQuickSettingsFromCore);
    }
  }
  _quickSettingsSource = null;
}

function _bindQuickSettingsSourceListeners(source) {
  if (_quickSettingsSource &&
      _quickSettingsSource.arrangement === source.arrangement &&
      _quickSettingsSource.difficulty === source.difficulty &&
      _quickSettingsSource.difficultyLabel === source.difficultyLabel) {
    return;
  }
  _unbindQuickSettingsSourceListeners();
  _quickSettingsSource = source;
  if (source.arrangement) source.arrangement.addEventListener('change', _syncQuickSettingsFromCore);
  if (source.difficulty) {
    source.difficulty.addEventListener('input', _syncQuickSettingsFromCore);
  }
}

function _scheduleQuickSettingsSync() {
  _clearQuickSettingsTimers();
  [0, 120, 450].forEach(function (ms) {
    _quickSettingsTimers.push(setTimeout(_syncQuickSettingsFromCore, ms));
  });
}

function _clearQuickSettingsTimers() {
  _quickSettingsTimers.forEach(clearTimeout);
  _quickSettingsTimers = [];
}

function _installQuickSettingsFeedBackSync() {
  if (_quickSettingsFeedBackListeners) return;
  const fb = window.feedBack;
  if (!fb || !fb.on) return;
  _quickSettingsFeedBackListeners = [
    { event: 'song:loaded', fn: _scheduleQuickSettingsSync },
    { event: 'song:ready', fn: _scheduleQuickSettingsSync }
  ];
  _quickSettingsFeedBackListeners.forEach(function (listener) {
    fb.on(listener.event, listener.fn);
  });
}

function _uninstallQuickSettingsFeedBackSync() {
  if (!_quickSettingsFeedBackListeners) return;
  const fb = window.feedBack;
  _quickSettingsFeedBackListeners.forEach(function (listener) {
    if (fb && fb.off) fb.off(listener.event, listener.fn);
  });
  _quickSettingsFeedBackListeners = null;
}

function _removeQuickSettings() {
  _clearQuickSettingsTimers();
  _unbindQuickSettingsSourceListeners();
  _uninstallQuickSettingsFeedBackSync();
  _removeNode(_quickSettings);
  _quickSettings = null;
  _quickSettingsMode = null;
  _quickArrangement = null;
  _quickDifficulty = null;
  _quickDifficultyValue = null;
}

function _removeQuickSettingsIn(container) {
  if (_quickSettings && container && container.contains(_quickSettings)) _removeQuickSettings();
}

function _getSpeedCluster() {
  const slider = document.querySelector(SELECTORS.speedSlider);
  return slider ? slider.closest(SELECTORS.speedCluster) : null;
}

function _findSpeedScrollAnchor(parent, cluster) {
  if (!parent) return null;
  const children = Array.from(parent.children);
  return children.find(function (child) {
    return child !== cluster && child.classList.contains('mobile-ui-player-quick-settings');
  }) || children.find(function (child) {
    return child !== cluster && child.hasAttribute('data-mobile-ui-player-action');
  }) || children.find(function (child) {
    return child !== cluster;
  }) || null;
}

function _moveSpeedClusterInto(parent) {
  if (!parent) return null;
  const cluster = _getSpeedCluster();
  if (!cluster) return null;
  if (!_speedPlaceholder) {
    _speedPlaceholder = document.createComment('mobile-ui-speed-origin');
  }
  if (!_speedPlaceholder.isConnected && cluster.parentNode) {
    cluster.parentNode.insertBefore(_speedPlaceholder, cluster);
  }
  const anchor = _findSpeedScrollAnchor(parent, cluster);
  if (anchor && (cluster.parentElement !== parent || cluster.nextElementSibling !== anchor)) {
    parent.insertBefore(cluster, anchor);
  } else if (!anchor && cluster.parentElement !== parent) {
    parent.appendChild(cluster);
  }
  if (_speedScrollParent && _speedScrollParent !== parent) {
    _speedScrollParent.classList.remove('mobile-ui-player-speed-scroll-strip');
  }
  parent.classList.add('mobile-ui-player-speed-scroll-strip');
  _speedScrollParent = parent;
  cluster.classList.add('mobile-ui-player-speed-in-scroll');
  return cluster;
}

function _restoreSpeedCluster() {
  const cluster = _getSpeedCluster();
  if (cluster) cluster.classList.remove('mobile-ui-player-speed-in-scroll');
  if (_speedScrollParent) {
    _speedScrollParent.classList.remove('mobile-ui-player-speed-scroll-strip');
    _speedScrollParent = null;
  }
  if (_speedPlaceholder && _speedPlaceholder.isConnected && cluster && cluster !== _speedPlaceholder.nextSibling) {
    _speedPlaceholder.parentNode.insertBefore(cluster, _speedPlaceholder);
  }
  _removeNode(_speedPlaceholder);
  _speedPlaceholder = null;
}

function _isInsidePlayerActionSurface(target) {
  return !!target?.closest?.(ACTION_SURFACE_SELECTORS.join(','));
}

function _stopActionSurfaceClick(e) {
  if (_isInsidePlayerActionSurface(e.target)) e.stopPropagation();
}

function _guardActionSurface(surface) {
  if (!surface || _guardedActionSurfaces.has(surface)) return;
  surface.addEventListener('click', _stopActionSurfaceClick);
  _guardedActionSurfaces.add(surface);
}

function _unguardActionSurface(surface) {
  if (!surface || !_guardedActionSurfaces.has(surface)) return;
  surface.removeEventListener('click', _stopActionSurfaceClick);
  _guardedActionSurfaces.delete(surface);
}

function _ensureActionSurfaceGuards() {
  document.querySelectorAll(ACTION_SURFACE_GUARD_SELECTORS.join(',')).forEach(function (surface) {
    _guardActionSurface(surface);
  });
}

function _removeActionSurfaceGuards() {
  _guardedActionSurfaces.forEach(function (surface) {
    surface.removeEventListener('click', _stopActionSurfaceClick);
  });
  _guardedActionSurfaces.clear();
}

function _isElementVisible(el) {
  if (!el || !el.isConnected || el.hidden) return false;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function _isStemMixerScope(state) {
  return state?.screen === 'player' &&
    !state?.disabled &&
    state?.isV3 &&
    (state?.viewport?.deviceClass === 'phone' || state?.viewport?.deviceClass === 'tablet');
}

function _isStemMixerPanelNode(node) {
  return node?.nodeType === 1 && node.id === 'stem-mixer-panel';
}

function _findStemMixerPanelInNode(node) {
  if (_isStemMixerPanelNode(node)) return node;
  if (node?.nodeType !== 1 || typeof node.querySelector !== 'function') return null;
  return node.querySelector(SELECTORS.stemMixerPanel);
}

function _removedNodeContainsStemMixerPanel(node) {
  if (!_stemMixerPanel || node?.nodeType !== 1) return false;
  return node === _stemMixerPanel ||
    (typeof node.contains === 'function' && node.contains(_stemMixerPanel));
}

function _findStemMixerPanel() {
  return document.getElementById('stem-mixer-panel');
}

function _disconnectStemMixerPanelObserver() {
  if (_stemMixerPanelObserver) {
    _stemMixerPanelObserver.disconnect();
    _stemMixerPanelObserver = null;
  }
}

function _scheduleStemMixerSync() {
  if (_stemMixerSyncFrame) return;
  _stemMixerSyncFrame = requestAnimationFrame(function () {
    _stemMixerSyncFrame = null;
    _syncStemMixerState();
  });
}

function _cacheStemMixerPanel(panel) {
  if (panel === _stemMixerPanel) return;
  if (_stemMixerPanel) _unguardActionSurface(_stemMixerPanel);
  _disconnectStemMixerPanelObserver();
  _stemMixerPanel = panel || null;
  if (!_stemMixerPanel) return;

  _guardActionSurface(_stemMixerPanel);
  _stemMixerPanelObserver = new MutationObserver(function () {
    _scheduleStemMixerSync();
  });
  _stemMixerPanelObserver.observe(_stemMixerPanel, {
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden']
  });
}

function _clearStemMixerPanel(panel) {
  if (panel && panel !== _stemMixerPanel) return;
  if (_stemMixerPanel) _unguardActionSurface(_stemMixerPanel);
  _disconnectStemMixerPanelObserver();
  _stemMixerPanel = null;
}

function _syncStemMixerState() {
  const active = _isStemMixerScope(_stemMixerState) &&
    _isElementVisible(_stemMixerPanel);
  document.documentElement.classList.toggle('mobile-ui-stem-mixer-open', !!active);
}

function _installStemMixerObserver(state) {
  _stemMixerState = state || null;
  if (!_isStemMixerScope(_stemMixerState)) {
    _uninstallStemMixerObserver();
    return;
  }
  _cacheStemMixerPanel(_findStemMixerPanel());
  _syncStemMixerState();
  if (_stemMixerDiscoveryObserver || !document.body) return;
  _stemMixerDiscoveryObserver = new MutationObserver(function (mutations) {
    let changed = false;
    mutations.forEach(function (mutation) {
      mutation.addedNodes.forEach(function (node) {
        const panel = _findStemMixerPanelInNode(node);
        if (!panel) return;
        _cacheStemMixerPanel(panel);
        changed = true;
      });
      mutation.removedNodes.forEach(function (node) {
        if (!_removedNodeContainsStemMixerPanel(node)) return;
        _clearStemMixerPanel();
        changed = true;
      });
    });
    if (changed) _scheduleStemMixerSync();
  });
  _stemMixerDiscoveryObserver.observe(document.body, {
    childList: true,
    subtree: false
  });
}

function _uninstallStemMixerObserver() {
  if (_stemMixerDiscoveryObserver) {
    _stemMixerDiscoveryObserver.disconnect();
    _stemMixerDiscoveryObserver = null;
  }
  _clearStemMixerPanel();
  if (_stemMixerSyncFrame) {
    cancelAnimationFrame(_stemMixerSyncFrame);
    _stemMixerSyncFrame = null;
  }
  _stemMixerState = null;
  document.documentElement.classList.remove('mobile-ui-stem-mixer-open');
}

function _onControlsOutsideClick(e) {
  if (!_controlsOpen) return;
  if (_actionClickInProgress) return;
  if (_controlsBtn && _controlsBtn.contains(e.target)) return;
  if (_controlsPicker && _controlsPicker.contains(e.target)) return;
  if (_isInsidePlayerActionSurface(e.target)) return;
  _hidePicker();
}

function _ensureControls() {
  const player = document.querySelector(SELECTORS.player);
  if (!player) return;
  const controlsBar = document.querySelector(SELECTORS.controls);

  if (_controlsBtn && _controlsBtn.isConnected) {
    const existing = _controlsBtn.closest('.mobile-ui-player-controls-trigger');
    if (existing) {
      existing.setAttribute('data-v3-native', '');
      if (controlsBar && existing.parentElement !== controlsBar) {
        controlsBar.appendChild(existing);
      }
      if (_controlsPicker) _ensureQuickSettings(_controlsPicker, 'portrait', _controlsPicker.firstElementChild);
    }
    return;
  }

  const container = document.createElement('div');
  container.id = 'mobile-ui-player-controls-trigger';
  container.className = 'mobile-ui-player-controls-trigger';
  container.setAttribute('data-v3-native', '');

  const btn = document.createElement('button');
  btn.className = 'mobile-ui-player-controls-button';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'More controls');
  btn.title = 'More controls';
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="4" x2="6" y2="4"/><line x1="10" y1="4" x2="14" y2="4"/><circle cx="8" cy="4" r="1.5"/><line x1="2" y1="8" x2="4" y2="8"/><line x1="10" y1="8" x2="14" y2="8"/><circle cx="7" cy="8" r="1.5"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="10" y1="12" x2="14" y2="12"/><circle cx="7.5" cy="12" r="1.5"/></svg>';
  btn.addEventListener('click', _togglePicker);
  container.appendChild(btn);
  _controlsBtn = btn;

  const picker = document.createElement('div');
  picker.className = 'mobile-ui-player-controls-picker';
  picker.hidden = true;

  _ensureQuickSettings(picker, 'portrait', null);
  MORE_ACTIONS.forEach(function (action, index) {
    picker.appendChild(_createActionButton(action, index, 'mobile-ui-player-controls-option'));
  });
  container.appendChild(picker);
  _controlsPicker = picker;

  (controlsBar || player).appendChild(container);
  document.addEventListener('click', _onControlsOutsideClick);
}

function _ensureLibraryButton() {
  const controlsBar = document.querySelector(SELECTORS.controls);
  if (!controlsBar) return;

  if (_libraryButton && _libraryButton.isConnected) {
    if (_libraryButton.parentElement !== controlsBar) controlsBar.appendChild(_libraryButton);
    return;
  }

  const button = document.createElement('button');
  button.id = 'mobile-ui-player-library-button';
  button.className = 'mobile-ui-player-library-button';
  button.type = 'button';
  button.setAttribute('aria-label', 'Back to library');
  button.title = 'Back to library';
  button.setAttribute('data-v3-native', '');
  button.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.2 8 2.8l5.5 4.4"/><path d="M4 6.6v6.1h8V6.6"/><path d="M6.6 12.7V9.1h2.8v3.6"/></svg>';
  button.addEventListener('click', function (e) {
    e.stopPropagation();
    _exitPlayerToLibrary();
  });

  controlsBar.appendChild(button);
  _libraryButton = button;
}

function _ensureLandscapeControls() {
  const controlsBar = document.querySelector(SELECTORS.controls);
  if (!controlsBar) return;

  if (_landscapeControls && _landscapeControls.isConnected) {
    if (_landscapeControls.parentElement !== controlsBar) controlsBar.appendChild(_landscapeControls);
    const row = _landscapeControls.querySelector('.mobile-ui-player-landscape-chip-row');
    const firstChip = row?.querySelector('.mobile-ui-player-landscape-chip') || null;
    if (row) _moveSpeedClusterInto(row);
    _ensureQuickSettings(row || _landscapeControls, 'landscape', firstChip);
    return;
  }

  const container = document.createElement('div');
  container.id = 'mobile-ui-player-landscape-controls';
  container.className = 'mobile-ui-player-landscape-controls';
  container.setAttribute('data-v3-native', '');

  const row = document.createElement('div');
  row.className = 'mobile-ui-player-landscape-chip-row';

  MORE_ACTIONS.forEach(function (action, index) {
    row.appendChild(_createActionButton(action, index, 'mobile-ui-player-landscape-chip'));
  });
  const firstChip = row.querySelector('.mobile-ui-player-landscape-chip');
  _moveSpeedClusterInto(row);
  _ensureQuickSettings(row, 'landscape', firstChip);
  container.appendChild(row);

  controlsBar.appendChild(container);
  _landscapeControls = container;
  _syncToggleChips();
  _restoreSelection();
}

function _ensureTabletControls(state) {
  const controlsBar = document.querySelector(SELECTORS.controls);
  if (!controlsBar) return;
  const moveSpeed = true;

  if (_tabletControls && _tabletControls.isConnected) {
    if (_tabletControls.parentElement !== controlsBar) controlsBar.appendChild(_tabletControls);
    const firstChip = _tabletControls.querySelector('.mobile-ui-player-tablet-chip') || null;
    if (moveSpeed) _moveSpeedClusterInto(_tabletControls);
    else _restoreSpeedCluster();
    _ensureQuickSettings(_tabletControls, 'tablet', firstChip);
    _syncToggleChips();
    _restoreSelection();
    return;
  }

  const container = document.createElement('div');
  container.id = 'mobile-ui-player-tablet-controls';
  container.className = 'mobile-ui-player-tablet-controls';
  container.setAttribute('data-v3-native', '');

  MORE_ACTIONS.forEach(function (action, index) {
    container.appendChild(_createActionButton(action, index, 'mobile-ui-player-tablet-chip'));
  });
  const firstChip = container.querySelector('.mobile-ui-player-tablet-chip');
  if (moveSpeed) _moveSpeedClusterInto(container);
  else _restoreSpeedCluster();
  _ensureQuickSettings(container, 'tablet', firstChip);

  controlsBar.appendChild(container);
  _tabletControls = container;
  _syncToggleChips();
  _restoreSelection();
}

function _removeLandscapeControls() {
  if (_landscapeControls) {
    _closeSheets();
    _removeQuickSettingsIn(_landscapeControls);
    _restoreSpeedCluster();
    _removeNode(_landscapeControls);
    _landscapeControls = null;
  }
}

function _removeTabletControls() {
  if (_tabletControls) {
    _closeSheets();
    _removeQuickSettingsIn(_tabletControls);
    _restoreSpeedCluster();
    _removeNode(_tabletControls);
    _tabletControls = null;
  }
}

function _removeLibraryButton() {
  _removeNode(_libraryButton);
  _libraryButton = null;
}

function _removeControls() {
  document.removeEventListener('click', _onControlsOutsideClick);
  _hidePicker();
  if (_controlsBtn) {
    const container = _controlsBtn.closest('.mobile-ui-player-controls-trigger');
    _removeQuickSettingsIn(container);
    _removeNode(container);
    _controlsBtn = null;
    _controlsPicker = null;
  }
}

function _setMoreShelfMode(active) {
  document.documentElement.classList.toggle('mobile-ui-player-more-shelf-mode', !!active);
}

function _setTabletDirectControlsMode(active) {
  document.documentElement.classList.toggle('mobile-ui-player-tablet-direct-controls-mode', !!active);
}

// Player touch modes are intentionally mutually exclusive:
// - phone portrait: More shelf mode
// - phone low-height landscape: inline landscape controls
// - tablet portrait/landscape: direct tablet controls
// - desktop: no Mobile UI Player controls
function _isPlayerTouchDevice(state) {
  if (state?.screen !== 'player' || !state?.isV3) return false;
  const vp = state?.viewport;
  if (!vp) return false;
  return vp.deviceClass === 'phone' || vp.deviceClass === 'tablet';
}

function _isPlayerMoreShelfMode(state) {
  const vp = state?.viewport;
  if (!_isPlayerTouchDevice(state) || !vp) return false;
  if (_isPlayerLowHeightLandscape(state)) return false;
  return vp.deviceClass === 'phone' && vp.isPortrait;
}

function _isPlayerTabletDirectControlsMode(state) {
  return state?.screen === 'player' &&
    state?.isV3 &&
    state?.viewport?.deviceClass === 'tablet';
}

function _isPlayerLowHeightLandscape(state) {
  if (state?.screen !== 'player' || !state?.isV3) return false;
  const vp = state?.viewport;
  if (!vp) return false;
  return vp.isLandscape && vp.height <= 520;
}

function _isPlayerPhoneLowHeightLandscape(state) {
  return _isPlayerLowHeightLandscape(state) && state?.viewport?.deviceClass === 'phone';
}

// ── Play/Pause button sync (core bug compatibility) ───────────────────────
// Core owns #btn-play and setPlayButtonState(). This bounded sync only nudges
// the icon back into line when a song starts before the v3 chrome catches up.

let _pbSyncTimers = [];
let _pbListeners = null;

function _syncPlayButton() {
  if (typeof setPlayButtonState !== 'function') return;
  const actuallyPlaying = !!(window.feedBack && window.feedBack.isPlaying);
  const btn = document.querySelector(SELECTORS.playButton);
  if (!btn) return;
  const btnShowsPause = btn.getAttribute('aria-label') === 'Pause';
  if (actuallyPlaying !== btnShowsPause) {
    setPlayButtonState(actuallyPlaying);
  }
}

function _schedulePlayButtonSync() {
  _clearPlayButtonSync();
  [0, 100, 500, 1200].forEach(function (ms) {
    _pbSyncTimers.push(setTimeout(_syncPlayButton, ms));
  });
}

function _clearPlayButtonSync() {
  _pbSyncTimers.forEach(clearTimeout);
  _pbSyncTimers = [];
}

function _installPlayButtonSync() {
  if (_pbListeners) return;
  var fb = window.feedBack;
  if (!fb || !fb.on) return;
  _pbListeners = [
    { event: 'song:play', fn: _syncPlayButton },
    { event: 'song:pause', fn: _syncPlayButton },
    { event: 'song:ready', fn: _schedulePlayButtonSync },
  ];
  _pbListeners.forEach(function (l) { fb.on(l.event, l.fn); });
}

function _uninstallPlayButtonSync() {
  _clearPlayButtonSync();
  if (!_pbListeners) return;
  var fb = window.feedBack;
  _pbListeners.forEach(function (l) {
    if (fb && fb.off) fb.off(l.event, l.fn);
  });
  _pbListeners = null;
}

function _getPlayerModeForDiagnostics() {
  if (_controlsPicker?.isConnected || _controlsBtn?.isConnected) return 'phone-portrait-more-shelf';
  if (_landscapeControls?.isConnected) return 'phone-low-height-landscape-strip';
  if (_tabletControls?.isConnected) return 'tablet-direct-strip';
  if (document.documentElement.classList.contains('mobile-ui-screen-player')) return 'core';
  return 'inactive';
}

export function getPlayerDiagnostics() {
  const speedCluster = _getSpeedCluster();
  return {
    active: document.documentElement.classList.contains('mobile-ui-screen-player'),
    mode: _getPlayerModeForDiagnostics(),
    playerMoreOpen: !!_controlsOpen,
    speedRelocated: !!(speedCluster && speedCluster.classList.contains('mobile-ui-player-speed-in-scroll')),
    stemMixerDiscovered: !!(_stemMixerPanel && _stemMixerPanel.isConnected),
    stemMixerOpen: document.documentElement.classList.contains('mobile-ui-stem-mixer-open')
  };
}

// ── Feature ───────────────────────────────────────────────────────────────

export function createFeature() {
  return {
    name: 'player',
    mount(ctx) {
      const tabletDirectControlsMode = _isPlayerTabletDirectControlsMode(ctx?.state);
      const moreShelfMode = _isPlayerMoreShelfMode(ctx?.state);
      const lowHeightLandscape = _isPlayerLowHeightLandscape(ctx?.state);
      _setMoreShelfMode(moreShelfMode);
      _setTabletDirectControlsMode(tabletDirectControlsMode);
      if (_isPlayerMobileSpeedScope(ctx?.state)) _bind();
      if (tabletDirectControlsMode) {
        _removeControls();
        _removeLandscapeControls();
        _ensureTabletControls(ctx?.state);
        _ensureLibraryButton();
        _ensureActionSurfaceGuards();
        _installStemMixerObserver(ctx?.state);
      } else if (moreShelfMode) {
        _removeTabletControls();
        _removeLandscapeControls();
        _ensureLibraryButton();
        _ensureControls();
        _ensureActionSurfaceGuards();
        _installStemMixerObserver(ctx?.state);
      } else if (lowHeightLandscape) {
        _removeControls();
        _removeTabletControls();
        if (_isPlayerPhoneLowHeightLandscape(ctx?.state)) _ensureLibraryButton();
        else _removeLibraryButton();
        _ensureLandscapeControls();
        _ensureActionSurfaceGuards();
        _installStemMixerObserver(ctx?.state);
      } else {
        _removeLibraryButton();
        _removeControls();
        _removeTabletControls();
        _removeLandscapeControls();
        _removeActionSurfaceGuards();
        _uninstallStemMixerObserver();
      }
      _installPlayButtonSync();
      _syncPlayButton();
    },
    refresh(ctx) {
      const tabletDirectControlsMode = _isPlayerTabletDirectControlsMode(ctx?.state);
      const moreShelfMode = _isPlayerMoreShelfMode(ctx?.state);
      const lowHeightLandscape = _isPlayerLowHeightLandscape(ctx?.state);
      _setMoreShelfMode(moreShelfMode);
      _setTabletDirectControlsMode(tabletDirectControlsMode);
      if (_isPlayerMobileSpeedScope(ctx?.state)) {
        _bind();
      } else {
        _unbind();
      }
      if (tabletDirectControlsMode) {
        _removeControls();
        _removeLandscapeControls();
        _ensureTabletControls(ctx?.state);
        _ensureLibraryButton();
        _ensureActionSurfaceGuards();
        _installStemMixerObserver(ctx?.state);
      } else if (moreShelfMode) {
        _removeTabletControls();
        _removeLandscapeControls();
        _ensureLibraryButton();
        _ensureControls();
        _ensureActionSurfaceGuards();
        _installStemMixerObserver(ctx?.state);
      } else if (lowHeightLandscape) {
        _removeControls();
        _removeTabletControls();
        if (_isPlayerPhoneLowHeightLandscape(ctx?.state)) _ensureLibraryButton();
        else _removeLibraryButton();
        _ensureLandscapeControls();
        _ensureActionSurfaceGuards();
        _installStemMixerObserver(ctx?.state);
      } else {
        _removeLibraryButton();
        _removeControls();
        _removeTabletControls();
        _removeLandscapeControls();
        _removeActionSurfaceGuards();
        _uninstallStemMixerObserver();
      }
      if (ctx?.state?.screen === 'player' && ctx?.state?.isV3) {
        _installPlayButtonSync();
        _syncPlayButton();
      } else {
        _uninstallPlayButtonSync();
      }
    },
    unmount() {
      _unbind();
      _removeLibraryButton();
      _removeControls();
      _removeLandscapeControls();
      _removeTabletControls();
      _removeActionSurfaceGuards();
      _uninstallStemMixerObserver();
      _setMoreShelfMode(false);
      _setTabletDirectControlsMode(false);
      _uninstallPlayButtonSync();
    }
  };
}
