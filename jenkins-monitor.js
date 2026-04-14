(async () => {
  let lastUrl = location.href;
  let lastSignature = '';
  let scheduled = false;

  if (!looksLikeJenkinsPage()) {
    return;
  }

  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'local' || !changes.settings) {
      return;
    }

    lastSignature = '';
    scheduleEvaluate();
  });

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
      evaluatePage();
    }, 350);
  }

  function evaluatePage() {
    if (!looksLikeJenkinsPage()) {
      return;
    }

    const consoleOutput = document.querySelector('pre.console-output#out');
    const pageText = normalizeText(
      consoleOutput?.innerText || document.body?.innerText || '',
    );
    const label = detectLabel();
    const explicitResult = detectExplicitResult(pageText);
    const iconResult = explicitResult ? null : detectIconResult();
    const status = explicitResult
      ? 'completed'
      : iconResult
        ? 'completed'
        : detectRunningState(pageText)
          ? 'running'
          : 'idle';
    const result = explicitResult || iconResult || '';
    const details = consoleOutput
      ? 'Watching pipeline console output'
      : 'Watching Jenkins page state';

    const state = {
      relevant: true,
      status,
      result,
      label,
      details,
      url: location.href,
    };
    const signature = JSON.stringify(state);

    if (signature === lastSignature) {
      return;
    }

    lastSignature = signature;
    chrome.runtime.sendMessage({
      type: 'page-state',
      site: 'jenkins',
      state,
    });
  }

  function looksLikeJenkinsPage() {
    return Boolean(
      document.querySelector('pre.console-output#out') ||
      document.querySelector('#jenkins-head-icon, .jenkins-app-bar, .jenkins-breadcrumbs') ||
        document.querySelector('img[alt="Jenkins"]') ||
        /\bJenkins\b/i.test(document.title),
    );
  }

  function detectLabel() {
    const heading = document.querySelector('#main-panel h1, .jenkins-breadcrumbs__list-item--active');
    const titleText = normalizeText(heading?.textContent);
    if (titleText) {
      return titleText;
    }

    return document.title.replace(/\s*[-|]\s*Jenkins.*$/, '').trim() || 'Jenkins build';
  }

  function detectExplicitResult(pageText) {
    const match =
      pageText.match(/\bFinished:\s*(SUCCESS|FAILURE|ABORTED|UNSTABLE|NOT_BUILT)\b/i) ||
      pageText.match(/\bResult:\s*(SUCCESS|FAILURE|ABORTED|UNSTABLE|NOT_BUILT)\b/i);

    return match ? match[1].toUpperCase() : '';
  }

  function detectRunningState(pageText) {
    if (/\b(in progress|building|running)\b/i.test(pageText)) {
      return true;
    }

    return Boolean(
      document.querySelector(
        '[class*="icon-"][class*="-anime"], img[src*="anime"], svg[class*="-anime"]',
      ),
    );
  }

  function detectIconResult() {
    const statusNode = document.querySelector(
      '#main-panel img[class*="icon-"], #main-panel svg[class*="icon-"], .build-caption img[class*="icon-"]',
    );
    if (!statusNode) {
      return '';
    }

    const text = [
      statusNode.getAttribute('class') || '',
      statusNode.getAttribute('src') || '',
      statusNode.getAttribute('alt') || '',
    ]
      .join(' ')
      .toLowerCase();

    if (/anime/.test(text)) {
      return '';
    }

    if (/\bicon-blue\b|blue\./.test(text)) {
      return 'SUCCESS';
    }

    if (/\bicon-red\b|red\./.test(text)) {
      return 'FAILURE';
    }

    if (/\bicon-yellow\b|yellow\./.test(text)) {
      return 'UNSTABLE';
    }

    if (/\bicon-aborted\b|aborted\./.test(text)) {
      return 'ABORTED';
    }

    if (/\bicon-grey\b|\bicon-disabled\b|grey\./.test(text)) {
      return 'NOT_BUILT';
    }

    return '';
  }

  function normalizeText(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  }
})();
