//! Read-only version notification. No downloads, installation or repository data.
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::time::Duration;

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
}
#[derive(Serialize)]
pub struct UpdateInfo {
    current: String,
    latest: Option<String>,
    available: bool,
}
fn version(tag: &str) -> Result<semver::Version, String> {
    let v = semver::Version::parse(tag.strip_prefix('v').unwrap_or(tag))
        .map_err(|_| "Invalid release version")?;
    if !v.pre.is_empty() || !v.build.is_empty() {
        return Err("Invalid release version".into());
    }
    Ok(v)
}
fn info(release: Option<Release>) -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION");
    let release = release.filter(|r| !r.draft && !r.prerelease);
    let latest = release
        .map(|r| version(&r.tag_name).map(|v| (r.tag_name, v)))
        .transpose()?;
    let available = latest
        .as_ref()
        .is_some_and(|(_, v)| *v > version(current).unwrap());
    Ok(UpdateInfo {
        current: current.into(),
        latest: latest.map(|(tag, _)| tag),
        available,
    })
}
#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let client = reqwest::blocking::Client::builder()
            .user_agent(concat!("Mergecraft/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(15))
            .https_only(true)
            .build()
            .map_err(|_| "Version check unavailable")?;
        let response = client
            .get("https://api.github.com/repos/Mohr90/mergecraft/releases/latest")
            .header("Accept", "application/vnd.github+json")
            .send()
            .map_err(|_| "Version check unavailable")?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return info(None);
        }
        let response = response
            .error_for_status()
            .map_err(|_| "Version check unavailable")?;
        let mut bytes = Vec::new();
        response
            .take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Version check unavailable")?;
        if bytes.len() > 1024 * 1024 {
            return Err("Invalid release metadata".into());
        }
        info(Some(
            serde_json::from_slice(&bytes).map_err(|_| "Invalid release metadata")?,
        ))
    })
    .await
    .map_err(|_| "Version check unavailable")?
}
#[tauri::command]
pub fn open_project() -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg("https://github.com/Mohr90/mergecraft")
        .spawn()
        .map(|_| ())
        .map_err(|_| "Could not open browser".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn release(tag: &str) -> Release {
        Release {
            tag_name: tag.into(),
            draft: false,
            prerelease: false,
        }
    }
    #[test]
    fn stable_newer_versions_only() {
        assert!(info(Some(release("v99.0.0"))).unwrap().available);
        assert!(
            !info(Some(release(env!("CARGO_PKG_VERSION"))))
                .unwrap()
                .available
        );
        assert!(!info(Some(release("v0.2.0"))).unwrap().available);
        for tag in ["garbage", "v0.4.0-rc.1", "../latest", "v1.0.0+build"] {
            assert!(info(Some(release(tag))).is_err());
        }
    }
    #[test]
    fn unpublished_versions_are_ignored() {
        let mut r = release("v99.0.0");
        r.draft = true;
        assert!(!info(Some(r)).unwrap().available);
        let mut r = release("v99.0.0");
        r.prerelease = true;
        assert!(!info(Some(r)).unwrap().available);
        assert!(!info(None).unwrap().available);
    }
}
