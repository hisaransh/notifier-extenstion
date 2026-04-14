const DEFAULT_SETTINGS = {
  githubUsername: 'hisaransh',
  soundEnabled: true,
};

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const NOTIFICATION_ICON = 'icons/icon-128.png';
let offscreenCreationPromise = null;

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaultSettings();
  await ensureGithubMonitorOnOpenTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaultSettings();
  await ensureGithubMonitorOnOpenTabs();
});

chrome.action.onClicked.addListener(async () => {
  await chrome.runtime.openOptionsPage();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await clearTabState(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) {
    return;
  }

  await clearTabState(tabId);
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const { notificationTargets = {} } = await chrome.storage.local.get({
    notificationTargets: {},
  });
  const target = notificationTargets[notificationId];

  if (!target) {
    return;
  }

  try {
    if (typeof target.tabId === 'number') {
      await chrome.tabs.update(target.tabId, { active: true });
    } else if (target.url) {
      await chrome.tabs.create({ url: target.url });
    }
  } catch (_error) {
    if (target.url) {
      await chrome.tabs.create({ url: target.url });
    }
  }

  delete notificationTargets[notificationId];
  await chrome.storage.local.set({ notificationTargets });
  await chrome.notifications.clear(notificationId);
});

chrome.notifications.onClosed.addListener(async (notificationId) => {
  const { notificationTargets = {} } = await chrome.storage.local.get({
    notificationTargets: {},
  });

  if (!notificationTargets[notificationId]) {
    return;
  }

  delete notificationTargets[notificationId];
  await chrome.storage.local.set({ notificationTargets });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') {
    return false;
  }

  (async () => {
    switch (message.type) {
      case 'page-state':
        await handlePageState(message, sender);
        sendResponse({ ok: true });
        break;
      case 'settings-updated':
        await ensureDefaultSettings();
        sendResponse({ ok: true });
        break;
      case 'play-sound':
        await playBell();
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
        break;
    }
  })().catch((error) => {
    console.error('Background message failed:', error);
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});

async function handlePageState(message, sender) {
  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number') {
    return;
  }

  const key = `${message.site}:${tabId}`;
  const { pageStates = {} } = await chrome.storage.local.get({ pageStates: {} });
  const previous = pageStates[key];
  const next = {
    ...message.state,
    site: message.site,
    tabId,
    windowId: sender.tab?.windowId,
    url: sender.tab?.url || message.state?.url || '',
    receivedAt: new Date().toISOString(),
  };

  pageStates[key] = next;
  await chrome.storage.local.set({ pageStates });

  if (shouldNotify(previous, next)) {
    await notifyForPageState(next);
  }

  await refreshActionBadge(pageStates);
}

function shouldNotify(previous, next) {
  if (!next || !next.relevant) {
    return false;
  }

  if (!previous) {
    return false;
  }

  if (next.site === 'github') {
    return previous.ready === false && next.ready === true;
  }

  if (next.site === 'jenkins') {
    return previous.status !== 'completed' && next.status === 'completed';
  }

  return false;
}

async function notifyForPageState(state) {
  const notificationId = `notify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const title =
    state.site === 'github'
      ? `Validation finished: ${state.label}`
      : `Jenkins build finished: ${state.label}`;
  const message =
    state.site === 'github'
      ? state.details || 'Validation checks reached a terminal result.'
      : `${state.result || 'Completed'}${state.details ? ` • ${state.details}` : ''}`;

  await chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: NOTIFICATION_ICON,
    title,
    message,
    priority: 2,
  });

  await rememberNotificationTarget(notificationId, {
    tabId: state.tabId,
    windowId: state.windowId,
    url: state.url,
  });
  await playBell();
}

async function rememberNotificationTarget(notificationId, target) {
  const { notificationTargets = {} } = await chrome.storage.local.get({
    notificationTargets: {},
  });
  notificationTargets[notificationId] = target;
  await chrome.storage.local.set({ notificationTargets });
}

async function clearTabState(tabId) {
  const { pageStates = {} } = await chrome.storage.local.get({ pageStates: {} });
  let changed = false;

  for (const [key, value] of Object.entries(pageStates)) {
    if (value.tabId === tabId) {
      delete pageStates[key];
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ pageStates });
    await refreshActionBadge(pageStates);
  }
}

async function refreshActionBadge(pageStatesInput) {
  const pageStates =
    pageStatesInput ||
    (
      await chrome.storage.local.get({
        pageStates: {},
      })
    ).pageStates;

  const readyCount = Object.values(pageStates).filter(
    (entry) => entry.site === 'github' && entry.ready,
  ).length;

  if (readyCount > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: '#0b6bcb' });
    await chrome.action.setBadgeText({ text: String(Math.min(readyCount, 99)) });
    return;
  }

  await chrome.action.setBadgeText({ text: '' });
}

async function playBell() {
  const settings = await getSettings();
  if (!settings.soundEnabled) {
    return;
  }

  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage({ type: 'play-bell-offscreen' });
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (contexts.length > 0) {
    return;
  }

  if (!offscreenCreationPromise) {
    offscreenCreationPromise = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play a bell sound for DOM-based GitHub and Jenkins notifications.',
      })
      .catch((error) => {
        if (
          !String(error.message || '').includes('Only a single offscreen document may be created')
        ) {
          throw error;
        }
      })
      .finally(() => {
        offscreenCreationPromise = null;
      });
  }

  await offscreenCreationPromise;
}

async function ensureDefaultSettings() {
  const { settings } = await chrome.storage.local.get({ settings: DEFAULT_SETTINGS });
  const normalized = normalizeSettings(settings);

  if (JSON.stringify(normalized) !== JSON.stringify(settings)) {
    await chrome.storage.local.set({ settings: normalized });
  }
}

async function ensureGithubMonitorOnOpenTabs() {
  const tabs = await chrome.tabs.query({
    url: ['https://github.com/*'],
  });

  await Promise.all(
    tabs
      .filter((tab) => typeof tab.id === 'number')
      .map((tab) =>
        chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            files: ['github-monitor.js'],
          })
          .catch((error) => {
            console.warn(`Unable to attach GitHub monitor to tab ${tab.id}:`, error);
          }),
      ),
  );
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get({ settings: DEFAULT_SETTINGS });
  return normalizeSettings(settings);
}

function normalizeSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    githubUsername: normalizeText(settings.githubUsername || DEFAULT_SETTINGS.githubUsername) || 'hisaransh',
    soundEnabled: settings.soundEnabled !== false,
  };
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}
