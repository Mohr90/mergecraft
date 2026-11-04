# Contributing to Mergecraft

Issues and pull requests are welcome. Include the expected behavior, what happened, the Linux distribution, Mergecraft/Git versions and a small reproducible example. Use disposable repositories for destructive or conflict-related tests. Do not attach credentials or private project data.

## Prerequisites

- Linux, Git, a current stable Rust toolchain and Node.js 22 or newer.
- The GTK 3 and WebKitGTK 4.1 development libraries required by Tauri 2.

For Ubuntu/Debian, see the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux). A typical development environment needs:

```bash
sudo apt update
sudo apt install build-essential curl wget file pkg-config \
  libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev libxdo-dev \
  libayatana-appindicator3-dev librsvg2-dev
npm ci
```

## Development

```bash
npm run dev         # Native desktop app
npm run dev:web     # Browser UI with synthetic data
```

The native app is Linux-specific: the folder chooser currently uses GTK directly. A browser preview is not a substitute for native integration testing.

## Checks

```bash
npm run typecheck
npm run build:web
cargo test --locked -p mergecraft-core
npx playwright install chromium
npm run test:browser
npm run build -- --bundles deb
```

The type check also verifies message catalogs and interpolation slots; see [localization](docs/i18n.md). Browser checks cover both languages and state preservation.

`test:browser` starts a Vite server on a free local port and shuts it down afterward. `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` can select existing test tooling. `npm run test:browser:running` instead uses an already running server, with optional `MERGECRAFT_TEST_URL`.

Recreate the README screenshots with synthetic data:

```bash
MERGECRAFT_SCREENSHOT_DIR="$PWD/docs/screenshots" npm run test:browser
```

The screenshot run also captures English workspaces and the v0.4.0 merge tour (`tests/merge-demo.cjs`). The tour includes the safe preview, a same-line proposal, manual resolution, three files, merge completion and a pending push. All data is synthetic. Set `MERGECRAFT_DEMO_GERMAN_DIR` to an output directory to capture a German copy of the tour. `CHROMIUM_PATH` can select an installed Chromium binary.

## Native workflow tests

The fixtures refuse to overwrite an existing directory. Always use a fresh disposable location and separate XDG directories; never run them against your actual project.

```bash
python3 tests/native-fixture.py /tmp/mergecraft-native-example
MERGECRAFT_SELFTEST="$PWD/tests/native-workflows.js" \
MERGECRAFT_SELFTEST_OUT=/tmp/mergecraft-native-result.txt \
XDG_CONFIG_HOME=/tmp/mergecraft-example-config \
XDG_DATA_HOME=/tmp/mergecraft-example-data \
XDG_CACHE_HOME=/tmp/mergecraft-example-cache \
target/release/mergecraft /tmp/mergecraft-native-example
```

`tests/native-advanced-fixture.py` with `tests/native-advanced-actions.js` covers nine real conflicts, and `tests/native-merge-abort.js` checks cancellation and abort while preserving unrelated changes. `tests/native-close.py` checks native close events under Xvfb. These scripts use the native self-test hook, which must only receive trusted local test scripts.

## Pull requests

Keep changes focused, describe the user-visible behavior and include the checks you ran. Cover Git edge cases with a disposable real repository, and UI state changes with browser regressions. Preserve explicit confirmation for destructive operations and never silently overwrite worktree changes or local commits.

Native language switching and restart persistence can be verified after building:

```bash
python3 tests/native-i18n.py target/release/mergecraft
```

This creates its own disposable conflict repository and isolated XDG profiles, and checks that language changes do not modify files, index stages or merge state.
