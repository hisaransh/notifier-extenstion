# PR & Jenkins Bell Notifier

Chrome/Brave extension that watches open GitHub pull request tabs and Jenkins pages, then plays a bell and shows a desktop notification when work reaches a terminal state.

This project is intentionally DOM-only. It does not use GitHub or Jenkins APIs, does not require tokens, and only reacts to pages that are currently open in the browser.

## Features

- Watches GitHub pull request pages for checks whose names start with `Validation`
- Notifies when watched validation checks finish, including failed or cancelled outcomes
- Watches Jenkins pages and console output for completed build states
- Opens the related tab when a notification is clicked
- Includes a small options page to set the GitHub username to watch and enable or disable sound

## How It Works

### GitHub

The extension runs on GitHub pull request pages, reads the PR author from the rendered page, and monitors the checks UI for `Validation*` jobs. It only sends a notification when those checks transition from a non-terminal state to a terminal one.

### Jenkins

The extension runs on pages that look like Jenkins, with the strongest support for build pages and console output pages. It detects terminal results such as `SUCCESS`, `FAILURE`, `ABORTED`, `UNSTABLE`, and `NOT_BUILT` from the rendered page content.

## Installation

1. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.
5. Open the extension options page and set the GitHub username you want to watch.

## Permissions

- `notifications`: show desktop notifications when a PR check or Jenkins build finishes
- `offscreen`: play the bell sound from an offscreen document
- `scripting`: ensure monitors are available on relevant tabs
- `storage`: save extension settings and tracked page state
- `tabs`: focus the original page when a notification is clicked

## Privacy

- No API calls to GitHub or Jenkins
- No tokens, cookies, or credentials stored by the extension
- No external backend or analytics service
- State is stored locally in browser extension storage

## Limitations

- GitHub monitoring depends on the PR checks UI being visible in the DOM
- Jenkins monitoring depends on the target page exposing recognizable build state in the DOM
- Pages must stay open for the extension to keep watching them
- The default GitHub username is currently `hisaransh` until changed in settings

## Development

This is a Manifest V3 extension with a background service worker, DOM-based content scripts, and an options page.

Key files:

- `manifest.json`: extension manifest and permissions
- `background.js`: notifications, settings sync, tab tracking, and bell playback coordination
- `github-monitor.js`: DOM watcher for GitHub PR checks
- `jenkins-monitor.js`: DOM watcher for Jenkins page state
- `options.html`, `options.css`, `options.js`: settings UI

## Contributing

Issues and pull requests are welcome. If you want to extend support for more Jenkins layouts or GitHub checks patterns, include example DOM states or screenshots where possible.
