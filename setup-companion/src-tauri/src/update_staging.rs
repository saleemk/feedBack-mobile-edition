use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::{
    update_identity_for_checkout, validate_stable_release_tag, UiError, UpdateIdentityPayload,
};

const EDITION_RELEASE_DOWNLOAD_BASE_URL: &str =
    "https://github.com/saleemk/feedBack-mobile-edition/releases/download/";
const UPDATE_CACHE_CHILD: &str = "update-cache";
const MAX_CHECKSUM_BYTES: u64 = 1024;
const MAX_SETUP_ZIP_BYTES: u64 = 2_500_000_000;
const UPDATE_HTTP_MAX_REDIRECTS: usize = 5;
const UPDATE_HTTP_CONNECT_TIMEOUT_SECS: u64 = 15;
const UPDATE_HTTP_READ_STALL_TIMEOUT_SECS: u64 = 60;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStagePayload {
    pub status: String,
    pub tag: String,
    pub phase: String,
    pub filename: String,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_downloaded: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_total: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStageProgressPayload {
    pub tag: String,
    pub phase: String,
    pub label: String,
    pub bytes_downloaded: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_total: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetupBundleUpdateSpec {
    pub tag: String,
    pub zip_name: String,
    pub checksum_name: String,
    pub zip_url: String,
    pub checksum_url: String,
    pub cache_dir: PathBuf,
    pub final_zip_path: PathBuf,
    pub partial_zip_path: PathBuf,
    pub checksum_path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpdateHttpClientPolicy {
    pub max_redirects: usize,
    pub connect_timeout_secs: u64,
    pub read_stall_timeout_secs: u64,
}

pub fn ensure_setup_bundle_update_eligible(root: &Path) -> Result<UpdateIdentityPayload, UiError> {
    let identity = update_identity_for_checkout(root);
    if identity.status == "ready" && identity.source == "setup_bundle" {
        Ok(identity)
    } else {
        Err(UiError::new(
            "update_stage_ineligible",
            "Setup-bundle update staging is available only for installed setup bundles.",
        ))
    }
}

pub fn ensure_setup_bundle_update_target_eligible(
    root: &Path,
    target_tag: &str,
) -> Result<UpdateIdentityPayload, UiError> {
    let identity = ensure_setup_bundle_update_eligible(root)?;
    let target = release_parts_from_tag(target_tag)?;
    let local_tag = identity.local_tag.as_deref().ok_or_else(|| {
        UiError::new(
            "update_stage_ineligible",
            "Installed setup bundle identity is missing its local release tag.",
        )
    })?;
    let local = release_parts_from_tag(local_tag)?;
    if compare_release_parts(target, local) <= 0 {
        return Err(UiError::new(
            "update_stage_not_newer",
            "Only newer stable setup-bundle updates can be staged.",
        ));
    }
    Ok(identity)
}

fn release_parts_from_tag(tag: &str) -> Result<[u64; 3], UiError> {
    let version = validate_stable_release_tag(tag)?;
    let parts = version
        .strip_prefix('v')
        .expect("validated stable tags always have v prefix")
        .split('.')
        .map(|part| part.parse::<u64>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| {
            UiError::new(
                "update_review_invalid_tag",
                "The latest stable release tag is not supported.",
            )
        })?;
    Ok([parts[0], parts[1], parts[2]])
}

fn compare_release_parts(left: [u64; 3], right: [u64; 3]) -> i8 {
    for index in 0..3 {
        if left[index] > right[index] {
            return 1;
        }
        if left[index] < right[index] {
            return -1;
        }
    }
    0
}

pub trait UpdateDownloadSource {
    fn download_to_vec(&mut self, url: &str, max_bytes: u64) -> Result<Vec<u8>, UiError>;
    fn download_to_file(
        &mut self,
        url: &str,
        path: &Path,
        max_bytes: u64,
        progress: &mut dyn FnMut(u64, Option<u64>),
    ) -> Result<u64, UiError>;
}

pub struct ReqwestUpdateDownloadSource {
    client: reqwest::Client,
}

impl ReqwestUpdateDownloadSource {
    pub fn new() -> Result<Self, UiError> {
        Ok(Self {
            client: build_update_http_client()?,
        })
    }
}

impl UpdateDownloadSource for ReqwestUpdateDownloadSource {
    fn download_to_vec(&mut self, url: &str, max_bytes: u64) -> Result<Vec<u8>, UiError> {
        tauri::async_runtime::block_on(download_url_to_vec(&self.client, url, max_bytes))
    }

    fn download_to_file(
        &mut self,
        url: &str,
        path: &Path,
        max_bytes: u64,
        progress: &mut dyn FnMut(u64, Option<u64>),
    ) -> Result<u64, UiError> {
        tauri::async_runtime::block_on(download_url_to_file(
            &self.client,
            url,
            path,
            max_bytes,
            progress,
        ))
    }
}

pub fn update_http_client_policy() -> UpdateHttpClientPolicy {
    UpdateHttpClientPolicy {
        max_redirects: UPDATE_HTTP_MAX_REDIRECTS,
        connect_timeout_secs: UPDATE_HTTP_CONNECT_TIMEOUT_SECS,
        read_stall_timeout_secs: UPDATE_HTTP_READ_STALL_TIMEOUT_SECS,
    }
}

fn build_update_http_client() -> Result<reqwest::Client, UiError> {
    let policy = update_http_client_policy();
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(policy.connect_timeout_secs))
        .read_timeout(Duration::from_secs(policy.read_stall_timeout_secs))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= policy.max_redirects {
                attempt.stop()
            } else if update_download_url_allowed(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|_| {
            UiError::new(
                "update_download_failed",
                "Could not prepare update download.",
            )
        })
}

pub fn update_download_url_allowed(url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    url.scheme() == "https" && (host == "github.com" || host.ends_with(".githubusercontent.com"))
}

fn ensure_update_download_url_allowed(url: &str) -> Result<(), UiError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| {
        UiError::new(
            "update_download_failed",
            "Update download URL is not supported.",
        )
    })?;
    if update_download_url_allowed(&parsed) {
        Ok(())
    } else {
        Err(UiError::new(
            "update_download_failed",
            "Update download URL is not supported.",
        ))
    }
}

async fn download_url_to_vec(
    client: &reqwest::Client,
    url: &str,
    max_bytes: u64,
) -> Result<Vec<u8>, UiError> {
    ensure_update_download_url_allowed(url)?;
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/octet-stream")
        .send()
        .await
        .map_err(|_| UiError::new("update_download_failed", "Could not download update data."))?;
    if !response.status().is_success() {
        return Err(UiError::new(
            "update_download_failed",
            "Could not download update data.",
        ));
    }
    if response
        .content_length()
        .is_some_and(|total| total > max_bytes)
    {
        return Err(UiError::new(
            "update_download_overflow",
            "Downloaded update data exceeded the allowed size.",
        ));
    }

    let mut downloaded = Vec::new();
    let mut response = response;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| UiError::new("update_download_failed", "Could not download update data."))?
    {
        let next_len = downloaded.len() as u64 + chunk.len() as u64;
        if next_len > max_bytes {
            return Err(UiError::new(
                "update_download_overflow",
                "Downloaded update data exceeded the allowed size.",
            ));
        }
        downloaded.extend_from_slice(&chunk);
    }
    Ok(downloaded)
}

async fn download_url_to_file(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    max_bytes: u64,
    progress: &mut dyn FnMut(u64, Option<u64>),
) -> Result<u64, UiError> {
    ensure_update_download_url_allowed(url)?;
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/octet-stream")
        .send()
        .await
        .map_err(|_| {
            UiError::new(
                "update_download_failed",
                "Could not download update package.",
            )
        })?;
    if !response.status().is_success() {
        return Err(UiError::new(
            "update_download_failed",
            "Could not download update package.",
        ));
    }
    let total = response.content_length();
    if total.is_some_and(|total| total > max_bytes) {
        return Err(UiError::new(
            "update_download_overflow",
            "Downloaded update package exceeded the allowed size.",
        ));
    }

    let mut file = fs::File::create(path).map_err(|_| {
        UiError::new(
            "update_cache_write_failed",
            "Could not create the update cache file.",
        )
    })?;
    let mut downloaded = 0_u64;
    let mut response = response;
    progress(downloaded, total);
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        UiError::new(
            "update_download_failed",
            "Could not download update package.",
        )
    })? {
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > max_bytes {
            return Err(UiError::new(
                "update_download_overflow",
                "Downloaded update package exceeded the allowed size.",
            ));
        }
        file.write_all(&chunk).map_err(|_| {
            UiError::new(
                "update_cache_write_failed",
                "Could not write the update cache file.",
            )
        })?;
        progress(downloaded, total);
    }
    file.sync_all().map_err(|_| {
        UiError::new(
            "update_cache_write_failed",
            "Could not finalize the update cache file.",
        )
    })?;
    Ok(downloaded)
}

pub fn local_update_cache_root() -> Result<PathBuf, UiError> {
    dirs::data_local_dir()
        .map(|root| {
            root.join("fee[dB]ack Mobile Edition")
                .join(UPDATE_CACHE_CHILD)
        })
        .ok_or_else(|| {
            UiError::new(
                "update_cache_unavailable",
                "Could not locate the local update cache.",
            )
        })
}

pub fn setup_bundle_update_spec_for_tag(
    tag: &str,
    cache_root: &Path,
) -> Result<SetupBundleUpdateSpec, UiError> {
    let validated = validate_stable_release_tag(tag)?;
    let zip_name = format!("feedback-mobile-edition-{validated}-windows-setup.zip");
    let checksum_name = format!("{zip_name}.sha256");
    let cache_dir = cache_root.join(validated);
    let final_zip_path = cache_dir.join(&zip_name);
    let partial_zip_path = cache_dir.join(format!("{zip_name}.part"));
    let checksum_path = cache_dir.join(&checksum_name);
    let spec = SetupBundleUpdateSpec {
        tag: validated.to_string(),
        zip_name,
        checksum_name,
        zip_url: format!("{EDITION_RELEASE_DOWNLOAD_BASE_URL}{validated}/feedback-mobile-edition-{validated}-windows-setup.zip"),
        checksum_url: format!("{EDITION_RELEASE_DOWNLOAD_BASE_URL}{validated}/feedback-mobile-edition-{validated}-windows-setup.zip.sha256"),
        cache_dir,
        final_zip_path,
        partial_zip_path,
        checksum_path,
    };
    ensure_update_cache_path(cache_root, &spec.cache_dir)?;
    ensure_update_cache_path(cache_root, &spec.final_zip_path)?;
    ensure_update_cache_path(cache_root, &spec.partial_zip_path)?;
    ensure_update_cache_path(cache_root, &spec.checksum_path)?;
    Ok(spec)
}

fn ensure_update_cache_path(cache_root: &Path, path: &Path) -> Result<(), UiError> {
    if path.starts_with(cache_root) {
        Ok(())
    } else {
        Err(UiError::new(
            "update_cache_path_invalid",
            "Update cache path is outside the allowed cache directory.",
        ))
    }
}

pub fn parse_checksum_sidecar(content: &[u8], expected_filename: &str) -> Result<String, UiError> {
    let text = std::str::from_utf8(content).map_err(|_| {
        UiError::new(
            "update_checksum_invalid",
            "Update checksum sidecar is not valid UTF-8.",
        )
    })?;
    let trimmed = text.trim();
    let lines = trimmed.lines().collect::<Vec<_>>();
    if lines.len() != 1 {
        return Err(UiError::new(
            "update_checksum_invalid",
            "Update checksum sidecar must contain exactly one record.",
        ));
    }
    let fields = lines[0].split_whitespace().collect::<Vec<_>>();
    if fields.len() != 2 {
        return Err(UiError::new(
            "update_checksum_invalid",
            "Update checksum sidecar has an unsupported format.",
        ));
    }
    let digest = fields[0];
    let filename = fields[1];
    if digest.len() != 64
        || !digest
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(UiError::new(
            "update_checksum_invalid",
            "Update checksum sidecar has an unsupported SHA-256 digest.",
        ));
    }
    if filename != expected_filename || filename.contains('/') || filename.contains('\\') {
        return Err(UiError::new(
            "update_checksum_invalid",
            "Update checksum sidecar does not match the expected package filename.",
        ));
    }
    Ok(digest.to_ascii_lowercase())
}

pub fn sha256_file_hex(path: &Path) -> Result<String, UiError> {
    let file = fs::File::open(path).map_err(|_| {
        UiError::new(
            "update_cache_read_failed",
            "Could not read the update cache file.",
        )
    })?;
    sha256_reader_hex(BufReader::with_capacity(64 * 1024, file)).map_err(|_| {
        UiError::new(
            "update_cache_read_failed",
            "Could not read the update cache file.",
        )
    })
}

pub fn sha256_reader_hex<R: Read>(mut reader: R) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    let digest = hasher.finalize();
    Ok(hex_digest(&digest))
}

#[cfg(test)]
fn sha256_bytes_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex_digest(&digest)
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn stage_setup_bundle_update_for_tag<T, F>(
    tag: &str,
    cache_root: &Path,
    transport: &mut T,
    mut progress: F,
) -> Result<UpdateStagePayload, UiError>
where
    T: UpdateDownloadSource,
    F: FnMut(UpdateStageProgressPayload),
{
    let spec = setup_bundle_update_spec_for_tag(tag, cache_root)?;
    fs::create_dir_all(&spec.cache_dir).map_err(|_| {
        UiError::new(
            "update_cache_write_failed",
            "Could not create the update cache directory.",
        )
    })?;
    remove_file_if_exists(&spec.partial_zip_path)?;
    remove_file_if_exists(&spec.checksum_path)?;

    let checksum_bytes = match transport.download_to_vec(&spec.checksum_url, MAX_CHECKSUM_BYTES) {
        Ok(bytes) => bytes,
        Err(error) => {
            cleanup_update_artifacts(&spec);
            return Err(error);
        }
    };
    let expected_sha256 = match parse_checksum_sidecar(&checksum_bytes, &spec.zip_name) {
        Ok(checksum) => checksum,
        Err(error) => {
            cleanup_update_artifacts(&spec);
            return Err(error);
        }
    };
    if let Err(error) = fs::write(&spec.checksum_path, &checksum_bytes).map_err(|_| {
        UiError::new(
            "update_cache_write_failed",
            "Could not write the update checksum sidecar.",
        )
    }) {
        cleanup_update_artifacts(&spec);
        return Err(error);
    }

    if spec.final_zip_path.is_file() {
        emit_update_progress(&mut progress, &spec.tag, "verifying", 0, None);
        match sha256_file_hex(&spec.final_zip_path) {
            Ok(hash) if hash.eq_ignore_ascii_case(&expected_sha256) => {
                return Ok(update_stage_payload(
                    "ready",
                    &spec,
                    "cached",
                    "Verified cached update package for later install.",
                    None,
                    None,
                ));
            }
            Ok(_) => {
                if let Err(error) = remove_file_if_exists(&spec.final_zip_path) {
                    cleanup_update_artifacts(&spec);
                    return Err(error);
                }
            }
            Err(error) => {
                cleanup_update_artifacts(&spec);
                return Err(error);
            }
        }
    }

    let mut download_progress = |downloaded, total| {
        emit_update_progress(&mut progress, &spec.tag, "downloading", downloaded, total);
    };
    let downloaded = match transport.download_to_file(
        &spec.zip_url,
        &spec.partial_zip_path,
        MAX_SETUP_ZIP_BYTES,
        &mut download_progress,
    ) {
        Ok(bytes) => bytes,
        Err(error) => {
            cleanup_update_artifacts(&spec);
            return Err(error);
        }
    };

    emit_update_progress(
        &mut progress,
        &spec.tag,
        "verifying",
        downloaded,
        Some(downloaded),
    );
    let actual_sha256 = match sha256_file_hex(&spec.partial_zip_path) {
        Ok(hash) => hash,
        Err(error) => {
            cleanup_update_artifacts(&spec);
            return Err(error);
        }
    };
    if !actual_sha256.eq_ignore_ascii_case(&expected_sha256) {
        cleanup_update_artifacts(&spec);
        return Err(UiError::new(
            "update_verification_failed",
            "Update package verification failed.",
        ));
    }

    if let Err(error) = remove_file_if_exists(&spec.final_zip_path) {
        cleanup_update_artifacts(&spec);
        return Err(error);
    }
    fs::rename(&spec.partial_zip_path, &spec.final_zip_path).map_err(|_| {
        cleanup_update_artifacts(&spec);
        UiError::new(
            "update_cache_write_failed",
            "Could not finalize the verified update package.",
        )
    })?;

    Ok(update_stage_payload(
        "ready",
        &spec,
        "verified",
        "Verified update package for later install.",
        Some(downloaded),
        Some(downloaded),
    ))
}

fn update_stage_payload(
    status: &str,
    spec: &SetupBundleUpdateSpec,
    phase: &str,
    reason: &str,
    bytes_downloaded: Option<u64>,
    bytes_total: Option<u64>,
) -> UpdateStagePayload {
    UpdateStagePayload {
        status: status.to_string(),
        tag: spec.tag.clone(),
        phase: phase.to_string(),
        filename: spec.zip_name.clone(),
        reason: reason.to_string(),
        bytes_downloaded,
        bytes_total,
    }
}

fn emit_update_progress<F>(
    progress: &mut F,
    tag: &str,
    phase: &str,
    bytes_downloaded: u64,
    bytes_total: Option<u64>,
) where
    F: FnMut(UpdateStageProgressPayload),
{
    progress(UpdateStageProgressPayload {
        tag: tag.to_string(),
        phase: phase.to_string(),
        label: match phase {
            "verifying" => "Verifying update",
            _ => "Downloading update",
        }
        .to_string(),
        bytes_downloaded,
        bytes_total,
    });
}

fn cleanup_update_artifacts(spec: &SetupBundleUpdateSpec) {
    let _ = remove_file_if_exists(&spec.partial_zip_path);
    let _ = remove_file_if_exists(&spec.checksum_path);
}

fn remove_file_if_exists(path: &Path) -> Result<(), UiError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(UiError::new(
            "update_cache_write_failed",
            "Could not clean the update cache.",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::env;
    use std::fs;
    use std::rc::Rc;

    fn temp_root(name: &str) -> PathBuf {
        let mut root = env::temp_dir();
        root.push(format!(
            "feedback-setup-companion-{name}-{}",
            std::process::id()
        ));
        if root.exists() {
            fs::remove_dir_all(&root).expect("remove stale temp root");
        }
        fs::create_dir_all(root.join("scripts")).expect("create temp scripts");
        root
    }

    fn write_valid_identity(root: &Path, version: &str, tag: &str) {
        fs::write(
            root.join("MOBILE-EDITION-IDENTITY.json"),
            format!(
                r#"{{
                  "schema": "feedback-mobile-edition.identity.v1",
                  "editionVersion": "{version}",
                  "releaseTag": "{tag}",
                  "checkoutKind": "development",
                  "latestStableReleaseApiUrl": "https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest"
                }}"#
            ),
        )
        .expect("write identity metadata");
    }

    struct FakeUpdateDownloadSource {
        checksum: Result<Vec<u8>, UiError>,
        package: Result<Vec<u8>, UiError>,
        write_package: bool,
        vec_calls: Vec<String>,
        file_calls: Vec<String>,
    }

    impl FakeUpdateDownloadSource {
        fn new(checksum: Result<Vec<u8>, UiError>, package: Result<Vec<u8>, UiError>) -> Self {
            Self {
                checksum,
                package,
                write_package: true,
                vec_calls: Vec::new(),
                file_calls: Vec::new(),
            }
        }

        fn without_package_write(mut self) -> Self {
            self.write_package = false;
            self
        }
    }

    impl UpdateDownloadSource for FakeUpdateDownloadSource {
        fn download_to_vec(&mut self, url: &str, max_bytes: u64) -> Result<Vec<u8>, UiError> {
            self.vec_calls.push(url.to_string());
            let bytes = self.checksum.clone()?;
            if bytes.len() as u64 > max_bytes {
                return Err(UiError::new(
                    "update_download_overflow",
                    "Downloaded update data exceeded the allowed size.",
                ));
            }
            Ok(bytes)
        }

        fn download_to_file(
            &mut self,
            url: &str,
            path: &Path,
            max_bytes: u64,
            progress: &mut dyn FnMut(u64, Option<u64>),
        ) -> Result<u64, UiError> {
            self.file_calls.push(url.to_string());
            let bytes = self.package.clone()?;
            if bytes.len() as u64 > max_bytes {
                return Err(UiError::new(
                    "update_download_overflow",
                    "Downloaded update package exceeded the allowed size.",
                ));
            }
            progress(0, Some(bytes.len() as u64));
            if self.write_package {
                fs::write(path, &bytes).expect("write fake package");
            }
            progress(bytes.len() as u64, Some(bytes.len() as u64));
            Ok(bytes.len() as u64)
        }
    }

    struct CountingReader {
        data: Vec<u8>,
        position: usize,
        max_chunk: usize,
        reads: Rc<Cell<usize>>,
    }

    impl Read for CountingReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.reads.set(self.reads.get() + 1);
            if self.position >= self.data.len() {
                return Ok(0);
            }
            let available = self.data.len() - self.position;
            let count = available.min(buffer.len()).min(self.max_chunk);
            buffer[..count].copy_from_slice(&self.data[self.position..self.position + count]);
            self.position += count;
            Ok(count)
        }
    }

    fn checksum_record(bytes: &[u8], filename: &str) -> Vec<u8> {
        format!("{}  {filename}\n", sha256_bytes_hex(bytes)).into_bytes()
    }

    #[test]
    fn setup_bundle_update_spec_derives_only_fixed_names_urls_and_cache_paths() {
        let cache_root = temp_root("update-spec-cache");
        let spec = setup_bundle_update_spec_for_tag("v1.2.3", &cache_root).expect("update spec");

        assert_eq!(spec.tag, "v1.2.3");
        assert_eq!(
            spec.zip_name,
            "feedback-mobile-edition-v1.2.3-windows-setup.zip"
        );
        assert_eq!(
            spec.checksum_name,
            "feedback-mobile-edition-v1.2.3-windows-setup.zip.sha256"
        );
        assert_eq!(
            spec.zip_url,
            "https://github.com/saleemk/feedBack-mobile-edition/releases/download/v1.2.3/feedback-mobile-edition-v1.2.3-windows-setup.zip"
        );
        assert_eq!(
            spec.checksum_url,
            "https://github.com/saleemk/feedBack-mobile-edition/releases/download/v1.2.3/feedback-mobile-edition-v1.2.3-windows-setup.zip.sha256"
        );
        assert!(spec.cache_dir.starts_with(&cache_root));
        assert!(spec.final_zip_path.starts_with(&cache_root));
        assert!(spec.partial_zip_path.starts_with(&cache_root));
        assert!(spec.checksum_path.starts_with(&cache_root));

        for tag in ["v1.2.3-rc.1", "../v1.2.3", "v1.2.3/download", "1.2.3"] {
            assert!(setup_bundle_update_spec_for_tag(tag, &cache_root).is_err());
        }

        fs::remove_dir_all(cache_root).expect("remove temp root");
    }

    #[test]
    fn setup_bundle_update_native_eligibility_requires_installed_bundle_identity() {
        let development_root = temp_root("update-ineligible-dev");
        write_valid_identity(&development_root, "0.3.0", "v0.3.0");
        let error = ensure_setup_bundle_update_target_eligible(&development_root, "v0.3.1")
            .expect_err("development checkout cannot stage setup bundle update");
        assert_eq!(error.code, "update_stage_ineligible");
        fs::remove_dir_all(development_root).expect("remove temp root");

        let bundle_root = temp_root("update-eligible-bundle");
        fs::write(
            bundle_root.join("SETUP-BUNDLE-MANIFEST.json"),
            r#"{
              "schema": "feedback-mobile-edition.setup-bundle.v1",
              "editionVersion": "v1.2.3"
            }"#,
        )
        .expect("write bundle manifest");
        let identity = ensure_setup_bundle_update_target_eligible(&bundle_root, "v1.2.4")
            .expect("newer setup bundle can be staged");
        assert_eq!(identity.source, "setup_bundle");

        for tag in ["v1.2.3", "v1.2.2", "v1.1.9"] {
            let error = ensure_setup_bundle_update_target_eligible(&bundle_root, tag)
                .expect_err("equal or older target cannot be staged");
            assert_eq!(error.code, "update_stage_not_newer", "{tag}");
        }
        fs::remove_dir_all(bundle_root).expect("remove temp root");
    }

    #[test]
    fn update_http_policy_is_https_only_bounded_and_github_scoped() {
        let policy = update_http_client_policy();
        assert_eq!(policy.max_redirects, 5);
        assert!(policy.connect_timeout_secs > 0);
        assert!(policy.connect_timeout_secs <= 30);
        assert!(policy.read_stall_timeout_secs >= 30);
        assert!(policy.read_stall_timeout_secs <= 120);
        assert!(build_update_http_client().is_ok());

        for url in [
            "https://github.com/saleemk/feedBack-mobile-edition/releases/download/v1.2.3/file.zip",
            "https://objects.githubusercontent.com/github-production-release-asset/file.zip",
            "https://release-assets.githubusercontent.com/github-production-release-asset/file.zip",
        ] {
            let parsed = reqwest::Url::parse(url).expect("allowed URL");
            assert!(update_download_url_allowed(&parsed), "{url}");
        }

        for url in [
            "http://github.com/saleemk/feedBack-mobile-edition/releases/download/v1.2.3/file.zip",
            "https://github.com.evil.example/file.zip",
            "https://evilgithubusercontent.com/file.zip",
            "https://example.com/file.zip",
        ] {
            let parsed = reqwest::Url::parse(url).expect("blocked URL");
            assert!(!update_download_url_allowed(&parsed), "{url}");
        }
    }

    #[test]
    fn sha256_reader_hashes_streaming_chunks_without_full_file_read() {
        let reads = Rc::new(Cell::new(0));
        let data = (0..200_000)
            .map(|index| (index % 251) as u8)
            .collect::<Vec<_>>();
        let reader = CountingReader {
            data: data.clone(),
            position: 0,
            max_chunk: 777,
            reads: Rc::clone(&reads),
        };

        let streaming_hash = sha256_reader_hex(reader).expect("streaming hash");

        assert_eq!(streaming_hash, sha256_bytes_hex(&data));
        assert!(reads.get() > 10);
    }

    #[test]
    fn checksum_sidecar_parser_accepts_one_exact_record_only() {
        let filename = "feedback-mobile-edition-v1.2.3-windows-setup.zip";
        let digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        assert_eq!(
            parse_checksum_sidecar(format!("{digest}  {filename}\n").as_bytes(), filename)
                .expect("checksum"),
            digest
        );
        assert_eq!(
            parse_checksum_sidecar(
                format!("{}  {filename}", digest.to_uppercase()).as_bytes(),
                filename
            )
            .expect("uppercase checksum"),
            digest
        );

        for content in [
            format!("{digest}  {filename}\n{digest}  {filename}\n"),
            format!("abc  {filename}\n"),
            format!("{digest}  other.zip\n"),
            format!("{digest}  ..\\{filename}\n"),
            format!("{digest}  ../{filename}\n"),
            format!("{digest}  {filename} extra\n"),
        ] {
            let error = parse_checksum_sidecar(content.as_bytes(), filename)
                .expect_err("reject invalid checksum sidecar");
            assert_eq!(error.code, "update_checksum_invalid");
        }
    }

    #[test]
    fn stage_setup_bundle_update_verifies_and_atomically_finalizes_tiny_package() {
        let cache_root = temp_root("update-success-cache");
        let package = b"tiny setup zip bytes".to_vec();
        let spec = setup_bundle_update_spec_for_tag("v1.2.3", &cache_root).expect("spec");
        let checksum = Ok(checksum_record(&package, &spec.zip_name));
        let mut transport = FakeUpdateDownloadSource::new(checksum, Ok(package.clone()));
        let mut progress = Vec::new();

        let payload =
            stage_setup_bundle_update_for_tag("v1.2.3", &cache_root, &mut transport, |event| {
                progress.push(event)
            })
            .expect("stage update");

        assert_eq!(payload.status, "ready");
        assert_eq!(payload.phase, "verified");
        assert_eq!(payload.filename, spec.zip_name);
        assert_eq!(
            fs::read(&spec.final_zip_path).expect("final package"),
            package
        );
        assert!(!spec.partial_zip_path.exists());
        assert_eq!(transport.vec_calls, vec![spec.checksum_url.clone()]);
        assert_eq!(transport.file_calls, vec![spec.zip_url.clone()]);
        assert!(progress.iter().any(|event| event.phase == "downloading"));
        assert!(progress.iter().any(|event| event.phase == "verifying"));

        fs::remove_dir_all(cache_root).expect("remove temp root");
    }

    #[test]
    fn stage_setup_bundle_update_reuses_existing_valid_cache_after_sidecar_check() {
        let cache_root = temp_root("update-cache-reuse");
        let package = b"already cached package".to_vec();
        let spec = setup_bundle_update_spec_for_tag("v1.2.3", &cache_root).expect("spec");
        fs::create_dir_all(&spec.cache_dir).expect("cache dir");
        fs::write(&spec.final_zip_path, &package).expect("cached package");
        let checksum = Ok(checksum_record(&package, &spec.zip_name));
        let mut transport = FakeUpdateDownloadSource::new(
            checksum,
            Err(UiError::new(
                "update_download_failed",
                "large download should not run",
            )),
        );

        let payload =
            stage_setup_bundle_update_for_tag("v1.2.3", &cache_root, &mut transport, |_| {})
                .expect("reuse cached package");

        assert_eq!(payload.phase, "cached");
        assert_eq!(transport.vec_calls, vec![spec.checksum_url.clone()]);
        assert!(transport.file_calls.is_empty());
        assert_eq!(
            fs::read(&spec.final_zip_path).expect("cached package"),
            package
        );

        fs::remove_dir_all(cache_root).expect("remove temp root");
    }

    #[test]
    fn stage_setup_bundle_update_removes_stale_partial_before_download() {
        let cache_root = temp_root("update-stale-part");
        let package = b"new tiny package".to_vec();
        let spec = setup_bundle_update_spec_for_tag("v1.2.3", &cache_root).expect("spec");
        fs::create_dir_all(&spec.cache_dir).expect("cache dir");
        fs::write(&spec.partial_zip_path, b"stale partial").expect("stale part");
        let checksum = Ok(checksum_record(&package, &spec.zip_name));
        let mut transport = FakeUpdateDownloadSource::new(checksum, Ok(package.clone()));

        stage_setup_bundle_update_for_tag("v1.2.3", &cache_root, &mut transport, |_| {})
            .expect("stage update");

        assert_eq!(
            fs::read(&spec.final_zip_path).expect("final package"),
            package
        );
        assert!(!spec.partial_zip_path.exists());

        fs::remove_dir_all(cache_root).expect("remove temp root");
    }

    #[test]
    fn stage_setup_bundle_update_cleans_partial_and_rejects_failure_modes() {
        let cases = [
            (
                "checksum-http",
                Err(UiError::new(
                    "update_download_failed",
                    "Could not download update checksum.",
                )),
                Ok(b"package".to_vec()),
                "update_download_failed",
            ),
            (
                "malformed-checksum",
                Ok(b"not a checksum".to_vec()),
                Ok(b"package".to_vec()),
                "update_checksum_invalid",
            ),
            (
                "package-http",
                Ok(Vec::new()),
                Err(UiError::new(
                    "update_download_failed",
                    "Could not download update package.",
                )),
                "update_download_failed",
            ),
            (
                "package-overflow",
                Ok(Vec::new()),
                Err(UiError::new(
                    "update_download_overflow",
                    "Downloaded update package exceeded the allowed size.",
                )),
                "update_download_overflow",
            ),
            (
                "hash-mismatch",
                Ok(Vec::new()),
                Ok(b"wrong package".to_vec()),
                "update_verification_failed",
            ),
        ];

        for (name, checksum_override, package_override, expected_code) in cases {
            let cache_root = temp_root(name);
            let expected_package = b"expected package".to_vec();
            let spec = setup_bundle_update_spec_for_tag("v1.2.3", &cache_root).expect("spec");
            let checksum = if checksum_override.as_ref().is_ok_and(Vec::is_empty) {
                Ok(checksum_record(&expected_package, &spec.zip_name))
            } else {
                checksum_override
            };
            let mut transport = FakeUpdateDownloadSource::new(checksum, package_override);

            let error =
                stage_setup_bundle_update_for_tag("v1.2.3", &cache_root, &mut transport, |_| {})
                    .expect_err("reject update staging failure");

            assert_eq!(error.code, expected_code, "{name}");
            assert!(!spec.partial_zip_path.exists(), "{name}");
            assert!(!spec.checksum_path.exists(), "{name}");
            assert!(!spec.final_zip_path.exists(), "{name}");
            fs::remove_dir_all(cache_root).expect("remove temp root");
        }

        let cache_root = temp_root("cache-read-failure");
        let expected_package = b"expected package".to_vec();
        let actual_package = b"download reported complete but did not write".to_vec();
        let spec = setup_bundle_update_spec_for_tag("v1.2.3", &cache_root).expect("spec");
        let checksum = Ok(checksum_record(&expected_package, &spec.zip_name));
        let mut transport =
            FakeUpdateDownloadSource::new(checksum, Ok(actual_package)).without_package_write();

        let error =
            stage_setup_bundle_update_for_tag("v1.2.3", &cache_root, &mut transport, |_| {})
                .expect_err("missing partial is a cache read failure");

        assert_eq!(error.code, "update_cache_read_failed");
        assert!(!spec.partial_zip_path.exists());
        assert!(!spec.checksum_path.exists());
        assert!(!spec.final_zip_path.exists());
        fs::remove_dir_all(cache_root).expect("remove temp root");
    }
}
