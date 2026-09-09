export const LATEST_STABLE_RELEASE_API_URL = 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest';
export const DEFAULT_UPDATE_TIMEOUT_MS = 4000;

function parseStableTag(tag) {
  if (typeof tag !== 'string') return null;
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!match) return null;
  return {
    tag,
    version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
    parts: match.slice(1).map((part) => Number(part)),
  };
}

function parseLocalVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  return {
    version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
    tag: `v${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
    parts: match.slice(1).map((part) => Number(part)),
  };
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left.parts[index] > right.parts[index]) return 1;
    if (left.parts[index] < right.parts[index]) return -1;
  }
  return 0;
}

function neutral(reason, localIdentity = null, latest = null) {
  return {
    state: 'unavailable',
    tone: 'attention',
    label: "Couldn't check",
    summary: reason || 'The latest stable release could not be checked.',
    localSource: localIdentity?.source || '',
    localVersion: localIdentity?.localTag || localIdentity?.localVersion || '',
    latestVersion: latest?.tag || '',
    latestTag: '',
  };
}

export function buildCheckingUpdateModel() {
  return {
    state: 'checking',
    tone: 'attention',
    label: 'Checking updates',
    summary: 'Checking the latest stable Mobile Edition release.',
    localSource: '',
    localVersion: '',
    latestVersion: '',
    latestTag: '',
  };
}

export function buildUpdateStatusModel(localIdentity, latestRelease) {
  if (!localIdentity || localIdentity.status !== 'ready') {
    return neutral(localIdentity?.reason || 'Local Edition identity is unavailable.', localIdentity);
  }

  if (localIdentity.latestStableReleaseApiUrl !== LATEST_STABLE_RELEASE_API_URL) {
    return neutral('Local Edition identity points at an unsupported release endpoint.', localIdentity);
  }

  const local = parseLocalVersion(localIdentity.localVersion || localIdentity.localTag);
  if (!local) {
    return neutral('Local Edition version is not in a supported format.', localIdentity);
  }

  if (!latestRelease || latestRelease.prerelease || latestRelease.draft) {
    return neutral('GitHub did not return a stable release payload.', localIdentity);
  }

  const latest = parseStableTag(latestRelease.tag_name);
  if (!latest) {
    return neutral('GitHub returned an unsupported latest stable tag.', localIdentity);
  }

  const comparison = compareSemver(local, latest);
  const source = localIdentity.source || '';
  if (comparison === 0 && source === 'development_checkout') {
    return {
      state: 'development_current',
      tone: 'ready',
      label: 'Development checkout',
      summary: `Based on ${local.tag}, matching the latest stable release.`,
      localSource: source,
      localVersion: local.tag,
      latestVersion: latest.tag,
      latestTag: latest.tag,
    };
  }
  if (comparison === 0) {
    return {
      state: 'current',
      tone: 'ready',
      label: 'Current stable bundle',
      summary: `${local.tag} is the latest stable Mobile Edition release.`,
      localSource: source,
      localVersion: local.tag,
      latestVersion: latest.tag,
      latestTag: latest.tag,
    };
  }
  if (comparison < 0) {
    return {
      state: 'available',
      tone: 'attention',
      label: 'Update available',
      summary: `${latest.tag} is newer than this ${source === 'development_checkout' ? 'development checkout' : 'installation'}.`,
      localSource: source,
      localVersion: local.tag,
      latestVersion: latest.tag,
      latestTag: latest.tag,
    };
  }
  return {
    state: 'local_newer',
    tone: 'attention',
    label: 'Local version ahead',
    summary: `${local.tag} is newer than the latest stable release GitHub reported.`,
    localSource: source,
    localVersion: local.tag,
    latestVersion: latest.tag,
    latestTag: latest.tag,
  };
}

export function buildStageSetupBundleUpdateActionModel(updateModel) {
  const latestTag = typeof updateModel?.latestTag === 'string' ? updateModel.latestTag : '';
  const state = updateModel?.updateState || updateModel?.state;
  const visible = state === 'available'
    && updateModel?.localSource === 'setup_bundle'
    && /^v\d+\.\d+\.\d+$/.test(latestTag);
  return {
    visible,
    canRun: visible,
    tag: visible ? latestTag : '',
    label: 'Download update',
  };
}

export function applySetupBundleUpdateState(updateModel, installState) {
  const stateCanAdvance = ['available', 'downloaded', 'installed', 'install_conflict'].includes(updateModel?.state);
  if (!updateModel || !stateCanAdvance || updateModel.localSource !== 'setup_bundle') {
    return updateModel;
  }
  if (!installState || installState.tag !== updateModel.latestTag) return updateModel;
  if (installState.status === 'downloaded') {
    return {
      ...updateModel,
      state: 'downloaded',
      tone: 'attention',
      label: 'Update downloaded',
      summary: 'Verified update ready to install.',
    };
  }
  if (installState.status === 'installed') {
    return {
      ...updateModel,
      state: 'installed',
      tone: 'ready',
      label: 'Update installed',
      summary: 'Update installed. Open the new version when ready.',
    };
  }
  if (installState.status === 'conflict') {
    return {
      ...updateModel,
      state: 'install_conflict',
      tone: 'error',
      label: 'Update install conflict',
      summary: 'A version folder already exists but is not a valid installation.',
    };
  }
  return updateModel;
}

export function buildInstallSetupBundleUpdateActionModel(updateModel) {
  const latestTag = typeof updateModel?.latestTag === 'string' ? updateModel.latestTag : '';
  const state = updateModel?.updateState || updateModel?.state;
  const visible = state === 'downloaded'
    && updateModel?.localSource === 'setup_bundle'
    && /^v\d+\.\d+\.\d+$/.test(latestTag);
  return {
    visible,
    canRun: visible,
    tag: visible ? latestTag : '',
    label: 'Install update',
  };
}

export function buildOpenInstalledSetupBundleUpdateActionModel(updateModel) {
  const latestTag = typeof updateModel?.latestTag === 'string' ? updateModel.latestTag : '';
  const state = updateModel?.updateState || updateModel?.state;
  const visible = state === 'installed'
    && updateModel?.localSource === 'setup_bundle'
    && /^v\d+\.\d+\.\d+$/.test(latestTag);
  return {
    visible,
    canRun: visible,
    tag: visible ? latestTag : '',
    label: 'Open new version',
  };
}

export function buildReviewUpdateActionModel(updateModel) {
  const latestTag = typeof updateModel?.latestTag === 'string' ? updateModel.latestTag : '';
  const state = updateModel?.updateState || updateModel?.state;
  const visible = ['available', 'downloaded', 'installed', 'install_conflict'].includes(state)
    && /^v\d+\.\d+\.\d+$/.test(latestTag);
  return {
    visible,
    canRun: visible,
    tag: visible ? latestTag : '',
    label: 'Review update',
  };
}

export function applySetupBundleActivationState(updateModel, activationState) {
  if (!updateModel || updateModel.localSource !== 'setup_bundle' || !activationState || activationState.status === 'unavailable') {
    return updateModel;
  }
  const tag = typeof activationState.tag === 'string' ? activationState.tag : '';
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) return updateModel;
  const updateState = updateModel.updateState || updateModel.state;
  if (activationState.status === 'current') {
    return {
      ...updateModel,
      updateState,
      state: 'activation_current',
      activationStatus: 'current',
      activationTag: tag,
      tone: 'ready',
      label: 'Current version',
      summary: 'The original setup launcher will open this version next time.',
    };
  }
  if (activationState.status === 'invalid_current') {
    return {
      ...updateModel,
      updateState,
      state: 'activation_invalid_current',
      activationStatus: 'invalid_current',
      activationTag: tag,
      tone: 'error',
      label: 'Current record invalid',
      summary: 'Make this version current to replace the invalid launcher record.',
    };
  }
  if (activationState.status === 'activatable') {
    return {
      ...updateModel,
      updateState,
      state: 'activation_activatable',
      activationStatus: 'activatable',
      activationTag: tag,
      tone: 'attention',
      label: 'Managed version',
      summary: 'Make this version current for the original setup launcher.',
    };
  }
  return updateModel;
}

export function buildMakeCurrentActionModel(updateModel) {
  const tag = typeof updateModel?.activationTag === 'string' ? updateModel.activationTag : '';
  const visible = ['activatable', 'invalid_current'].includes(updateModel?.activationStatus)
    && /^v\d+\.\d+\.\d+$/.test(tag);
  return {
    visible,
    canRun: visible,
    tag: visible ? tag : '',
    label: 'Make current',
  };
}

export async function fetchLatestStableRelease(apiUrl, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_UPDATE_TIMEOUT_MS,
    AbortControllerImpl = globalThis.AbortController,
  } = options;

  if (apiUrl !== LATEST_STABLE_RELEASE_API_URL) {
    throw new Error('Unsupported latest stable release endpoint.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is unavailable.');
  }

  const controller = typeof AbortControllerImpl === 'function' ? new AbortControllerImpl() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
    : null;
  try {
    const response = await fetchImpl(apiUrl, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
      credentials: 'omit',
      signal: controller?.signal,
    });
    if (!response?.ok) {
      throw new Error(`GitHub latest release check failed with status ${response?.status || 'unknown'}.`);
    }
    return await response.json();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function checkLatestStableRelease(localIdentity, options = {}) {
  if (!localIdentity || localIdentity.status !== 'ready') {
    return buildUpdateStatusModel(localIdentity, null);
  }
  try {
    const latestRelease = await fetchLatestStableRelease(localIdentity.latestStableReleaseApiUrl, options);
    return buildUpdateStatusModel(localIdentity, latestRelease);
  } catch (error) {
    return neutral(error?.message || 'The latest stable release could not be checked.', localIdentity);
  }
}
