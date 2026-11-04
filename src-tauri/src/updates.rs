//! Stable GitHub releases only. No repository data or credentials leave the app.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

const API: &str = "https://api.github.com/repos/Mohr90/mergecraft/releases/latest";
const RELEASES: &str = "https://github.com/Mohr90/mergecraft/releases/latest";
const BINARY: &str = "mergecraft-linux-x86_64";
const MAX_BINARY: u64 = 64 * 1024 * 1024;
static INSTALL: Mutex<()> = Mutex::new(());

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    #[serde(default)]
    assets: Vec<Asset>,
}
#[derive(Clone, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}
#[derive(Serialize)]
pub struct UpdateInfo {
    current: String,
    latest: Option<String>,
    available: bool,
    install_kind: &'static str,
    can_install: bool,
    can_download: bool,
}
fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(concat!("Mergecraft/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|_| "Update check unavailable".into())
}
fn version(tag: &str) -> Result<semver::Version, String> {
    let v = semver::Version::parse(tag.strip_prefix('v').unwrap_or(tag))
        .map_err(|_| "Invalid release version")?;
    if !v.pre.is_empty() || !v.build.is_empty() {
        return Err("Invalid release version".into());
    }
    Ok(v)
}
fn release() -> Result<Option<Release>, String> {
    let response = client()?
        .get(API)
        .header("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(15))
        .send()
        .map_err(|_| "Update check unavailable")?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let response = response
        .error_for_status()
        .map_err(|_| "Update check unavailable")?;
    let mut bytes = Vec::new();
    response
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Update check unavailable")?;
    if bytes.len() > 1024 * 1024 {
        return Err("Invalid release metadata".into());
    }
    let r: Release = serde_json::from_slice(&bytes).map_err(|_| "Invalid release metadata")?;
    version(&r.tag_name)?;
    if r.draft || r.prerelease {
        return Ok(None);
    }
    Ok(Some(r))
}
fn local_executable() -> Option<PathBuf> {
    // Never replace a package-manager binary, development build, or symlink.
    let target = PathBuf::from(std::env::var_os("HOME")?).join(".local/bin/mergecraft");
    let meta = std::fs::symlink_metadata(&target).ok()?;
    if !meta.file_type().is_file() {
        return None;
    }
    let expected = std::fs::canonicalize(&target).ok()?;
    if std::env::current_exe().ok()? != expected {
        return None;
    }
    Some(target)
}
fn download_url(tag: &str, name: &str) -> String {
    format!("https://github.com/Mohr90/mergecraft/releases/download/{tag}/{name}")
}
fn binary(r: &Release) -> Option<&Asset> {
    r.assets.iter().find(|a| {
        a.name == BINARY
            && a.size > 4
            && a.size <= MAX_BINARY
            && a.browser_download_url == download_url(&r.tag_name, BINARY)
            && a.digest.as_deref().is_some_and(valid_digest)
    })
}
fn valid_digest(digest: &str) -> bool {
    digest
        .strip_prefix("sha256:")
        .is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
}
fn deb(r: &Release) -> Option<&Asset> {
    let name = format!("Mergecraft_{}_amd64.deb", version(&r.tag_name).ok()?);
    r.assets
        .iter()
        .find(|a| a.name == name && a.browser_download_url == download_url(&r.tag_name, &name))
}
fn info(r: Option<&Release>) -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION");
    let local = local_executable().is_some();
    let supported = cfg!(all(target_os = "linux", target_arch = "x86_64"));
    let available = r
        .map(|r| version(&r.tag_name).map(|v| v > version(current).unwrap()))
        .transpose()?
        .unwrap_or(false);
    Ok(UpdateInfo {
        current: current.into(),
        latest: r.map(|r| r.tag_name.clone()),
        available,
        install_kind: if local { "user" } else { "package" },
        can_install: available && local && supported && r.and_then(binary).is_some(),
        can_download: available && supported && r.and_then(deb).is_some(),
    })
}
#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let r = release()?;
        info(r.as_ref())
    })
    .await
    .map_err(|_| "Update check unavailable")?
}
#[tauri::command]
pub async fn install_update(expected: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = INSTALL.try_lock().map_err(|_| "Update already running")?;
        if !cfg!(all(target_os = "linux", target_arch = "x86_64")) {
            return Err("Unsupported update installation".into());
        }
        let target = local_executable().ok_or("Unsupported update installation")?;
        let r = release()?.ok_or("Update no longer available")?;
        if r.tag_name != expected || !info(Some(&r))?.available {
            return Err("Update changed; check again".into());
        }
        let a = binary(&r).ok_or("Verified update unavailable")?;
        let response = client()?
            .get(&a.browser_download_url)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|_| "Update download failed")?;
        let temporary = stage_binary(response.take(a.size + 1), a, target.parent().unwrap())?;
        // Validate the running installation again before the single atomic rename.
        if local_executable().as_ref() != Some(&target) {
            return Err("Update installation changed".into());
        }
        temporary
            .persist(&target)
            .map_err(|_| "Update installation failed")?;
        Ok(())
    })
    .await
    .map_err(|_| "Update installation failed")?
}
fn stage_binary(
    mut reader: impl Read,
    a: &Asset,
    directory: &std::path::Path,
) -> Result<tempfile::NamedTempFile, String> {
    let mut temporary =
        tempfile::NamedTempFile::new_in(directory).map_err(|_| "Update installation failed")?;
    let mut hash = Sha256::new();
    let mut total = 0;
    let mut header = Vec::new();
    let mut buffer = [0u8; 32768];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|_| "Update download failed")?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > a.size {
            return Err("Update verification failed".into());
        }
        if header.len() < 20 {
            header.extend_from_slice(&buffer[..count.min(20 - header.len())]);
        }
        hash.update(&buffer[..count]);
        temporary
            .write_all(&buffer[..count])
            .map_err(|_| "Update installation failed")?;
    }
    verify_binary(total, a, &header, &format!("{:x}", hash.finalize()))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| "Update installation failed")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary
            .as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o755))
            .map_err(|_| "Update installation failed")?;
    }
    Ok(temporary)
}
fn verify_binary(total: u64, asset: &Asset, header: &[u8], digest: &str) -> Result<(), String> {
    if total != asset.size
        || asset.digest.as_deref() != Some(&format!("sha256:{digest}"))
        || header.len() < 20
        || &header[..4] != b"\x7fELF"
        || header[4] != 2
        || header[5] != 1
        || header[18..20] != [62, 0]
    {
        return Err("Update verification failed".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn open_update_download() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let r = release()?.ok_or("Update no longer available")?;
        if !info(Some(&r))?.available {
            return Err("Update no longer available".into());
        }
        let a = deb(&r).ok_or("Update download unavailable")?;
        open(&a.browser_download_url)
    })
    .await
    .map_err(|_| "Update download unavailable")?
}
fn open(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|_| "Could not open browser".into())
}
#[tauri::command]
pub fn open_releases() -> Result<(), String> {
    open(RELEASES)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Release {
        serde_json::from_value(serde_json::json!({"tag_name":"v9.0.0","draft":false,"prerelease":false,"assets":[{"name":BINARY,"browser_download_url":download_url("v9.0.0",BINARY),"size":20,"digest":format!("sha256:{}","a".repeat(64))}]})).unwrap()
    }
    #[test]
    fn stable_versions_only() {
        assert!(version("v0.3.0").unwrap() > version("0.2.0").unwrap());
        for value in ["v0.3.0-rc.1", "../latest", "v0.3.0+test", "garbage"] {
            assert!(version(value).is_err());
        }
    }
    #[test]
    fn rejects_missing_digest_and_foreign_urls() {
        let mut r = fixture();
        assert!(binary(&r).is_some());
        r.assets[0].digest = None;
        assert!(binary(&r).is_none());
        r = fixture();
        r.assets[0].browser_download_url = "https://example.com/update".into();
        assert!(binary(&r).is_none());
    }
    #[test]
    fn validates_size_checksum_and_architecture() {
        let r = fixture();
        let a = &r.assets[0];
        let mut h = vec![0; 20];
        h[..4].copy_from_slice(b"\x7fELF");
        h[4] = 2;
        h[5] = 1;
        h[18] = 62;
        assert!(verify_binary(20, a, &h, &"a".repeat(64)).is_ok());
        assert!(verify_binary(19, a, &h, &"a".repeat(64)).is_err());
        assert!(verify_binary(20, a, &h, &"b".repeat(64)).is_err());
        h[18] = 183;
        assert!(verify_binary(20, a, &h, &"a".repeat(64)).is_err());
    }
    #[test]
    fn atomic_replacement_and_failed_download_preserve_existing_installation() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("mergecraft");
        std::fs::write(&target, b"old executable").unwrap();
        let mut running = std::fs::File::open(&target).unwrap();
        let mut data = vec![0; 20];
        data[..4].copy_from_slice(b"\x7fELF");
        data[4] = 2;
        data[5] = 1;
        data[18] = 62;
        let a = Asset {
            name: BINARY.into(),
            browser_download_url: String::new(),
            size: data.len() as u64,
            digest: Some(format!("sha256:{:x}", Sha256::digest(&data))),
        };
        assert!(stage_binary(&data[..19], &a, dir.path()).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"old executable");
        let mut corrupt = data.clone();
        corrupt[19] = 1;
        assert!(stage_binary(&corrupt[..], &a, dir.path()).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"old executable");
        stage_binary(&data[..], &a, dir.path())
            .unwrap()
            .persist(&target)
            .unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), data);
        let mut old = Vec::new();
        running.read_to_end(&mut old).unwrap();
        assert_eq!(old, b"old executable");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
