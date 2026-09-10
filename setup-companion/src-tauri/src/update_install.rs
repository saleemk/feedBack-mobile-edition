use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::update_staging::{
    ensure_setup_bundle_update_target_eligible, verified_setup_bundle_update_spec_for_tag,
};
use crate::{validate_stable_release_tag, UiError};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const INSTALLATIONS_CHILD: &str = "installations";
const SETUP_BUNDLE_SCHEMA: &str = "feedback-mobile-edition.setup-bundle.v1";
const SETUP_BUNDLE_FORMAT: &str = "zip";
const SETUP_COMPANION_EXE: &str = "Setup-MobileEdition.exe";
const MAX_INSTALL_ARCHIVE_ENTRIES: usize = 50_000;
const MAX_INSTALL_ARCHIVE_BYTES: u64 = 3_000_000_000;
const COPY_BUFFER_BYTES: usize = 64 * 1024;

const REQUIRED_FILES: &[&str] = &[
    "Setup-MobileEdition.exe",
    "Setup-MobileEdition.cmd",
    ".env.example",
    "docker-compose.release.yml",
    "LICENSE",
    "ATTRIBUTIONS.md",
    "RELEASE-MANIFEST.md",
    "scripts/Setup-MobileEdition.ps1",
    "scripts/Start-MobileEditionSetup.ps1",
];

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallStatePayload {
    pub status: String,
    pub tag: String,
    pub phase: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallPayload {
    pub status: String,
    pub tag: String,
    pub phase: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallProgressPayload {
    pub tag: String,
    pub phase: String,
    pub label: String,
    pub bytes_processed: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_total: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOpenPayload {
    pub status: String,
    pub tag: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetupBundleInstallSpec {
    pub tag: String,
    pub expected_top_level: String,
    pub installations_root: PathBuf,
    pub final_installation_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetupBundleInstallManifest {
    schema: String,
    bundle_format: String,
    edition_version: String,
    edition_commit: String,
    companion_path: String,
    companion_sha256: String,
    generated_at_utc: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateLaunchCommandSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub working_directory: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ArchiveEntryPlan {
    index: usize,
    relative: PathBuf,
    is_dir: bool,
    declared_size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ArchivePlan {
    entries: Vec<ArchiveEntryPlan>,
    declared_total: u64,
}

pub fn local_installations_root() -> Result<PathBuf, UiError> {
    dirs::data_local_dir()
        .map(|root| {
            root.join("fee[dB]ack Mobile Edition")
                .join(INSTALLATIONS_CHILD)
        })
        .ok_or_else(|| {
            UiError::new(
                "update_install_unavailable",
                "Could not locate the local installation directory.",
            )
        })
}

pub fn setup_bundle_install_spec_for_tag(
    tag: &str,
    installations_root: &Path,
) -> Result<SetupBundleInstallSpec, UiError> {
    let validated = validate_stable_release_tag(tag)?;
    let expected_top_level = format!("feedback-mobile-edition-{validated}");
    let final_installation_path = installations_root.join(validated);
    ensure_installation_path(installations_root, &final_installation_path)?;
    Ok(SetupBundleInstallSpec {
        tag: validated.to_string(),
        expected_top_level,
        installations_root: installations_root.to_path_buf(),
        final_installation_path,
    })
}

pub fn setup_bundle_update_state_for_tag(
    current_root: &Path,
    tag: &str,
    update_cache_root: &Path,
    installations_root: &Path,
) -> Result<UpdateInstallStatePayload, UiError> {
    ensure_setup_bundle_update_target_eligible(current_root, tag)?;
    let spec = setup_bundle_install_spec_for_tag(tag, installations_root)?;
    if spec.final_installation_path.exists() {
        return match validate_installed_setup_bundle_in_root(
            &spec.installations_root,
            &spec.final_installation_path,
            &spec.tag,
        ) {
            Ok(_) => Ok(update_install_state_payload(
                "installed",
                &spec.tag,
                "installed",
                "Update installed. Open the new version when ready.",
            )),
            Err(_) => Ok(update_install_state_payload(
                "conflict",
                &spec.tag,
                "conflict",
                "A version folder already exists but is not a valid installation.",
            )),
        };
    }
    if verified_setup_bundle_update_spec_for_tag(tag, update_cache_root).is_ok() {
        return Ok(update_install_state_payload(
            "downloaded",
            &spec.tag,
            "downloaded",
            "Verified update ready to install.",
        ));
    }
    Ok(update_install_state_payload(
        "available",
        &spec.tag,
        "available",
        "Update is available for download.",
    ))
}

pub fn install_setup_bundle_update_for_tag<F>(
    current_root: &Path,
    tag: &str,
    update_cache_root: &Path,
    installations_root: &Path,
    mut progress: F,
) -> Result<UpdateInstallPayload, UiError>
where
    F: FnMut(UpdateInstallProgressPayload),
{
    ensure_setup_bundle_update_target_eligible(current_root, tag)?;
    let install_spec = setup_bundle_install_spec_for_tag(tag, installations_root)?;
    let staged = verified_setup_bundle_update_spec_for_tag(tag, update_cache_root)?;

    fs::create_dir_all(&install_spec.installations_root).map_err(|_| {
        UiError::new(
            "update_install_failed",
            "Could not create the installation directory.",
        )
    })?;
    reject_reparse_or_symlink_path(
        &install_spec.installations_root,
        "update_install_path_invalid",
        "Update installation path is outside the allowed directory.",
    )?;

    if install_spec.final_installation_path.exists() {
        validate_installed_setup_bundle_in_root(
            &install_spec.installations_root,
            &install_spec.final_installation_path,
            &install_spec.tag,
        )
        .map_err(|_| {
            UiError::new(
                "update_install_conflict",
                "A version folder already exists but is not a valid installation.",
            )
        })?;
        return Ok(update_install_payload(
            "ready",
            &install_spec.tag,
            "installed",
            "Update installation already exists and was revalidated.",
        ));
    }

    let pending_root =
        unique_pending_installation_root(&install_spec.installations_root, &install_spec.tag)?;
    ensure_installation_path(&install_spec.installations_root, &pending_root)?;
    fs::create_dir(&pending_root).map_err(|_| {
        UiError::new(
            "update_install_failed",
            "Could not prepare the update installation.",
        )
    })?;
    reject_reparse_or_symlink_path(
        &pending_root,
        "update_install_path_invalid",
        "Update installation path is outside the allowed directory.",
    )?;
    let extracted_root = pending_root.join(&install_spec.expected_top_level);
    let result = (|| {
        emit_install_progress(&mut progress, &install_spec.tag, 0, None);
        extract_and_validate_setup_bundle(
            &staged.final_zip_path,
            &pending_root,
            &install_spec.expected_top_level,
            &install_spec.tag,
            &mut progress,
        )?;
        copy_current_env_if_present(current_root, &extracted_root)?;
        validate_installed_setup_bundle(&extracted_root, &install_spec.tag)?;
        publish_extracted_installation_no_replace(
            &extracted_root,
            &install_spec.final_installation_path,
        )?;
        remove_dir_if_exists(&pending_root)?;
        Ok(update_install_payload(
            "ready",
            &install_spec.tag,
            "installed",
            "Update installed side by side. Open the new version when ready.",
        ))
    })();

    if result.is_err() {
        let _ = remove_dir_if_exists(&pending_root);
    }
    result
}

pub fn build_installed_setup_bundle_launch_spec(
    current_root: &Path,
    tag: &str,
    installations_root: &Path,
) -> Result<UpdateLaunchCommandSpec, UiError> {
    ensure_setup_bundle_update_target_eligible(current_root, tag)?;
    let install_spec = setup_bundle_install_spec_for_tag(tag, installations_root)?;
    let canonical_installation = validate_installed_setup_bundle_in_root(
        &install_spec.installations_root,
        &install_spec.final_installation_path,
        &install_spec.tag,
    )?;
    let executable = canonical_installation.join(SETUP_COMPANION_EXE);
    Ok(UpdateLaunchCommandSpec {
        program: executable,
        args: vec![
            OsString::from("--checkout"),
            canonical_installation.as_os_str().to_os_string(),
        ],
        working_directory: canonical_installation,
    })
}

pub fn open_installed_setup_bundle_update_for_tag_with_opener<F>(
    current_root: &Path,
    tag: &str,
    installations_root: &Path,
    opener: F,
) -> Result<UpdateOpenPayload, UiError>
where
    F: FnOnce(&UpdateLaunchCommandSpec) -> Result<(), UiError>,
{
    let spec = build_installed_setup_bundle_launch_spec(current_root, tag, installations_root)?;
    opener(&spec)?;
    Ok(UpdateOpenPayload {
        status: "opened".to_string(),
        tag: tag.to_string(),
        reason: "New version opened.".to_string(),
    })
}

pub fn open_installed_setup_bundle_update_for_tag(
    current_root: &Path,
    tag: &str,
    installations_root: &Path,
) -> Result<UpdateOpenPayload, UiError> {
    open_installed_setup_bundle_update_for_tag_with_opener(
        current_root,
        tag,
        installations_root,
        launch_installed_setup_bundle,
    )
}

fn extract_and_validate_setup_bundle<F>(
    zip_path: &Path,
    pending_root: &Path,
    expected_top_level: &str,
    tag: &str,
    progress: &mut F,
) -> Result<(), UiError>
where
    F: FnMut(UpdateInstallProgressPayload),
{
    let file = fs::File::open(zip_path).map_err(|_| {
        UiError::new(
            "update_cache_read_failed",
            "Could not read the verified update package.",
        )
    })?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| {
        UiError::new(
            "update_install_invalid_archive",
            "Update package is not a valid ZIP archive.",
        )
    })?;
    let plan = scan_setup_bundle_archive(&mut archive, expected_top_level)?;

    let mut processed = 0_u64;
    emit_install_progress(progress, tag, 0, Some(plan.declared_total));
    for planned in plan.entries {
        let mut entry = archive.by_index(planned.index).map_err(|_| {
            UiError::new(
                "update_install_invalid_archive",
                "Update package entry could not be read.",
            )
        })?;
        if entry.size() != planned.declared_size || entry.is_dir() != planned.is_dir {
            return Err(UiError::new(
                "update_install_invalid_archive",
                "Update package entry metadata changed during extraction.",
            ));
        }
        let destination = pending_root
            .join(expected_top_level)
            .join(&planned.relative);
        ensure_installation_path(pending_root, &destination)?;
        if planned.is_dir {
            fs::create_dir_all(&destination).map_err(|_| {
                UiError::new(
                    "update_install_failed",
                    "Could not create an update installation directory.",
                )
            })?;
            reject_reparse_or_symlink_path(
                &destination,
                "update_install_invalid_archive",
                "Update package contains unsupported files.",
            )?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|_| {
                UiError::new(
                    "update_install_failed",
                    "Could not create an update installation directory.",
                )
            })?;
            reject_reparse_or_symlink_path(
                parent,
                "update_install_invalid_archive",
                "Update package contains unsupported files.",
            )?;
        }
        let mut writer = BufWriter::with_capacity(
            COPY_BUFFER_BYTES,
            fs::File::create(&destination).map_err(|_| {
                UiError::new(
                    "update_install_failed",
                    "Could not write update installation files.",
                )
            })?,
        );
        let copied = copy_zip_entry_bounded(&mut entry, &mut writer, planned.declared_size)?;
        writer.flush().map_err(|_| {
            UiError::new(
                "update_install_failed",
                "Could not finish update installation files.",
            )
        })?;
        processed = processed.saturating_add(copied);
        progress(UpdateInstallProgressPayload {
            tag: tag.to_string(),
            phase: "installing".to_string(),
            label: "Installing update".to_string(),
            bytes_processed: processed,
            bytes_total: Some(plan.declared_total),
        });
    }

    validate_installed_setup_bundle(&pending_root.join(expected_top_level), tag)
}

fn scan_setup_bundle_archive<R: Read + io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    expected_top_level: &str,
) -> Result<ArchivePlan, UiError> {
    ensure_archive_entry_count(archive.len())?;

    let mut declared_total = 0_u64;
    let mut destinations = HashSet::new();
    let mut entries = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| {
            UiError::new(
                "update_install_invalid_archive",
                "Update package entry could not be read.",
            )
        })?;
        reject_unsupported_zip_entry(&entry)?;
        let entry_name = entry.name().to_string();
        if entry_name.trim_end_matches('/') == expected_top_level {
            if entry.is_dir() {
                continue;
            }
            return Err(UiError::new(
                "update_install_invalid_archive",
                "Update package must contain exactly one supported top-level directory.",
            ));
        }
        let relative = validate_entry_name(&entry_name, expected_top_level)?;
        let normalized_key = normalized_destination_key(&relative);
        if !destinations.insert(normalized_key) {
            return Err(UiError::new(
                "update_install_invalid_archive",
                "Update package contains duplicate destinations.",
            ));
        }
        reject_forbidden_archive_path(&relative)?;
        declared_total = add_declared_archive_bytes(declared_total, entry.size())?;
        entries.push(ArchiveEntryPlan {
            index,
            relative,
            is_dir: entry.is_dir(),
            declared_size: entry.size(),
        });
    }

    if entries.is_empty() {
        return Err(UiError::new(
            "update_install_invalid_archive",
            "Update package contains an unsupported number of entries.",
        ));
    }

    Ok(ArchivePlan {
        entries,
        declared_total,
    })
}

fn reject_unsupported_zip_entry<R: Read>(entry: &zip::read::ZipFile<'_, R>) -> Result<(), UiError> {
    if entry.encrypted() {
        return Err(UiError::new(
            "update_install_invalid_archive",
            "Update package contains encrypted entries.",
        ));
    }
    if entry.is_dir() {
        return Ok(());
    }
    if entry.is_symlink() {
        return Err(UiError::new(
            "update_install_invalid_archive",
            "Update package contains link entries.",
        ));
    }
    if let Some(mode) = entry.unix_mode() {
        let file_type = mode & 0o170000;
        if file_type != 0 && file_type != 0o100000 {
            return Err(UiError::new(
                "update_install_invalid_archive",
                "Update package contains unsupported special files.",
            ));
        }
    }
    Ok(())
}

fn ensure_archive_entry_count(count: usize) -> Result<(), UiError> {
    if count == 0 || count > MAX_INSTALL_ARCHIVE_ENTRIES {
        return Err(UiError::new(
            "update_install_invalid_archive",
            "Update package contains an unsupported number of entries.",
        ));
    }
    Ok(())
}

fn add_declared_archive_bytes(current: u64, next: u64) -> Result<u64, UiError> {
    let total = current.checked_add(next).ok_or_else(|| {
        UiError::new(
            "update_install_overflow",
            "Update package is larger than the allowed size.",
        )
    })?;
    if total > MAX_INSTALL_ARCHIVE_BYTES {
        return Err(UiError::new(
            "update_install_overflow",
            "Update package is larger than the allowed size.",
        ));
    }
    Ok(total)
}

fn validate_entry_name(name: &str, expected_top_level: &str) -> Result<PathBuf, UiError> {
    if name.is_empty() || name.contains('\\') || name.starts_with('/') {
        return Err(UiError::new(
            "update_install_invalid_archive",
            "Update package contains unsupported paths.",
        ));
    }
    let trimmed = name.trim_end_matches('/');
    let parts = trimmed.split('/').collect::<Vec<_>>();
    if parts.len() < 2 || parts[0] != expected_top_level {
        return Err(UiError::new(
            "update_install_invalid_archive",
            "Update package must contain exactly one supported top-level directory.",
        ));
    }
    let relative_parts = &parts[1..];
    for part in relative_parts {
        validate_path_component(part)?;
    }
    Ok(relative_parts.iter().collect())
}

fn validate_path_component(part: &str) -> Result<(), UiError> {
    let unsafe_component = part.is_empty()
        || part == "."
        || part == ".."
        || part.contains(':')
        || part.ends_with(' ')
        || part.ends_with('.')
        || is_windows_reserved_device_name(part)
        || Path::new(part).components().any(|component| {
            matches!(
                component,
                Component::Prefix(_) | Component::RootDir | Component::ParentDir
            )
        });
    if unsafe_component {
        return Err(UiError::new(
            "update_install_invalid_archive",
            "Update package contains unsafe paths.",
        ));
    }
    Ok(())
}

fn is_windows_reserved_device_name(part: &str) -> bool {
    let basename = part.split('.').next().unwrap_or(part).to_ascii_uppercase();
    matches!(
        basename.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || matches!(
        basename.as_str(),
        "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn reject_forbidden_archive_path(relative: &Path) -> Result<(), UiError> {
    reject_forbidden_bundle_path(relative, false)
}

fn reject_forbidden_installed_path(relative: &Path) -> Result<(), UiError> {
    reject_forbidden_bundle_path(relative, true)
}

fn reject_forbidden_bundle_path(relative: &Path, allow_root_env: bool) -> Result<(), UiError> {
    let normalized = normalized_destination_key(relative);
    let forbidden = is_forbidden_env_path(&normalized, allow_root_env)
        || normalized == "ai_handoff.local.md"
        || normalized == ".git"
        || normalized.starts_with(".git/")
        || normalized.ends_with("/.git")
        || normalized.contains("/.git/")
        || has_forbidden_directory_component(
            &normalized,
            &[
                "node_modules",
                "target",
                "__pycache__",
                ".pytest_cache",
                ".mypy_cache",
                ".ruff_cache",
                "artifacts",
                "build",
                "dist",
                ".setup-companion-bootstrap",
                "bootstrap-cache",
                "update-cache",
                "logs",
                "profiles",
                "offline-packages",
                "diagnostics",
                "recordings",
                ".cache",
                "cache",
            ],
        )
        || normalized.ends_with(".log")
        || normalized.ends_with(".pem")
        || normalized.ends_with(".key")
        || normalized.ends_with(".pfx")
        || normalized.ends_with(".mp3")
        || normalized.ends_with(".wav")
        || normalized.ends_with(".flac")
        || normalized.ends_with(".ogg")
        || normalized.ends_with(".m4a")
        || normalized.ends_with(".aac")
        || (normalized.starts_with("library/") && normalized != "library/.gitkeep");
    if forbidden {
        return Err(UiError::new(
            "update_install_invalid_archive",
            "Update package contains local or unsupported files.",
        ));
    }
    Ok(())
}

fn is_forbidden_env_path(normalized: &str, allow_root_env: bool) -> bool {
    if normalized == ".env.example" {
        return false;
    }
    if allow_root_env && normalized == ".env" {
        return false;
    }
    normalized
        .rsplit('/')
        .next()
        .is_some_and(|name| name == ".env" || name.starts_with(".env."))
}

fn has_forbidden_directory_component(normalized: &str, names: &[&str]) -> bool {
    normalized
        .split('/')
        .any(|component| names.contains(&component))
}

fn validate_installed_setup_bundle(root: &Path, tag: &str) -> Result<(), UiError> {
    if !root.is_dir() {
        return Err(UiError::new(
            "update_install_invalid",
            "Installed update directory is not valid.",
        ));
    }
    let manifest = read_install_manifest(&root.join("SETUP-BUNDLE-MANIFEST.json"), tag)?;
    for required in REQUIRED_FILES {
        let path = root.join(required);
        ensure_installation_path(root, &path)?;
        if !path.is_file() {
            return Err(UiError::new(
                "update_install_invalid",
                "Installed update is missing required files.",
            ));
        }
    }
    reject_extracted_forbidden_paths(root)?;
    let companion_hash =
        sha256_file_hex_for_install(&root.join(SETUP_COMPANION_EXE), "update_install_invalid")?;
    if !companion_hash.eq_ignore_ascii_case(&manifest.companion_sha256) {
        return Err(UiError::new(
            "update_install_invalid",
            "Installed Setup Companion verification failed.",
        ));
    }
    Ok(())
}

pub(crate) fn validate_installed_setup_bundle_in_root(
    installations_root: &Path,
    final_root: &Path,
    tag: &str,
) -> Result<PathBuf, UiError> {
    ensure_installation_path(installations_root, final_root)?;
    reject_reparse_or_symlink_path(
        installations_root,
        "update_install_invalid",
        "Installed update directory is not valid.",
    )?;
    reject_reparse_or_symlink_path(
        final_root,
        "update_install_invalid",
        "Installed update directory is not valid.",
    )?;
    let canonical_parent = canonical_install_path(installations_root)?;
    let canonical_final = canonical_install_path(final_root)?;
    ensure_installation_path(&canonical_parent, &canonical_final).map_err(|_| {
        UiError::new(
            "update_install_invalid",
            "Installed update directory is not valid.",
        )
    })?;
    validate_installed_setup_bundle(&canonical_final, tag)?;
    Ok(canonical_final)
}

pub(crate) fn validate_setup_bundle_checkout_in_place(
    root: &Path,
    tag: &str,
) -> Result<PathBuf, UiError> {
    reject_reparse_or_symlink_path(
        root,
        "update_install_invalid",
        "Setup bundle directory is not valid.",
    )?;
    let canonical_root = canonical_install_path(root)?;
    validate_installed_setup_bundle(&canonical_root, tag)?;
    Ok(canonical_root)
}

fn read_install_manifest(path: &Path, tag: &str) -> Result<SetupBundleInstallManifest, UiError> {
    let text = fs::read_to_string(path).map_err(|_| {
        UiError::new(
            "update_install_invalid",
            "Installed update manifest could not be read.",
        )
    })?;
    let manifest = serde_json::from_str::<SetupBundleInstallManifest>(strip_leading_json_bom(
        &text,
    ))
    .map_err(|_| {
        UiError::new(
            "update_install_invalid",
            "Installed update manifest is not valid.",
        )
    })?;
    let expected_version = tag
        .strip_prefix('v')
        .expect("validated stable tags always have v prefix");
    let normalized = manifest
        .edition_version
        .strip_prefix('v')
        .unwrap_or(&manifest.edition_version);
    if manifest.schema != SETUP_BUNDLE_SCHEMA
        || manifest.bundle_format != SETUP_BUNDLE_FORMAT
        || normalized != expected_version
        || manifest.companion_path != SETUP_COMPANION_EXE
        || !is_hex_of_len(&manifest.edition_commit, 40)
        || !is_hex_of_len(&manifest.companion_sha256, 64)
        || manifest.generated_at_utc.trim().is_empty()
    {
        return Err(UiError::new(
            "update_install_invalid",
            "Installed update manifest does not match the expected bundle contract.",
        ));
    }
    Ok(manifest)
}

fn strip_leading_json_bom(content: &str) -> &str {
    content.strip_prefix('\u{feff}').unwrap_or(content)
}

fn reject_extracted_forbidden_paths(root: &Path) -> Result<(), UiError> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).map_err(|_| {
            UiError::new(
                "update_install_invalid",
                "Installed update directory could not be inspected.",
            )
        })? {
            let entry = entry.map_err(|_| {
                UiError::new(
                    "update_install_invalid",
                    "Installed update directory could not be inspected.",
                )
            })?;
            let path = entry.path();
            let relative = path.strip_prefix(root).map_err(|_| {
                UiError::new(
                    "update_install_invalid",
                    "Installed update directory contains unsupported paths.",
                )
            })?;
            let file_type = entry.file_type().map_err(|_| {
                UiError::new(
                    "update_install_invalid",
                    "Installed update directory could not be inspected.",
                )
            })?;
            reject_reparse_or_symlink_path(
                &path,
                "update_install_invalid",
                "Installed update contains unsupported files.",
            )?;
            if file_type.is_symlink() || (!file_type.is_file() && !file_type.is_dir()) {
                return Err(UiError::new(
                    "update_install_invalid",
                    "Installed update contains unsupported files.",
                ));
            }
            reject_forbidden_installed_path(relative)?;
            if file_type.is_dir() {
                stack.push(path);
            }
        }
    }
    Ok(())
}

fn copy_current_env_if_present(current_root: &Path, extracted_root: &Path) -> Result<(), UiError> {
    let source = current_root.join(".env");
    let destination = extracted_root.join(".env");
    let metadata = match fs::symlink_metadata(&source) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(_) => {
            return Err(UiError::new(
                "update_install_failed",
                "Current local configuration could not be carried forward.",
            ))
        }
    };
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || has_windows_reparse_point(&metadata)
    {
        return Err(UiError::new(
            "update_install_failed",
            "Current local configuration could not be carried forward.",
        ));
    }
    if destination.exists() {
        return Err(UiError::new(
            "update_install_invalid_archive",
            "Update package must not contain local configuration.",
        ));
    }
    fs::copy(source, destination).map_err(|_| {
        UiError::new(
            "update_install_failed",
            "Current local configuration could not be carried forward.",
        )
    })?;
    Ok(())
}

fn publish_extracted_installation_no_replace(
    source: &Path,
    destination: &Path,
) -> Result<(), UiError> {
    if destination.exists() {
        return Err(UiError::new(
            "update_install_conflict",
            "A version folder already exists but is not a valid installation.",
        ));
    }
    rename_no_replace(source, destination).map_err(|error| {
        if error.kind() == io::ErrorKind::AlreadyExists {
            UiError::new(
                "update_install_conflict",
                "A version folder already exists but is not a valid installation.",
            )
        } else {
            UiError::new(
                "update_install_failed",
                "Could not finalize the update installation.",
            )
        }
    })
}

#[cfg(windows)]
fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(
            lpExistingFileName: *const u16,
            lpNewFileName: *const u16,
            dwFlags: u32,
        ) -> i32;
    }

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    let source_wide = wide(source);
    let destination_wide = wide(destination);
    let moved = unsafe { MoveFileExW(source_wide.as_ptr(), destination_wide.as_ptr(), 0) };
    if moved == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    if destination.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "destination already exists",
        ));
    }
    fs::rename(source, destination)
}

fn copy_zip_entry_bounded<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    declared_size: u64,
) -> Result<u64, UiError> {
    let mut copied = 0_u64;
    let mut buffer = [0_u8; COPY_BUFFER_BYTES];
    loop {
        let remaining_with_probe = declared_size.saturating_sub(copied).saturating_add(1);
        let read_limit = buffer.len().min(remaining_with_probe as usize);
        let count = reader.read(&mut buffer[..read_limit]).map_err(|_| {
            UiError::new(
                "update_install_failed",
                "Could not extract update installation files.",
            )
        })?;
        if count == 0 {
            break;
        }
        copied = copied.checked_add(count as u64).ok_or_else(|| {
            UiError::new(
                "update_install_overflow",
                "Update package is larger than the allowed size.",
            )
        })?;
        if copied > declared_size {
            return Err(UiError::new(
                "update_install_invalid_archive",
                "Update package entry size did not match its declaration.",
            ));
        }
        writer.write_all(&buffer[..count]).map_err(|_| {
            UiError::new(
                "update_install_failed",
                "Could not extract update installation files.",
            )
        })?;
    }
    if copied != declared_size {
        return Err(UiError::new(
            "update_install_invalid_archive",
            "Update package entry size did not match its declaration.",
        ));
    }
    Ok(copied)
}

fn launch_installed_setup_bundle(spec: &UpdateLaunchCommandSpec) -> Result<(), UiError> {
    let mut command = Command::new(&spec.program);
    command.args(&spec.args);
    command.current_dir(&spec.working_directory);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.spawn().map_err(|_| {
        UiError::new(
            "update_launch_failed",
            "Could not open the installed update.",
        )
    })?;
    Ok(())
}

fn unique_pending_installation_root(
    installations_root: &Path,
    tag: &str,
) -> Result<PathBuf, UiError> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| {
            UiError::new(
                "update_install_failed",
                "Could not prepare the update installation.",
            )
        })?
        .as_nanos();
    Ok(installations_root.join(format!(".pending-{tag}-{}-{nonce}", std::process::id())))
}

fn ensure_installation_path(parent: &Path, child: &Path) -> Result<(), UiError> {
    let parent = normalized_native_path(parent);
    let child = normalized_native_path(child);
    if child == parent || child.starts_with(&parent) {
        Ok(())
    } else {
        Err(UiError::new(
            "update_install_path_invalid",
            "Update installation path is outside the allowed directory.",
        ))
    }
}

fn canonical_install_path(path: &Path) -> Result<PathBuf, UiError> {
    path.canonicalize().map_err(|_| {
        UiError::new(
            "update_install_invalid",
            "Installed update directory is not valid.",
        )
    })
}

fn reject_reparse_or_symlink_path(path: &Path, code: &str, message: &str) -> Result<(), UiError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| UiError::new(code, message))?;
    if metadata.file_type().is_symlink() || has_windows_reparse_point(&metadata) {
        return Err(UiError::new(code, message));
    }
    Ok(())
}

#[cfg(windows)]
fn has_windows_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn has_windows_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

fn normalized_native_path(path: &Path) -> PathBuf {
    path.components().collect()
}

fn normalized_destination_key(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join("/")
}

fn is_hex_of_len(value: &str, len: usize) -> bool {
    value.len() == len && value.chars().all(|character| character.is_ascii_hexdigit())
}

fn sha256_file_hex_for_install(path: &Path, code: &str) -> Result<String, UiError> {
    let file = fs::File::open(path)
        .map_err(|_| UiError::new(code, "Could not read the installed update package."))?;
    let mut reader = BufReader::with_capacity(COPY_BUFFER_BYTES, file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; COPY_BUFFER_BYTES];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|_| UiError::new(code, "Could not read the installed update package."))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn remove_dir_if_exists(path: &Path) -> Result<(), UiError> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(UiError::new(
            "update_install_failed",
            "Could not clean the pending update installation.",
        )),
    }
}

fn update_install_state_payload(
    status: &str,
    tag: &str,
    phase: &str,
    reason: &str,
) -> UpdateInstallStatePayload {
    UpdateInstallStatePayload {
        status: status.to_string(),
        tag: tag.to_string(),
        phase: phase.to_string(),
        reason: reason.to_string(),
    }
}

fn update_install_payload(
    status: &str,
    tag: &str,
    phase: &str,
    reason: &str,
) -> UpdateInstallPayload {
    UpdateInstallPayload {
        status: status.to_string(),
        tag: tag.to_string(),
        phase: phase.to_string(),
        reason: reason.to_string(),
    }
}

fn emit_install_progress<F>(
    progress: &mut F,
    tag: &str,
    bytes_processed: u64,
    bytes_total: Option<u64>,
) where
    F: FnMut(UpdateInstallProgressPayload),
{
    progress(UpdateInstallProgressPayload {
        tag: tag.to_string(),
        phase: "installing".to_string(),
        label: "Installing update".to_string(),
        bytes_processed,
        bytes_total,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update_staging::{
        local_update_cache_root, setup_bundle_update_spec_for_tag, sha256_reader_hex,
    };
    use std::env;
    use std::io::Cursor;
    use zip::write::SimpleFileOptions;

    fn temp_root(name: &str) -> PathBuf {
        let mut root = env::temp_dir();
        root.push(format!(
            "feedback-setup-companion-install-{name}-{}",
            std::process::id()
        ));
        if root.exists() {
            fs::remove_dir_all(&root).expect("remove stale temp root");
        }
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn write_bundle_identity(root: &Path, version: &str) {
        fs::write(
            root.join("SETUP-BUNDLE-MANIFEST.json"),
            format!(
                r#"{{
                  "schema": "feedback-mobile-edition.setup-bundle.v1",
                  "editionVersion": "{version}"
                }}"#
            ),
        )
        .expect("write current bundle identity");
    }

    fn companion_hash() -> String {
        sha256_reader_hex("fake companion bytes".as_bytes()).expect("hash companion")
    }

    fn manifest(tag: &str, hash: &str) -> String {
        let version = tag.strip_prefix('v').unwrap_or(tag);
        format!(
            r#"{{
              "schema": "feedback-mobile-edition.setup-bundle.v1",
              "bundleFormat": "zip",
              "editionVersion": "{version}",
              "editionCommit": "0123456789abcdef0123456789abcdef01234567",
              "companionPath": "Setup-MobileEdition.exe",
              "companionSha256": "{hash}",
              "generatedAtUtc": "2026-09-09T00:00:00Z"
            }}"#
        )
    }

    fn base_entries(tag: &str) -> Vec<(String, Vec<u8>)> {
        let hash = companion_hash();
        vec![
            (
                "Setup-MobileEdition.exe".to_string(),
                b"fake companion bytes".to_vec(),
            ),
            ("Setup-MobileEdition.cmd".to_string(), b"@echo off".to_vec()),
            (
                ".env.example".to_string(),
                b"LIBRARY_PATH=./library".to_vec(),
            ),
            (
                "docker-compose.release.yml".to_string(),
                b"name: feedback-mobile-edition".to_vec(),
            ),
            ("LICENSE".to_string(), b"license".to_vec()),
            ("ATTRIBUTIONS.md".to_string(), b"# Attributions".to_vec()),
            ("RELEASE-MANIFEST.md".to_string(), b"# Manifest".to_vec()),
            (
                "scripts/Setup-MobileEdition.ps1".to_string(),
                b"Write-Output setup".to_vec(),
            ),
            (
                "scripts/Start-MobileEditionSetup.ps1".to_string(),
                b"Write-Output launcher".to_vec(),
            ),
            (
                "SETUP-BUNDLE-MANIFEST.json".to_string(),
                manifest(tag, &hash).into_bytes(),
            ),
        ]
    }

    fn write_zip(path: &Path, tag: &str, entries: Vec<(String, Vec<u8>)>) {
        let file = fs::File::create(path).expect("create zip");
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        let root = format!("feedback-mobile-edition-{tag}");
        zip.add_directory(format!("{root}/"), options)
            .expect("root dir");
        for (name, bytes) in entries {
            zip.start_file(format!("{root}/{name}"), options)
                .expect("zip file");
            zip.write_all(&bytes).expect("zip bytes");
        }
        zip.finish().expect("finish zip");
    }

    fn write_raw_zip(path: &Path, entries: Vec<(String, Vec<u8>)>) {
        let file = fs::File::create(path).expect("create zip");
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        for (name, bytes) in entries {
            zip.start_file(name, options).expect("zip file");
            zip.write_all(&bytes).expect("zip bytes");
        }
        zip.finish().expect("finish zip");
    }

    fn write_raw_zip_with_symlink(path: &Path, name: &str) {
        let file = fs::File::create(path).expect("create zip");
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        zip.add_symlink(name, "target", options)
            .expect("zip symlink");
        zip.finish().expect("finish zip");
    }

    fn write_staged_update(cache_root: &Path, tag: &str, entries: Vec<(String, Vec<u8>)>) {
        let spec = setup_bundle_update_spec_for_tag(tag, cache_root).expect("stage spec");
        fs::create_dir_all(&spec.cache_dir).expect("cache dir");
        write_zip(&spec.final_zip_path, tag, entries);
        let hash = sha256_file_hex_for_install(&spec.final_zip_path, "test").expect("zip hash");
        fs::write(&spec.checksum_path, format!("{hash}  {}\n", spec.zip_name))
            .expect("checksum sidecar");
    }

    fn declared_total(entries: &[(String, Vec<u8>)]) -> u64 {
        entries.iter().map(|(_, bytes)| bytes.len() as u64).sum()
    }

    fn install_fixture(name: &str) -> (PathBuf, PathBuf, PathBuf) {
        let root = temp_root(name);
        let current = root.join("current");
        let cache = root.join("cache");
        let installs = root.join("installations");
        fs::create_dir_all(&current).expect("current root");
        write_bundle_identity(&current, "v1.0.0");
        (root, cache, installs)
    }

    #[test]
    fn install_state_distinguishes_available_downloaded_installed_and_conflict() {
        let (root, cache, installs) = install_fixture("state");
        let current = root.join("current");

        let available = setup_bundle_update_state_for_tag(&current, "v1.0.1", &cache, &installs)
            .expect("available state");
        assert_eq!(available.status, "available");

        write_staged_update(&cache, "v1.0.1", base_entries("v1.0.1"));
        let downloaded = setup_bundle_update_state_for_tag(&current, "v1.0.1", &cache, &installs)
            .expect("downloaded state");
        assert_eq!(downloaded.status, "downloaded");

        install_setup_bundle_update_for_tag(&current, "v1.0.1", &cache, &installs, |_| {})
            .expect("install");
        let installed = setup_bundle_update_state_for_tag(&current, "v1.0.1", &cache, &installs)
            .expect("installed state");
        assert_eq!(installed.status, "installed");

        let bad_final = installs.join("v1.0.2");
        fs::create_dir_all(&bad_final).expect("bad final");
        let conflict = setup_bundle_update_state_for_tag(&current, "v1.0.2", &cache, &installs)
            .expect("conflict state");
        assert_eq!(conflict.status, "conflict");

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn install_extracts_verified_update_side_by_side_and_carries_forward_env() {
        let (root, cache, installs) = install_fixture("success");
        let current = root.join("current");
        fs::write(
            current.join(".env"),
            "LIBRARY_PATH=D:\\Music\nSECRET=not logged\n",
        )
        .expect("current env");
        let entries = base_entries("v1.0.1");
        let expected_total = declared_total(&entries);
        write_staged_update(&cache, "v1.0.1", entries);
        let mut progress = Vec::new();

        let payload =
            install_setup_bundle_update_for_tag(&current, "v1.0.1", &cache, &installs, |event| {
                progress.push(event)
            })
            .expect("install update");

        let final_root = installs.join("v1.0.1");
        assert_eq!(payload.phase, "installed");
        assert!(final_root.join("Setup-MobileEdition.exe").is_file());
        assert_eq!(
            fs::read_to_string(final_root.join(".env")).expect("carried env"),
            "LIBRARY_PATH=D:\\Music\nSECRET=not logged\n"
        );
        assert_eq!(
            setup_bundle_update_state_for_tag(&current, "v1.0.1", &cache, &installs)
                .expect("installed state")
                .status,
            "installed"
        );
        open_installed_setup_bundle_update_for_tag_with_opener(
            &current,
            "v1.0.1",
            &installs,
            |_spec| Ok(()),
        )
        .expect("open carried env installation");
        assert!(!installs.join(".pending-v1.0.1").exists());
        assert!(progress
            .iter()
            .any(|event| event.label == "Installing update"));
        let progress_with_totals = progress
            .iter()
            .filter(|event| event.bytes_total.is_some())
            .collect::<Vec<_>>();
        assert!(!progress_with_totals.is_empty());
        assert!(progress_with_totals
            .iter()
            .all(|event| event.bytes_total == Some(expected_total)));
        assert_eq!(
            progress_with_totals
                .last()
                .expect("final progress")
                .bytes_processed,
            expected_total
        );

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn installed_validation_accepts_bom_prefixed_setup_manifest() {
        let (root, cache, installs) = install_fixture("bom-manifest");
        let current = root.join("current");
        let mut entries = base_entries("v1.0.1");
        for (name, bytes) in &mut entries {
            if name == "SETUP-BUNDLE-MANIFEST.json" {
                let mut prefixed = "\u{feff}".as_bytes().to_vec();
                prefixed.extend_from_slice(&bytes[..]);
                *bytes = prefixed;
            }
        }
        write_staged_update(&cache, "v1.0.1", entries);

        install_setup_bundle_update_for_tag(&current, "v1.0.1", &cache, &installs, |_| {})
            .expect("install accepts BOM-prefixed manifest");
        let state = setup_bundle_update_state_for_tag(&current, "v1.0.1", &cache, &installs)
            .expect("installed state accepts BOM-prefixed manifest");

        assert_eq!(state.status, "installed");
        build_installed_setup_bundle_launch_spec(&current, "v1.0.1", &installs)
            .expect("launch validation accepts BOM-prefixed manifest");
        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn installed_validation_rejects_nested_env_but_allows_carried_root_env() {
        let (root, cache, installs) = install_fixture("installed-env-rules");
        let current = root.join("current");
        fs::write(current.join(".env"), "LOCAL=1\n").expect("current env");
        write_staged_update(&cache, "v1.0.1", base_entries("v1.0.1"));

        install_setup_bundle_update_for_tag(&current, "v1.0.1", &cache, &installs, |_| {})
            .expect("install with env");

        let final_root = installs.join("v1.0.1");
        fs::create_dir_all(final_root.join("nested")).expect("nested dir");
        fs::write(final_root.join("nested").join(".env.local"), "SECRET=1\n").expect("nested env");

        let state = setup_bundle_update_state_for_tag(&current, "v1.0.1", &cache, &installs)
            .expect("state");
        assert_eq!(state.status, "conflict");
        let error = build_installed_setup_bundle_launch_spec(&current, "v1.0.1", &installs)
            .expect_err("open rejects nested env");
        assert!(error.code.contains("update_install"));

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn install_reuses_existing_valid_installation_without_overwrite() {
        let (root, cache, installs) = install_fixture("reuse");
        let current = root.join("current");
        write_staged_update(&cache, "v1.0.1", base_entries("v1.0.1"));
        install_setup_bundle_update_for_tag(&current, "v1.0.1", &cache, &installs, |_| {})
            .expect("first install");
        fs::write(installs.join("v1.0.1").join("marker.txt"), "preserve").expect("marker");

        let payload =
            install_setup_bundle_update_for_tag(&current, "v1.0.1", &cache, &installs, |_| {})
                .expect("reuse install");

        assert_eq!(
            payload.reason,
            "Update installation already exists and was revalidated."
        );
        assert_eq!(
            fs::read_to_string(installs.join("v1.0.1").join("marker.txt")).expect("marker"),
            "preserve"
        );
        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn install_rejects_development_checkout_and_missing_verified_cache_before_writes() {
        let root = temp_root("eligibility");
        let development = root.join("development");
        fs::create_dir_all(&development).expect("development root");
        fs::write(
            development.join("MOBILE-EDITION-IDENTITY.json"),
            r#"{"schema":"feedback-mobile-edition.identity.v1","editionVersion":"1.0.0","releaseTag":"v1.0.0","checkoutKind":"development","latestStableReleaseApiUrl":"https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest"}"#,
        )
        .expect("development identity");
        let cache = root.join("cache");
        let installs = root.join("installations");

        let error =
            install_setup_bundle_update_for_tag(&development, "v1.0.1", &cache, &installs, |_| {})
                .expect_err("dev ineligible");
        assert_eq!(error.code, "update_stage_ineligible");
        assert!(!installs.exists());

        let current = root.join("current");
        fs::create_dir_all(&current).expect("current root");
        write_bundle_identity(&current, "v1.0.0");
        let error =
            install_setup_bundle_update_for_tag(&current, "v1.0.1", &cache, &installs, |_| {})
                .expect_err("cache required");
        assert_eq!(error.code, "update_cache_missing");
        assert!(!installs.exists());

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn install_rejects_invalid_archive_paths_and_cleans_only_pending_directory() {
        let cases = [
            ("traversal", "../escape.txt"),
            ("backslash", "scripts\\bad.ps1"),
            ("absolute", "/absolute.txt"),
            ("drive", "C:/absolute.txt"),
            ("source-env", ".env"),
            ("source-env-suffix", ".env.production"),
            ("nested-env", "config/.env.local"),
            ("nested-git", "nested/.git/config"),
            ("audio", "library/song.mp3"),
            ("cache", "node_modules/pkg/index.js"),
            ("build", "build/output.bin"),
            ("dist", "dist/app.bin"),
            ("bootstrap-cache", ".setup-companion-bootstrap/package.zip"),
            ("trailing-dot", "scripts/bad./file.txt"),
            ("trailing-space", "scripts/bad /file.txt"),
            ("reserved-device", "scripts/CON.txt"),
        ];

        for (name, bad_entry) in cases {
            let (root, cache, installs) = install_fixture(name);
            let current = root.join("current");
            let mut entries = base_entries("v1.0.1");
            entries.push((bad_entry.to_string(), b"bad".to_vec()));
            write_staged_update(&cache, "v1.0.1", entries);
            let error =
                install_setup_bundle_update_for_tag(&current, "v1.0.1", &cache, &installs, |_| {})
                    .expect_err("reject bad archive");
            assert!(
                matches!(
                    error.code.as_str(),
                    "update_install_invalid_archive" | "update_install_overflow"
                ),
                "{name}: {}",
                error.code
            );
            assert!(!installs.join("v1.0.1").exists(), "{name}");
            assert!(
                fs::read_dir(&installs)
                    .map(|entries| entries.count() == 0)
                    .unwrap_or(true),
                "{name}"
            );
            assert!(current.exists(), "{name}");
            assert!(cache.exists(), "{name}");
            fs::remove_dir_all(root).expect("remove temp root");
        }

        let (root, cache, installs) = install_fixture("wrong-top");
        let current = root.join("current");
        let spec = setup_bundle_update_spec_for_tag("v1.0.1", &cache).expect("stage spec");
        fs::create_dir_all(&spec.cache_dir).expect("cache dir");
        write_raw_zip(
            &spec.final_zip_path,
            vec![(
                "wrong-top/Setup-MobileEdition.exe".to_string(),
                b"bad".to_vec(),
            )],
        );
        let hash = sha256_file_hex_for_install(&spec.final_zip_path, "test").expect("zip hash");
        fs::write(&spec.checksum_path, format!("{hash}  {}\n", spec.zip_name))
            .expect("checksum sidecar");
        let error =
            install_setup_bundle_update_for_tag(&current, "v1.0.1", &cache, &installs, |_| {})
                .expect_err("reject wrong top-level");
        assert_eq!(error.code, "update_install_invalid_archive");
        assert!(!installs.join("v1.0.1").exists());
        assert!(current.exists());
        assert!(cache.exists());
        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn install_archive_limits_reject_count_and_declared_size_overflow() {
        assert!(ensure_archive_entry_count(1).is_ok());
        assert_eq!(
            ensure_archive_entry_count(MAX_INSTALL_ARCHIVE_ENTRIES + 1)
                .expect_err("entry count overflow")
                .code,
            "update_install_invalid_archive"
        );
        assert_eq!(
            add_declared_archive_bytes(MAX_INSTALL_ARCHIVE_BYTES, 1)
                .expect_err("size overflow")
                .code,
            "update_install_overflow"
        );
    }

    #[test]
    fn bounded_stream_copy_rejects_size_mismatches() {
        let mut too_large = Cursor::new(b"abcd");
        let mut too_large_out = Vec::new();
        let error =
            copy_zip_entry_bounded(&mut too_large, &mut too_large_out, 3).expect_err("too large");
        assert_eq!(error.code, "update_install_invalid_archive");
        assert!(too_large_out.is_empty());

        let mut too_small = Cursor::new(b"abc");
        let mut too_small_out = Vec::new();
        let error =
            copy_zip_entry_bounded(&mut too_small, &mut too_small_out, 4).expect_err("too small");
        assert_eq!(error.code, "update_install_invalid_archive");
        assert_eq!(too_small_out, b"abc");
    }

    #[test]
    fn install_rejects_link_entries_without_following_them() {
        let (root, cache, installs) = install_fixture("link-entry");
        let current = root.join("current");
        let spec = setup_bundle_update_spec_for_tag("v1.0.1", &cache).expect("stage spec");
        fs::create_dir_all(&spec.cache_dir).expect("cache dir");
        write_raw_zip_with_symlink(&spec.final_zip_path, "feedback-mobile-edition-v1.0.1/link");
        let hash = sha256_file_hex_for_install(&spec.final_zip_path, "test").expect("zip hash");
        fs::write(&spec.checksum_path, format!("{hash}  {}\n", spec.zip_name))
            .expect("checksum sidecar");

        let error =
            install_setup_bundle_update_for_tag(&current, "v1.0.1", &cache, &installs, |_| {})
                .expect_err("reject link");

        assert_eq!(error.code, "update_install_invalid_archive");
        assert!(!installs.join("v1.0.1").exists());
        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn install_rejects_duplicate_destinations_and_missing_or_mismatched_manifest() {
        let (root, cache, installs) = install_fixture("invalid-manifest");
        let current = root.join("current");
        let mut duplicate = base_entries("v1.0.1");
        duplicate.push(("license".to_string(), b"duplicate".to_vec()));
        write_staged_update(&cache, "v1.0.1", duplicate);
        let error =
            install_setup_bundle_update_for_tag(&current, "v1.0.1", &cache, &installs, |_| {})
                .expect_err("duplicate");
        assert_eq!(error.code, "update_install_invalid_archive");

        let cases = [
            ("missing-required", {
                let mut entries = base_entries("v1.0.1");
                entries.retain(|(name, _)| name != "LICENSE");
                entries
            }),
            ("version-mismatch", {
                let mut entries = base_entries("v1.0.2");
                for (name, bytes) in &mut entries {
                    if name == "SETUP-BUNDLE-MANIFEST.json" {
                        *bytes = manifest("v1.0.0", &companion_hash()).into_bytes();
                    }
                }
                entries
            }),
            ("companion-hash-mismatch", {
                let mut entries = base_entries("v1.0.2");
                for (name, bytes) in &mut entries {
                    if name == "SETUP-BUNDLE-MANIFEST.json" {
                        *bytes = manifest(
                            "v1.0.2",
                            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        )
                        .into_bytes();
                    }
                }
                entries
            }),
            ("extra-manifest-field", {
                let mut entries = base_entries("v1.0.2");
                for (name, bytes) in &mut entries {
                    if name == "SETUP-BUNDLE-MANIFEST.json" {
                        *bytes = br#"{"schema":"feedback-mobile-edition.setup-bundle.v1","bundleFormat":"zip","editionVersion":"1.0.2","editionCommit":"0123456789abcdef0123456789abcdef01234567","companionPath":"Setup-MobileEdition.exe","companionSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","generatedAtUtc":"2026-09-09T00:00:00Z","extra":"nope"}"#.to_vec();
                    }
                }
                entries
            }),
        ];

        for (name, entries) in cases {
            let (root, cache, installs) = install_fixture(name);
            let current = root.join("current");
            write_staged_update(&cache, "v1.0.2", entries);
            let error =
                install_setup_bundle_update_for_tag(&current, "v1.0.2", &cache, &installs, |_| {})
                    .expect_err("reject invalid installed bundle");
            assert!(
                matches!(
                    error.code.as_str(),
                    "update_install_invalid" | "update_install_invalid_archive"
                ),
                "{name}: {}",
                error.code
            );
            assert!(!installs.join("v1.0.2").exists(), "{name}");
            fs::remove_dir_all(root).expect("remove temp root");
        }

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn open_new_version_builds_exact_launch_command_without_shell_or_service_control() {
        let unicode_name = format!(
            "launch-unicode-{}",
            char::from_u32(0x00f1).expect("unicode test character")
        );
        let (root, cache, installs) = install_fixture(&unicode_name);
        let current = root.join("current");
        write_staged_update(&cache, "v1.0.1", base_entries("v1.0.1"));
        install_setup_bundle_update_for_tag(&current, "v1.0.1", &cache, &installs, |_| {})
            .expect("install");
        let mut launched = None;

        let payload = open_installed_setup_bundle_update_for_tag_with_opener(
            &current,
            "v1.0.1",
            &installs,
            |spec| {
                launched = Some(spec.clone());
                Ok(())
            },
        )
        .expect("open");

        let spec = launched.expect("launch spec");
        let expected_root = installs.join("v1.0.1").canonicalize().expect("final root");
        assert_eq!(payload.status, "opened");
        assert_eq!(spec.program, expected_root.join("Setup-MobileEdition.exe"));
        assert_eq!(
            spec.args,
            vec![
                OsString::from("--checkout"),
                expected_root.as_os_str().to_os_string()
            ]
        );
        assert_eq!(spec.working_directory, expected_root);
        assert!(!spec
            .program
            .as_os_str()
            .to_string_lossy()
            .to_ascii_lowercase()
            .contains("cmd"));
        let args_text = spec
            .args
            .iter()
            .map(|arg| arg.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(!args_text.to_ascii_lowercase().contains("docker"));
        assert!(!args_text.to_ascii_lowercase().contains("tailscale"));

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn carried_env_must_be_regular_non_link_file() {
        let (root, cache, installs) = install_fixture("linked-env");
        let current = root.join("current");
        let external_env = root.join("external.env");
        fs::write(&external_env, "SECRET=outside\n").expect("external env");
        if create_file_link(&external_env, &current.join(".env")).is_err() {
            fs::remove_dir_all(root).expect("remove temp root");
            return;
        }
        write_staged_update(&cache, "v1.0.1", base_entries("v1.0.1"));

        let error =
            install_setup_bundle_update_for_tag(&current, "v1.0.1", &cache, &installs, |_| {})
                .expect_err("linked env rejected");

        assert_eq!(error.code, "update_install_failed");
        assert!(!installs.join("v1.0.1").exists());
        assert!(!fs::read_dir(&installs)
            .map(|entries| entries
                .filter_map(Result::ok)
                .any(|entry| entry.file_name().to_string_lossy().starts_with(".pending-")))
            .unwrap_or(false));
        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn final_publish_is_no_replace_when_destination_appears_late() {
        let root = temp_root("publish-no-replace");
        let source = root.join("source");
        let destination = root.join("v1.0.1");
        fs::create_dir_all(&source).expect("source");
        fs::write(source.join("marker.txt"), "new").expect("source marker");
        fs::create_dir_all(&destination).expect("late destination");
        fs::write(destination.join("marker.txt"), "existing").expect("existing marker");

        let error = publish_extracted_installation_no_replace(&source, &destination)
            .expect_err("existing destination is conflict");

        assert_eq!(error.code, "update_install_conflict");
        assert_eq!(
            fs::read_to_string(destination.join("marker.txt")).expect("existing marker"),
            "existing"
        );
        assert_eq!(
            fs::read_to_string(source.join("marker.txt")).expect("source marker"),
            "new"
        );
        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn existing_final_installation_must_not_be_a_directory_link() {
        let (root, cache, installs) = install_fixture("linked-final");
        let current = root.join("current");
        let external_installs = root.join("external-installations");
        write_staged_update(&cache, "v1.0.1", base_entries("v1.0.1"));
        install_setup_bundle_update_for_tag(&current, "v1.0.1", &cache, &external_installs, |_| {})
            .expect("external install");
        fs::create_dir_all(&installs).expect("install root");
        let link = installs.join("v1.0.1");
        let target = external_installs.join("v1.0.1");
        if create_dir_link(&target, &link).is_err() {
            fs::remove_dir_all(root).expect("remove temp root");
            return;
        }

        let state = setup_bundle_update_state_for_tag(&current, "v1.0.1", &cache, &installs)
            .expect("linked state");
        assert_eq!(state.status, "conflict");
        let error = build_installed_setup_bundle_launch_spec(&current, "v1.0.1", &installs)
            .expect_err("linked launch rejected");
        assert_eq!(error.code, "update_install_invalid");

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[cfg(windows)]
    fn create_dir_link(target: &Path, link: &Path) -> io::Result<()> {
        std::os::windows::fs::symlink_dir(target, link)
    }

    #[cfg(unix)]
    fn create_dir_link(target: &Path, link: &Path) -> io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    #[cfg(not(any(unix, windows)))]
    fn create_dir_link(_target: &Path, _link: &Path) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "links unsupported",
        ))
    }

    #[cfg(windows)]
    fn create_file_link(target: &Path, link: &Path) -> io::Result<()> {
        std::os::windows::fs::symlink_file(target, link)
    }

    #[cfg(unix)]
    fn create_file_link(target: &Path, link: &Path) -> io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    #[cfg(not(any(unix, windows)))]
    fn create_file_link(_target: &Path, _link: &Path) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "links unsupported",
        ))
    }

    #[test]
    fn local_roots_use_separate_cache_and_installation_children() {
        let cache = local_update_cache_root().expect("cache root");
        let installs = local_installations_root().expect("install root");

        assert!(cache.ends_with("update-cache"));
        assert!(installs.ends_with("installations"));
        assert_ne!(cache, installs);
    }
}
