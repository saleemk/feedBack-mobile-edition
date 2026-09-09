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
    localVersion: local.tag,
    latestVersion: latest.tag,
    latestTag: latest.tag,
  };
}

export function buildReviewUpdateActionModel(updateModel) {
  const latestTag = typeof updateModel?.latestTag === 'string' ? updateModel.latestTag : '';
  const visible = updateModel?.state === 'available' && /^v\d+\.\d+\.\d+$/.test(latestTag);
  return {
    visible,
    canRun: visible,
    tag: visible ? latestTag : '',
    label: 'Review update',
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
