const DEFAULT_SETTINGS = {
  githubUsername: 'hisaransh',
  soundEnabled: true,
};

const form = {
  githubUsername: document.querySelector('#githubUsername'),
  soundEnabled: document.querySelector('#soundEnabled'),
};

const flash = document.querySelector('#flash');
const githubSummary = document.querySelector('#githubSummary');
const githubList = document.querySelector('#githubList');
const jenkinsSummary = document.querySelector('#jenkinsSummary');
const jenkinsList = document.querySelector('#jenkinsList');

document.addEventListener('DOMContentLoaded', initialize);
document.querySelector('#saveButton').addEventListener('click', saveSettings);
document.querySelector('#testSoundButton').addEventListener('click', playBell);

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }

  if (changes.pageStates || changes.settings) {
    await loadState();
  }
});

async function initialize() {
  await loadState();
}

async function saveSettings() {
  const settings = {
    githubUsername: normalizeText(form.githubUsername.value) || DEFAULT_SETTINGS.githubUsername,
    soundEnabled: form.soundEnabled.checked,
  };

  await chrome.storage.local.set({ settings });
  await chrome.runtime.sendMessage({ type: 'settings-updated' });
  setFlash('Settings saved.', false);
}

async function playBell() {
  const response = await chrome.runtime.sendMessage({ type: 'play-sound' });
  if (!response || response.ok !== true) {
    setFlash(response?.error || 'Unable to play the bell sound.', true);
    return;
  }

  setFlash('Bell sound played.', false);
}

async function loadState() {
  const { settings = DEFAULT_SETTINGS, pageStates = {} } = await chrome.storage.local.get({
    settings: DEFAULT_SETTINGS,
    pageStates: {},
  });
  const normalizedSettings = normalizeSettings(settings);

  form.githubUsername.value = normalizedSettings.githubUsername;
  form.soundEnabled.checked = normalizedSettings.soundEnabled;

  const githubEntries = Object.values(pageStates).filter((entry) => entry.site === 'github');
  const jenkinsEntries = Object.values(pageStates).filter((entry) => entry.site === 'jenkins');

  renderGithub(githubEntries);
  renderJenkins(jenkinsEntries);
}

function renderGithub(entries) {
  githubList.replaceChildren();

  if (entries.length === 0) {
    githubSummary.textContent = 'No open GitHub PR tabs are reporting state yet.';
    githubList.appendChild(makeListItem('Open a GitHub PR tab to start watching it.', ''));
    return;
  }

  const readyCount = entries.filter((entry) => entry.ready).length;
  githubSummary.textContent = `Watching ${entries.length} PR tab${entries.length === 1 ? '' : 's'}. Validation finished now: ${readyCount}.`;

  entries
    .sort((left, right) => Number(right.ready) - Number(left.ready))
    .forEach((entry) => {
      githubList.appendChild(
        makeListItem(
          entry.label || entry.title || 'GitHub PR',
          `${entry.relevant ? 'Matching author' : 'Other author'} • ${
            entry.details || (entry.ready ? 'Validation finished' : 'Waiting for Validation* checks')
          }`,
        ),
      );
    });
}

function renderJenkins(entries) {
  jenkinsList.replaceChildren();

  if (entries.length === 0) {
    jenkinsSummary.textContent = 'No Jenkins pages are reporting state yet.';
    jenkinsList.appendChild(makeListItem('Open a Jenkins build page or console page to start watching it.', ''));
    return;
  }

  const completedCount = entries.filter((entry) => entry.status === 'completed').length;
  jenkinsSummary.textContent = `Watching ${entries.length} Jenkins tab${entries.length === 1 ? '' : 's'}. Completed now: ${completedCount}.`;

  entries.forEach((entry) => {
    const statusText =
      entry.status === 'completed'
        ? `${entry.result || 'Completed'} • watched from console DOM`
        : `${entry.status || 'idle'} • watching console DOM`;
    jenkinsList.appendChild(makeListItem(entry.label || 'Jenkins page', statusText));
  });
}

function makeListItem(title, meta) {
  const item = document.createElement('li');
  const titleNode = document.createElement('span');
  titleNode.className = 'status-title';
  titleNode.textContent = title;
  item.appendChild(titleNode);

  if (meta) {
    const metaNode = document.createElement('span');
    metaNode.className = 'status-meta';
    metaNode.textContent = meta;
    item.appendChild(metaNode);
  }

  return item;
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

let flashTimeoutId = null;

function setFlash(message, isError) {
  flash.textContent = message;
  flash.className = isError ? 'error-text' : '';

  clearTimeout(flashTimeoutId);
  flashTimeoutId = setTimeout(() => {
    flash.textContent = '';
    flash.className = '';
  }, 3000);
}
