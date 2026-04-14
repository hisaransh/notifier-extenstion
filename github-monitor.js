if (globalThis.__PR_BELL_GITHUB_MONITOR_LOADED__) {
  // Avoid double-registering observers when the script is injected manually and via manifest.
} else {
  globalThis.__PR_BELL_GITHUB_MONITOR_LOADED__ = true;

  (async () => {
  const DEFAULT_SETTINGS = {
    githubUsername: 'hisaransh',
  };

  let settings = await loadSettings();
  let lastUrl = location.href;
  let lastSignature = '';
  let scheduled = false;

  try {
    chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName !== 'local' || !changes.settings) {
        return;
      }

      settings = normalizeSettings(changes.settings.newValue || DEFAULT_SETTINGS);
      lastSignature = '';
      scheduleEvaluate();
    });
  } catch (error) {
    console.debug('GitHub monitor could not subscribe to storage changes:', error);
  }

  const observer = new MutationObserver(() => {
    scheduleEvaluate();
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastSignature = '';
    }

    scheduleEvaluate();
  }, 8000);

  scheduleEvaluate();

  function scheduleEvaluate() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      void evaluatePageSafely();
    }, 350);
  }

  async function evaluatePageSafely() {
    try {
      await evaluatePage();
    } catch (error) {
      console.debug('GitHub monitor skipped page evaluation:', error);
    }
  }

  async function evaluatePage() {
    if (!/\/pull\/\d+(\/|$)/.test(location.pathname)) {
      return;
    }

    const author = detectAuthor();
    const validationSignals = detectValidationSignals();
    const title = detectTitle();
    const label = detectLabel();
    const watchedUsername = normalizeText(settings?.githubUsername || DEFAULT_SETTINGS.githubUsername);
    const relevant = author.toLowerCase() === watchedUsername.toLowerCase();
    const ready = relevant && validationSignals.completed;
    const details = validationSignals.reason;

    const state = {
      relevant,
      ready,
      status: validationSignals.status,
      author,
      title,
      label,
      details,
      url: location.href,
    };
    const signature = JSON.stringify(state);

    if (signature === lastSignature) {
      return;
    }

    lastSignature = signature;
    await sendPageState({
      type: 'page-state',
      site: 'github',
      state,
    });
  }

  function detectAuthor() {
    const selectors = [
      '#partial-discussion-header .author',
      '.gh-header-meta .author',
      '.timeline-comment-header .author',
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const value = normalizeText(node?.textContent);
      if (value) {
        return value.replace(/^@/, '');
      }
    }

    return '';
  }

  function detectTitle() {
    const node = document.querySelector('.js-issue-title, [data-testid="issue-title"]');
    return normalizeText(node?.textContent) || document.title.replace(/\s*·\s*.*$/, '');
  }

  function detectLabel() {
    const match = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) {
      return detectTitle() || 'GitHub PR';
    }

    return `${match[1]}/${match[2]} #${match[3]}`;
  }

  function detectValidationSignals() {
    const checksSection = detectChecksSection();
    const validationChecks = collectValidationChecks(checksSection);

    if (validationChecks.length === 0) {
      return {
        completed: false,
        status: 'waiting',
        reason: 'Waiting for Validation* checks',
      };
    }

    const pendingChecks = validationChecks.filter((check) => !check.terminal);
    if (pendingChecks.length > 0) {
      return {
        completed: false,
        status: 'running',
        reason:
          pendingChecks.length === 1
            ? `${pendingChecks[0].name} still running`
            : `${pendingChecks.length} Validation checks still running`,
      };
    }

    const failingChecks = validationChecks.filter((check) => check.status === 'failed');
    const cancelledChecks = validationChecks.filter((check) => check.status === 'cancelled');
    const successfulChecks = validationChecks.filter((check) => check.status === 'success');
    const neutralChecks = validationChecks.filter((check) => check.status === 'neutral');

    if (failingChecks.length > 0) {
      return {
        completed: true,
        status: 'failed',
        reason:
          failingChecks.length === 1 && validationChecks.length === 1
            ? `${failingChecks[0].name} failed`
            : `Validation finished • ${failingChecks.length} failed, ${successfulChecks.length} passed`,
      };
    }

    if (cancelledChecks.length > 0) {
      return {
        completed: true,
        status: 'cancelled',
        reason:
          cancelledChecks.length === 1 && validationChecks.length === 1
            ? `${cancelledChecks[0].name} was cancelled`
            : `Validation finished • ${cancelledChecks.length} cancelled`,
      };
    }

    if (successfulChecks.length > 0 && neutralChecks.length === 0) {
      return {
        completed: true,
        status: 'success',
        reason:
          successfulChecks.length === 1
            ? `${successfulChecks[0].name} passed`
            : `Validation passed • ${successfulChecks.length} checks finished successfully`,
      };
    }

    return {
      completed: true,
      status: 'neutral',
      reason:
        neutralChecks.length > 0
          ? `Validation finished • ${neutralChecks.length} skipped or neutral`
          : 'Validation finished',
    };
  }

  function detectChecksSection() {
    const mergebox =
      document.querySelector('[data-testid="mergebox-partial"]') ||
      document.querySelector('#partial-pull-merging') ||
      document.querySelector('[data-testid="pull-request-mergebox"]');

    return (
      mergebox?.querySelector('section[aria-label="Checks"]') ||
      document.querySelector('section[aria-label="Checks"]') ||
      mergebox ||
      null
    );
  }

  function collectValidationChecks(checksSection) {
    if (!checksSection) {
      return [];
    }

    const nameNodes = Array.from(
      checksSection.querySelectorAll('a, button, summary, span, strong, h4'),
    ).filter((node) => isTrackedValidationCheck(normalizeText(node.textContent || '')));
    const seen = new Set();
    const checks = [];

    for (const node of nameNodes) {
      const container =
        node.closest('li, [role="listitem"], details, tr, article') ||
        node.parentElement ||
        node.closest('section') ||
        node;

      if (seen.has(container)) {
        continue;
      }

      seen.add(container);
      const name = normalizeText(node.textContent || '') || 'Validation';
      const status = detectCheckStatus(container);

      checks.push({
        name,
        status: status.kind,
        terminal: status.terminal,
      });
    }

    if (checks.length > 0) {
      return checks;
    }

    const fallbackChecks = [];
    const lines = String(checksSection.innerText || '')
      .split('\n')
      .map((line) => normalizeText(line))
      .filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
      if (!isTrackedValidationCheck(lines[index])) {
        continue;
      }

      const name = lines[index];
      const context = [lines[index], lines[index + 1] || '', lines[index + 2] || ''].join(' ');
      const status = parseCheckStatus(context);

      fallbackChecks.push({
        name,
        status: status.kind,
        terminal: status.terminal,
      });
    }

    return fallbackChecks;
  }

  function detectCheckStatus(container) {
    const metadata = Array.from(container.querySelectorAll('[aria-label], [title], img[alt]'))
      .map((node) => node.getAttribute('aria-label') || node.getAttribute('title') || node.alt || '')
      .join(' ');
    const combinedText = normalizeText(`${container.innerText || container.textContent || ''} ${metadata}`);
    return parseCheckStatus(combinedText);
  }

  function parseCheckStatus(text) {
    if (/\b(failed|failure|failing|timed out|timeout|error|unsuccessful|action required)\b/i.test(text)) {
      return { kind: 'failed', terminal: true };
    }

    if (/\b(cancelled|canceled)\b/i.test(text)) {
      return { kind: 'cancelled', terminal: true };
    }

    if (/\b(success|successful|passed|succeeded|completed successfully)\b/i.test(text)) {
      return { kind: 'success', terminal: true };
    }

    if (/\b(skipped|neutral|stale)\b/i.test(text)) {
      return { kind: 'neutral', terminal: true };
    }

    if (/\b(in progress|pending|queued|waiting|expected|requested|running|starting|startup)\b/i.test(text)) {
      return { kind: 'running', terminal: false };
    }

    return { kind: 'running', terminal: false };
  }

  function isTrackedValidationCheck(name) {
    if (!/^Validation\b/i.test(name)) {
      return false;
    }

    return !/\bSchema\s*&\s*Annotations\s*Check\b/i.test(name);
  }

  function normalizeText(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  }

  async function sendPageState(message) {
    if (!chrome?.runtime?.id) {
      return;
    }

    try {
      await chrome.runtime.sendMessage(message);
    } catch (error) {
      console.debug('GitHub monitor could not send page state:', error);
    }
  }

  async function loadSettings() {
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get({
      settings: DEFAULT_SETTINGS,
    });
    return normalizeSettings(settings);
  }

  function normalizeSettings(current) {
    return {
      ...DEFAULT_SETTINGS,
      ...current,
      githubUsername: normalizeText(current.githubUsername || DEFAULT_SETTINGS.githubUsername) || 'hisaransh',
    };
  }
  })();
}
