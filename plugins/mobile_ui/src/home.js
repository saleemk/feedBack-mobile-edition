export function createFeature() {
  let lastState = null;
  let dashboardListenerInstalled = false;
  let syncFrame = null;
  let topbarStats = null;
  let songsSource = null;
  let activeSource = null;
  let cachedStats = null;
  const STAT_NAV_TARGETS = {
    songs: 'songs',
    active: 'plugins'
  };

  return {
    name: 'home',
    mount(ctx) {
      lastState = ctx?.state || null;
      _installDashboardListener();
      _scheduleSync();
    },
    refresh(ctx) {
      lastState = ctx?.state || null;
      _scheduleSync();
    },
    unmount() {
      _removeDashboardListener();
      _cancelSync();
      _removeTopbarStats();
      lastState = null;
      cachedStats = null;
    }
  };

  function _installDashboardListener() {
    if (dashboardListenerInstalled) return;
    document.addEventListener('v3:dashboard-rendered', _onDashboardRendered);
    dashboardListenerInstalled = true;
  }

  function _removeDashboardListener() {
    if (!dashboardListenerInstalled) return;
    document.removeEventListener('v3:dashboard-rendered', _onDashboardRendered);
    dashboardListenerInstalled = false;
  }

  function _onDashboardRendered() {
    _scheduleSync();
  }

  function _scheduleSync() {
    if (syncFrame) return;
    syncFrame = requestAnimationFrame(function () {
      syncFrame = null;
      _syncTopbarStats();
    });
  }

  function _cancelSync() {
    if (!syncFrame) return;
    cancelAnimationFrame(syncFrame);
    syncFrame = null;
  }

  function _isTouchNonPlayerWithTopbarStats() {
    return lastState?.screen !== 'player' &&
      lastState?.isV3 &&
      !lastState?.disabled &&
      (lastState?.viewport?.deviceClass === 'phone' || lastState?.viewport?.deviceClass === 'tablet');
  }

  function _syncTopbarStats() {
    if (!_isTouchNonPlayerWithTopbarStats()) {
      _removeTopbarStats();
      return;
    }

    const rail = document.querySelector('.mobile-ui-topbar-status-rail');
    const profile = document.getElementById('v3-badge-profile');
    const sourceStats = _readHomeStats();
    if (sourceStats.songs) {
      cachedStats = {
        songs: sourceStats.songs,
        active: sourceStats.active
      };
    }

    const stats = sourceStats.songs ? sourceStats : cachedStats;
    if (!rail || !stats?.songs) {
      _removeTopbarStats();
      return;
    }

    const wrapper = _ensureTopbarStats(rail, profile);
    _upsertStat(wrapper, 'songs', stats.songs, 'Songs');
    if (stats.active) {
      _upsertStat(wrapper, 'active', stats.active, 'Active');
    } else {
      wrapper.querySelector('[data-mobile-ui-home-stat="active"]')?.remove();
    }
    if (lastState?.screen === 'home' && sourceStats.songs) {
      _syncSourceVisibility(sourceStats);
    } else {
      _restoreSourceVisibility();
    }
  }

  function _readHomeStats() {
    const grid = document.querySelector('#v3-home > .max-w-7xl > .grid.md\\:grid-cols-3');
    if (!grid) return {};

    const children = Array.from(grid.children);
    const songCard = children.find(function (child) {
      return child.id !== 'v3-audio-routing' && _parseStatText(child.textContent, 'songs');
    }) || null;
    const careerSlot = document.getElementById('v3-dash-career-slot');
    const careerCard = careerSlot?.querySelector?.('.pp-dash-card') || null;
    const activeCard = careerCard ? null : careerSlot;

    return {
      songCard,
      activeCard,
      songs: songCard ? _parseStatText(songCard.textContent, 'songs') : null,
      active: activeCard ? _parseStatText(activeCard.textContent, 'active') : null
    };
  }

  function _parseStatText(text, unit) {
    const normalized = String(text || '').trim().replace(/\s+/g, ' ');
    const match = normalized.match(new RegExp('^(.+?)\\s+' + unit + '$', 'i'));
    if (!match) return null;
    return { value: match[1], unit };
  }

  function _ensureTopbarStats(rail, profile) {
    if (!topbarStats || !topbarStats.isConnected) {
      topbarStats = document.createElement('div');
      topbarStats.className = 'mobile-ui-home-topbar-stats';
      topbarStats.setAttribute('aria-label', 'Home stats');
    }
    const reference = profile ? profile.nextSibling : null;
    if (topbarStats.parentElement !== rail || (profile && topbarStats.previousElementSibling !== profile)) {
      rail.insertBefore(topbarStats, reference);
    }
    return topbarStats;
  }

  function _upsertStat(wrapper, key, stat, label) {
    let card = wrapper.querySelector('[data-mobile-ui-home-stat="' + key + '"]');
    if (!card || card.tagName !== 'BUTTON') {
      const replacement = document.createElement('button');
      replacement.type = 'button';
      replacement.className = 'mobile-ui-home-stat-button';
      replacement.setAttribute('data-mobile-ui-home-stat', key);
      replacement.addEventListener('click', _onTopbarStatClick);
      if (card) card.replaceWith(replacement);
      else wrapper.appendChild(replacement);
      card = replacement;
    }
    const target = STAT_NAV_TARGETS[key] || '';
    const targetAvailable = !!_getCoreNavAnchor(target);
    if (target) {
      card.setAttribute('data-mobile-ui-target', target);
    } else {
      card.removeAttribute('data-mobile-ui-target');
    }
    if (targetAvailable) {
      card.removeAttribute('aria-disabled');
    } else {
      card.setAttribute('aria-disabled', 'true');
    }
    card.setAttribute('aria-label', label + ': ' + stat.value + ' ' + stat.unit);
    card.innerHTML = '<span class="mobile-ui-home-stat-value"></span><span class="mobile-ui-home-stat-unit"></span>';
    card.querySelector('.mobile-ui-home-stat-value').textContent = stat.value;
    card.querySelector('.mobile-ui-home-stat-unit').textContent = stat.unit;
  }

  function _onTopbarStatClick(event) {
    const target = event.currentTarget?.getAttribute('data-mobile-ui-target') || '';
    _activateCoreNavTarget(target);
  }

  function _activateCoreNavTarget(target) {
    const anchor = _getCoreNavAnchor(target);
    if (!anchor) return false;
    anchor.click();
    return true;
  }

  function _getCoreNavAnchor(target) {
    if (!target) return null;
    const anchor = document.querySelector('#v3-nav a[data-v3-nav="' + _escapeCssValue(target) + '"]');
    if (!anchor || anchor.hidden) return null;
    if (anchor.getAttribute('aria-hidden') === 'true') return null;
    if (anchor.getAttribute('aria-disabled') === 'true') return null;
    return anchor;
  }

  function _escapeCssValue(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }

    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function _syncSourceVisibility(stats) {
    _restoreSourceVisibility();
    songsSource = stats.songCard || null;
    activeSource = stats.activeCard || null;
    _setSourceHidden(songsSource, true);
    if (stats.active) _setSourceHidden(activeSource, true);
  }

  function _restoreSourceVisibility() {
    _setSourceHidden(songsSource, false);
    _setSourceHidden(activeSource, false);
    songsSource = null;
    activeSource = null;
  }

  function _setSourceHidden(source, hidden) {
    if (!source) return;
    source.classList.toggle('mobile-ui-home-stat-source-hidden', !!hidden);
  }

  function _removeTopbarStats() {
    _restoreSourceVisibility();
    topbarStats?.remove();
    topbarStats = null;
    document.querySelectorAll('.mobile-ui-home-stat-source-hidden')
      .forEach(function (node) { node.classList.remove('mobile-ui-home-stat-source-hidden'); });
  }
}
