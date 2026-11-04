# Releases and version information

## Installing

Mergecraft targets Linux x86_64. Release builds use Ubuntu 24.04, GTK 3 and WebKitGTK 4.1. Other distributions are not yet verified. Install the `.deb` from the [GitHub project](https://github.com/Mohr90/mergecraft) using your package manager.

For a user installation, build locally and run `packaging/install.sh`. Release executables still need the native libraries declared by the Debian package. Check downloads against `SHA256SUMS.txt` before installing manually.

Avoid parallel installations at `/usr/bin/mergecraft` and `~/.local/bin/mergecraft`: the user installation may shadow the package installation. `command -v mergecraft` shows the active path.

## Version information in the app

The footer always displays the installed version. Click it to see whether a newer stable version is available and open the GitHub project. The app does not download, install or restart anything. The dialog contains no release notes or updater settings.

A background check at startup contacts the public GitHub Releases API at most once per 24 hours per profile/version. Opening the dialog checks when no result is known or a previous check failed. No repository data is transmitted; GitHub receives an HTTPS request including the app version and network address. Drafts, prereleases and older versions are not offered as new versions. The status is informational: updates are installed manually from GitHub.

## Publishing

1. Keep the version in `package.json`, both package-lock root fields, both Cargo manifests, `Cargo.lock` and `src-tauri/tauri.conf.json` consistent; add the dated changelog entry.
2. Test and merge the feature branch through a pull request. `node scripts/check-release.mjs` validates release metadata.
3. Tag the tested main commit with its version and push the tag. The Release workflow runs Rust, browser and native tests, builds the Debian package and publishes the package, standalone executable and SHA-256 checksums after every check succeeds.
4. Verify the public assets and smoke-test the published executable.

An empty manual-dispatch tag builds without publishing. To retry an unpublished tag after a CI orchestration fix, run the workflow from main and supply the existing tag. The workflow checks out the immutable tag and repeats all tests. Do not move existing tags or overwrite published assets. Native tests start after the frontend reports readiness and use software rendering and their own D-Bus session inside Xvfb on headless runners.
