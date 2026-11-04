# Releases and updates

## Installing

Mergecraft 0.3.0 is built for Linux x86_64. The CI build uses Ubuntu 24.04 and WebKitGTK 4.1. Other distributions are not yet verified. Install the `.deb` from the [latest release](https://github.com/Mohr90/mergecraft/releases/latest) with your system package manager. It declares native library dependencies.

For a user installation, build locally and run `packaging/install.sh`, or place the release executable `mergecraft-linux-x86_64` at `~/.local/bin/mergecraft` and make it executable. The executable still needs the GTK/WebKitGTK libraries declared by the Debian package; it is not an AppImage. Verify its checksum against `SHA256SUMS.txt` before installing it.

Avoid keeping both `/usr/bin/mergecraft` and `~/.local/bin/mergecraft`: the user installation may shadow the package installation. Run `command -v mergecraft` to check which one starts.

## In-app updates

Click the version below the language controls. The About window shows the running version, update status, release notes and an automatic-check preference.

- Startup checks are enabled by default, can be disabled, and contact the public GitHub Releases API at most once per 24 hours (per local app profile/version). Manual checks bypass that interval. Nothing is sent from repositories; GitHub receives a normal HTTPS request, including the app version and network address.
- Only newer stable semantic versions are offered. Drafts, prereleases, downgrades and malformed versions are excluded.
- For **Linux x86_64 user installations exactly at `~/.local/bin/mergecraft`**, choose **Install update**. The app downloads the executable into the same directory, limits its size, verifies the asset size, SHA-256 digest supplied by GitHub and ELF architecture, then replaces the executable with one atomic rename. Failed downloads and failed verification leave the existing installation in place. Symlinks, development binaries and system paths are not replaced.
- For **system/package installations**, choose **Download update** and install the `.deb` with your package manager. Administrative authentication stays with the package manager.
- The running app remains open after installation. Finish your work, close it and reopen it to use the new version. Commit drafts and unsaved merge text are not force-closed.
- Asset SHA-256 checks detect incomplete/corrupt downloads against GitHub's HTTPS metadata. They are **not independent cryptographic publisher signatures**. Protect the GitHub account and release permissions. Signed AppImage update channels are a possible later addition.
- Versions before 0.3.0 need a manual update once; they do not contain the updater.

To return to an earlier version, close Mergecraft, download that release and install it manually using the same installation method. The updater never automatically downgrades.

## Publishing a release

1. Work on a feature branch and run the relevant tests. Keep `package.json`, both package-lock version fields, `core/Cargo.toml`, `src-tauri/Cargo.toml`, `Cargo.lock` and `src-tauri/tauri.conf.json` in sync.
2. Add dated release notes to `CHANGELOG.md`. `node scripts/check-release.mjs` validates versions and notes.
3. Merge the tested change into `main`, create a version tag (for example `v0.3.0`) and push it.
4. `.github/workflows/release.yml` validates the tag, runs Rust/browser/native tests and builds the Debian package. It uploads the package, standalone executable and `SHA256SUMS.txt` to a draft release, then publishes it only after all uploads succeed.
5. Check the published downloads and smoke-test the About window. No signing secrets or external service accounts are needed for this channel.

The workflow can also be started manually on a branch to test packaging without publishing. Failed workflows leave no public partial release; a failed upload may leave a draft to inspect. Tags and released files must not be moved or silently overwritten. Fix a shipped issue in a new patch release.
