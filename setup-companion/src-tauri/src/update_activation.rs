use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::update_install::{
    local_installations_root, validate_installed_setup_bundle_in_root,
    validate_setup_bundle_checkout_in_place,
};
use crate::{update_identity_for_checkout, validate_stable_release_tag, UiError};

const DATA_ROOT_CHILD: &str = "fee[dB]ack Mobile Edition";
const CURRENT_INSTALLATION_RECORD: &str = "current-installation.json";
const CURRENT_INSTALLATION_SCHEMA: &str = "feedback-mobile-edition.current-installation.v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationStatePayload {
    pub status: String,
    pub tag: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationPayload {
    pub status: String,
    pub tag: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInventoryPayload {
    pub status: String,
    pub versions: Vec<VersionInventoryItemPayload>,
    pub current_source: String,
    pub current_tag: String,
    pub running_tag: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInventoryItemPayload {
    pub tag: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionSelectionPayload {
    pub status: String,
    pub current_source: String,
    pub current_tag: String,
    pub reason: String,
    pub inventory: VersionInventoryPayload,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CurrentInstallationRecord {
    schema: String,
    current_tag: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ManagedCheckout {
    tag: String,
    canonical_root: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CurrentRecordState {
    Missing,
    Valid(String),
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Semver {
    major: u64,
    minor: u64,
    patch: u64,
}

pub fn local_companion_data_root() -> Result<PathBuf, UiError> {
    dirs::data_local_dir()
        .map(|root| root.join(DATA_ROOT_CHILD))
        .ok_or_else(|| {
            UiError::new(
                "activation_unavailable",
                "Could not locate the local activation directory.",
            )
        })
}

pub fn setup_bundle_activation_state_for_checkout(
    current_root: &Path,
    data_root: &Path,
    installations_root: &Path,
) -> Result<ActivationStatePayload, UiError> {
    let managed = match managed_checkout(current_root, installations_root) {
        Ok(managed) => managed,
        Err(_) => {
            return Ok(activation_state_payload(
                "unavailable",
                "",
                "This checkout cannot be made current.",
            ))
        }
    };

    match read_current_record_state(&current_record_path(data_root)) {
        CurrentRecordState::Missing => Ok(activation_state_payload(
            "activatable",
            &managed.tag,
            "Make this version current for the original setup launcher.",
        )),
        CurrentRecordState::Invalid => Ok(activation_state_payload(
            "invalid_current",
            &managed.tag,
            "Current launcher record is invalid. This version can replace it.",
        )),
        CurrentRecordState::Valid(current_tag) => {
            if validate_record_target(&current_tag, installations_root).is_err() {
                return Ok(activation_state_payload(
                    "invalid_current",
                    &managed.tag,
                    "Current launcher record points to an invalid version. This version can replace it.",
                ));
            }
            if current_tag == managed.tag {
                Ok(activation_state_payload(
                    "current",
                    &managed.tag,
                    "The original setup launcher will open this version next time.",
                ))
            } else {
                Ok(activation_state_payload(
                    "activatable",
                    &managed.tag,
                    "Make this version current for the original setup launcher.",
                ))
            }
        }
    }
}

pub fn activate_setup_bundle_for_checkout(
    current_root: &Path,
    data_root: &Path,
    installations_root: &Path,
) -> Result<ActivationPayload, UiError> {
    let managed = managed_checkout(current_root, installations_root)?;
    write_current_record_atomic(data_root, &managed.tag)?;
    let state =
        setup_bundle_activation_state_for_checkout(current_root, data_root, installations_root)?;
    if state.status != "current" {
        return Err(UiError::new(
            "activation_failed",
            "Current version could not be verified after activation.",
        ));
    }
    Ok(ActivationPayload {
        status: "current".to_string(),
        tag: managed.tag,
        reason:
            "Current version saved. The original setup launcher will open this version next time."
                .to_string(),
    })
}

pub fn setup_bundle_activation_state_for_local_checkout(
    current_root: &Path,
) -> Result<ActivationStatePayload, UiError> {
    let data_root = local_companion_data_root()?;
    let installations_root = local_installations_root()?;
    setup_bundle_activation_state_for_checkout(current_root, &data_root, &installations_root)
}

pub fn activate_setup_bundle_for_local_checkout(
    current_root: &Path,
) -> Result<ActivationPayload, UiError> {
    let data_root = local_companion_data_root()?;
    let installations_root = local_installations_root()?;
    activate_setup_bundle_for_checkout(current_root, &data_root, &installations_root)
}

pub fn setup_bundle_version_inventory_for_checkout(
    current_root: &Path,
    data_root: &Path,
    installations_root: &Path,
) -> Result<VersionInventoryPayload, UiError> {
    let running = match setup_bundle_checkout(current_root) {
        Ok(running) => running,
        Err(_) => {
            return Ok(version_inventory_payload(
                "unavailable",
                Vec::new(),
                "",
                "",
                "",
                "Version management is unavailable for this checkout.",
            ))
        }
    };

    let versions = validated_versions(installations_root);
    let record_state = read_current_record_state(&current_record_path(data_root));
    let (current_source, current_tag, reason) = match record_state {
        CurrentRecordState::Missing => (
            "bundled".to_string(),
            String::new(),
            "The original setup launcher will use its bundled Companion next time.".to_string(),
        ),
        CurrentRecordState::Invalid => (
            "invalid".to_string(),
            String::new(),
            "Current launcher record is invalid. Choose a version or use the bundled Companion."
                .to_string(),
        ),
        CurrentRecordState::Valid(tag) => {
            if validate_record_target(&tag, installations_root).is_ok() {
                (
                    "managed".to_string(),
                    tag.clone(),
                    format!("The original setup launcher will open {tag} next time."),
                )
            } else {
                (
                    "invalid".to_string(),
                    String::new(),
                    "Current launcher record points to an invalid version. Choose a version or use the bundled Companion."
                        .to_string(),
                )
            }
        }
    };

    Ok(version_inventory_payload(
        "ready",
        versions,
        &current_source,
        &current_tag,
        &running.tag,
        &reason,
    ))
}

pub fn select_setup_bundle_version_for_checkout(
    current_root: &Path,
    data_root: &Path,
    installations_root: &Path,
    tag: &str,
) -> Result<VersionSelectionPayload, UiError> {
    setup_bundle_checkout(current_root)?;
    let validated = validate_stable_release_tag(tag)?;
    validate_record_target(validated, installations_root)?;
    write_current_record_atomic(data_root, validated)?;
    let inventory =
        setup_bundle_version_inventory_for_checkout(current_root, data_root, installations_root)?;
    if inventory.current_source != "managed" || inventory.current_tag != validated {
        return Err(UiError::new(
            "version_select_failed",
            "Selected version could not be verified.",
        ));
    }
    Ok(VersionSelectionPayload {
        status: "selected".to_string(),
        current_source: "managed".to_string(),
        current_tag: validated.to_string(),
        reason: format!(
            "Current version saved. The original setup launcher will open {validated} next time."
        ),
        inventory,
    })
}

pub fn restore_bundled_setup_for_checkout(
    current_root: &Path,
    data_root: &Path,
    installations_root: &Path,
) -> Result<VersionSelectionPayload, UiError> {
    setup_bundle_checkout(current_root)?;
    remove_current_record_file(data_root)?;
    let inventory =
        setup_bundle_version_inventory_for_checkout(current_root, data_root, installations_root)?;
    if inventory.current_source != "bundled" {
        return Err(UiError::new(
            "version_restore_failed",
            "Bundled setup fallback could not be verified.",
        ));
    }
    Ok(VersionSelectionPayload {
        status: "bundled".to_string(),
        current_source: "bundled".to_string(),
        current_tag: String::new(),
        reason: "Bundled version restored. The original setup launcher will use its bundled Companion next time."
            .to_string(),
        inventory,
    })
}

pub fn setup_bundle_version_inventory_for_local_checkout(
    current_root: &Path,
) -> Result<VersionInventoryPayload, UiError> {
    let data_root = local_companion_data_root()?;
    let installations_root = local_installations_root()?;
    setup_bundle_version_inventory_for_checkout(current_root, &data_root, &installations_root)
}

pub fn select_setup_bundle_version_for_local_checkout(
    current_root: &Path,
    tag: &str,
) -> Result<VersionSelectionPayload, UiError> {
    let data_root = local_companion_data_root()?;
    let installations_root = local_installations_root()?;
    select_setup_bundle_version_for_checkout(current_root, &data_root, &installations_root, tag)
}

pub fn restore_bundled_setup_for_local_checkout(
    current_root: &Path,
) -> Result<VersionSelectionPayload, UiError> {
    let data_root = local_companion_data_root()?;
    let installations_root = local_installations_root()?;
    restore_bundled_setup_for_checkout(current_root, &data_root, &installations_root)
}

fn setup_bundle_checkout(current_root: &Path) -> Result<ManagedCheckout, UiError> {
    let identity = update_identity_for_checkout(current_root);
    if identity.status != "ready" || identity.source != "setup_bundle" {
        return Err(UiError::new(
            "version_management_unavailable",
            "Version management is unavailable for this checkout.",
        ));
    }
    let tag = identity
        .local_tag
        .as_deref()
        .ok_or_else(|| {
            UiError::new(
                "version_management_unavailable",
                "Version management is unavailable for this checkout.",
            )
        })
        .and_then(|tag| validate_stable_release_tag(tag).map(str::to_string))?;
    let canonical_root =
        validate_setup_bundle_checkout_in_place(current_root, &tag).map_err(|_| {
            UiError::new(
                "version_management_unavailable",
                "Version management is unavailable for this checkout.",
            )
        })?;
    Ok(ManagedCheckout {
        tag,
        canonical_root,
    })
}

fn managed_checkout(
    current_root: &Path,
    installations_root: &Path,
) -> Result<ManagedCheckout, UiError> {
    let identity = update_identity_for_checkout(current_root);
    if identity.status != "ready" || identity.source != "setup_bundle" {
        return Err(UiError::new(
            "activation_unavailable",
            "This checkout cannot be made current.",
        ));
    }
    let tag = identity
        .local_tag
        .as_deref()
        .ok_or_else(|| {
            UiError::new(
                "activation_unavailable",
                "This checkout cannot be made current.",
            )
        })
        .and_then(|tag| validate_stable_release_tag(tag).map(str::to_string))?;
    let expected_root = installations_root.join(&tag);
    let canonical_expected =
        validate_installed_setup_bundle_in_root(installations_root, &expected_root, &tag)?;
    let canonical_current = current_root.canonicalize().map_err(|_| {
        UiError::new(
            "activation_unavailable",
            "This checkout cannot be made current.",
        )
    })?;
    if canonical_current != canonical_expected {
        return Err(UiError::new(
            "activation_unavailable",
            "This checkout cannot be made current.",
        ));
    }
    Ok(ManagedCheckout {
        tag,
        canonical_root: canonical_expected,
    })
}

fn validate_record_target(tag: &str, installations_root: &Path) -> Result<PathBuf, UiError> {
    let validated = validate_stable_release_tag(tag)?;
    let target = installations_root.join(validated);
    validate_installed_setup_bundle_in_root(installations_root, &target, validated)
}

fn validated_versions(installations_root: &Path) -> Vec<VersionInventoryItemPayload> {
    let Ok(entries) = fs::read_dir(installations_root) else {
        return Vec::new();
    };
    let mut versions = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let tag = entry.file_name().to_string_lossy().to_string();
            validate_stable_release_tag(&tag).ok()?;
            validate_installed_setup_bundle_in_root(installations_root, &entry.path(), &tag)
                .ok()?;
            Some(VersionInventoryItemPayload { tag })
        })
        .collect::<Vec<_>>();
    versions.sort_by(|left, right| {
        let left_version = parse_semver_tag(&left.tag);
        let right_version = parse_semver_tag(&right.tag);
        right_version
            .major
            .cmp(&left_version.major)
            .then(right_version.minor.cmp(&left_version.minor))
            .then(right_version.patch.cmp(&left_version.patch))
    });
    versions
}

fn parse_semver_tag(tag: &str) -> Semver {
    let mut parts = tag
        .strip_prefix('v')
        .unwrap_or(tag)
        .split('.')
        .map(|part| part.parse::<u64>().unwrap_or(0));
    Semver {
        major: parts.next().unwrap_or(0),
        minor: parts.next().unwrap_or(0),
        patch: parts.next().unwrap_or(0),
    }
}

fn read_current_record_state(path: &Path) -> CurrentRecordState {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return CurrentRecordState::Missing
        }
        Err(_) => return CurrentRecordState::Invalid,
    };
    let record = match serde_json::from_str::<CurrentInstallationRecord>(&content) {
        Ok(record) => record,
        Err(_) => return CurrentRecordState::Invalid,
    };
    if record.schema != CURRENT_INSTALLATION_SCHEMA
        || validate_stable_release_tag(&record.current_tag).is_err()
    {
        return CurrentRecordState::Invalid;
    }
    CurrentRecordState::Valid(record.current_tag)
}

fn write_current_record_atomic(data_root: &Path, tag: &str) -> Result<(), UiError> {
    let validated = validate_stable_release_tag(tag)?;
    fs::create_dir_all(data_root).map_err(|_| {
        UiError::new(
            "activation_failed",
            "Could not prepare current-version storage.",
        )
    })?;
    let record_path = current_record_path(data_root);
    let temporary_path = current_record_temporary_path(data_root)?;
    let result = (|| {
        let record = CurrentInstallationRecord {
            schema: CURRENT_INSTALLATION_SCHEMA.to_string(),
            current_tag: validated.to_string(),
        };
        let bytes = serde_json::to_vec(&record).map_err(|_| {
            UiError::new(
                "activation_failed",
                "Could not prepare current-version record.",
            )
        })?;
        fs::write(&temporary_path, bytes).map_err(|_| {
            UiError::new(
                "activation_failed",
                "Could not write current-version record.",
            )
        })?;
        rename_replace(&temporary_path, &record_path).map_err(|_| {
            UiError::new(
                "activation_failed",
                "Could not save current-version record.",
            )
        })?;
        Ok(())
    })();
    if result.is_err() && temporary_path.exists() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

fn current_record_path(data_root: &Path) -> PathBuf {
    data_root.join(CURRENT_INSTALLATION_RECORD)
}

fn current_record_temporary_path(data_root: &Path) -> Result<PathBuf, UiError> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| {
            UiError::new(
                "activation_failed",
                "Could not prepare current-version record.",
            )
        })?
        .as_nanos();
    Ok(data_root.join(format!(
        "{CURRENT_INSTALLATION_RECORD}.{}.{}.tmp",
        std::process::id(),
        nonce
    )))
}

fn remove_current_record_file(data_root: &Path) -> Result<(), UiError> {
    let path = current_record_path(data_root);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(_) => {
            return Err(UiError::new(
                "version_restore_failed",
                "Current-version record could not be inspected.",
            ))
        }
    };
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || has_reparse_point(&metadata)
    {
        return Err(UiError::new(
            "version_restore_failed",
            "Current-version record is not an ordinary file.",
        ));
    }
    fs::remove_file(&path).map_err(|_| {
        UiError::new(
            "version_restore_failed",
            "Current-version record could not be removed.",
        )
    })
}

#[cfg(windows)]
fn has_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn has_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(windows)]
fn rename_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x0000_0001;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;

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
    let moved = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn rename_replace(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

fn activation_state_payload(status: &str, tag: &str, reason: &str) -> ActivationStatePayload {
    ActivationStatePayload {
        status: status.to_string(),
        tag: tag.to_string(),
        reason: reason.to_string(),
    }
}

fn version_inventory_payload(
    status: &str,
    versions: Vec<VersionInventoryItemPayload>,
    current_source: &str,
    current_tag: &str,
    running_tag: &str,
    reason: &str,
) -> VersionInventoryPayload {
    VersionInventoryPayload {
        status: status.to_string(),
        versions,
        current_source: current_source.to_string(),
        current_tag: current_tag.to_string(),
        running_tag: running_tag.to_string(),
        reason: reason.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::env;

    fn temp_root(name: &str) -> PathBuf {
        let mut root = env::temp_dir();
        root.push(format!(
            "feedback-setup-companion-activation-{name}-{}",
            std::process::id()
        ));
        if root.exists() {
            fs::remove_dir_all(&root).expect("remove stale temp root");
        }
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    fn write_valid_installation(installations_root: &Path, tag: &str) -> PathBuf {
        let root = installations_root.join(tag);
        fs::create_dir_all(root.join("scripts")).expect("scripts");
        let companion = b"fake companion bytes";
        fs::write(root.join("Setup-MobileEdition.exe"), companion).expect("companion");
        fs::write(root.join("Setup-MobileEdition.cmd"), b"@echo off").expect("cmd");
        fs::write(root.join(".env.example"), b"LIBRARY_PATH=./library").expect("env example");
        fs::write(
            root.join("docker-compose.release.yml"),
            b"name: feedback-mobile-edition",
        )
        .expect("compose");
        fs::write(root.join("LICENSE"), b"license").expect("license");
        fs::write(root.join("ATTRIBUTIONS.md"), b"# Attributions").expect("attributions");
        fs::write(root.join("RELEASE-MANIFEST.md"), b"# Manifest").expect("manifest");
        fs::write(
            root.join("scripts").join("Setup-MobileEdition.ps1"),
            b"Write-Output setup",
        )
        .expect("setup script");
        fs::write(
            root.join("scripts").join("Start-MobileEditionSetup.ps1"),
            b"Write-Output launcher",
        )
        .expect("start script");
        let version = tag.strip_prefix('v').unwrap_or(tag);
        fs::write(
            root.join("SETUP-BUNDLE-MANIFEST.json"),
            format!(
                r#"{{
                  "schema": "feedback-mobile-edition.setup-bundle.v1",
                  "bundleFormat": "zip",
                  "editionVersion": "{version}",
                  "editionCommit": "0123456789abcdef0123456789abcdef01234567",
                  "companionPath": "Setup-MobileEdition.exe",
                  "companionSha256": "{}",
                  "generatedAtUtc": "2026-09-09T00:00:00Z"
                }}"#,
                sha256_hex(companion)
            ),
        )
        .expect("bundle manifest");
        root
    }

    fn write_record(data_root: &Path, content: &str) {
        fs::create_dir_all(data_root).expect("data root");
        fs::write(current_record_path(data_root), content).expect("record");
    }

    fn valid_record(tag: &str) -> String {
        format!(
            r#"{{"schema":"feedback-mobile-edition.current-installation.v1","currentTag":"{tag}"}}"#
        )
    }

    fn create_invalid_installation(installations_root: &Path, tag: &str) {
        let root = installations_root.join(tag);
        fs::create_dir_all(&root).expect("invalid root");
        fs::write(root.join("SETUP-BUNDLE-MANIFEST.json"), b"{ invalid").expect("invalid manifest");
    }

    fn write_minimal_setup_bundle_manifest(root: &Path, tag: &str) {
        fs::create_dir_all(root).expect("minimal root");
        fs::write(
            root.join("SETUP-BUNDLE-MANIFEST.json"),
            format!(
                r#"{{
                  "schema": "feedback-mobile-edition.setup-bundle.v1",
                  "editionVersion": "{}"
                }}"#,
                tag.strip_prefix('v').unwrap_or(tag)
            ),
        )
        .expect("minimal manifest");
    }

    fn assert_running_bundle_cannot_manage_versions(
        running_root: &Path,
        data_root: &Path,
        installs: &Path,
    ) {
        write_record(data_root, &valid_record("v1.0.2"));

        let inventory =
            setup_bundle_version_inventory_for_checkout(running_root, data_root, installs)
                .expect("unavailable inventory");
        assert_eq!(inventory.status, "unavailable");

        let select_error =
            select_setup_bundle_version_for_checkout(running_root, data_root, installs, "v1.0.2")
                .expect_err("selection rejected");
        assert_eq!(select_error.code, "version_management_unavailable");
        assert_eq!(
            fs::read_to_string(current_record_path(data_root)).expect("record"),
            valid_record("v1.0.2")
        );

        let restore_error = restore_bundled_setup_for_checkout(running_root, data_root, installs)
            .expect_err("restore rejected");
        assert_eq!(restore_error.code, "version_management_unavailable");
        assert_eq!(
            fs::read_to_string(current_record_path(data_root)).expect("record"),
            valid_record("v1.0.2")
        );
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

    #[test]
    fn activation_state_distinguishes_unavailable_activatable_current_and_invalid_current() {
        let root = temp_root("states");
        let data_root = root.join("data");
        let installs = root.join("installations");
        let managed = write_valid_installation(&installs, "v1.0.1");

        let unavailable = setup_bundle_activation_state_for_checkout(&root, &data_root, &installs)
            .expect("state");
        assert_eq!(unavailable.status, "unavailable");

        let activatable =
            setup_bundle_activation_state_for_checkout(&managed, &data_root, &installs)
                .expect("activatable");
        assert_eq!(activatable.status, "activatable");
        assert_eq!(activatable.tag, "v1.0.1");

        write_record(&data_root, &valid_record("v1.0.1"));
        let current = setup_bundle_activation_state_for_checkout(&managed, &data_root, &installs)
            .expect("current");
        assert_eq!(current.status, "current");

        write_record(&data_root, "{ invalid");
        let invalid = setup_bundle_activation_state_for_checkout(&managed, &data_root, &installs)
            .expect("invalid current");
        assert_eq!(invalid.status, "invalid_current");

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn activation_writes_tag_only_record_atomically_and_revalidates() {
        let root = temp_root("activate");
        let data_root = root.join("data");
        let installs = root.join("installations");
        let managed = write_valid_installation(&installs, "v1.0.1");

        let payload =
            activate_setup_bundle_for_checkout(&managed, &data_root, &installs).expect("activate");

        assert_eq!(payload.status, "current");
        assert_eq!(payload.tag, "v1.0.1");
        let record = fs::read_to_string(current_record_path(&data_root)).expect("record");
        assert_eq!(record, valid_record("v1.0.1"));
        assert_eq!(
            fs::read_dir(&data_root)
                .expect("data entries")
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
                .count(),
            0
        );
        assert!(!record.contains("installations"));
        assert!(!record.contains("Setup-MobileEdition.exe"));

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn activation_rejects_development_external_and_invalid_targets() {
        let root = temp_root("reject");
        let data_root = root.join("data");
        let installs = root.join("installations");
        let managed = write_valid_installation(&installs, "v1.0.1");
        let external = root.join("external");
        fs::create_dir_all(&external).expect("external");
        fs::copy(
            managed.join("SETUP-BUNDLE-MANIFEST.json"),
            external.join("SETUP-BUNDLE-MANIFEST.json"),
        )
        .expect("external manifest");

        let error = activate_setup_bundle_for_checkout(&external, &data_root, &installs)
            .expect_err("external not activatable");
        assert_eq!(error.code, "activation_unavailable");

        write_record(&data_root, &valid_record("v9.9.9"));
        let invalid = setup_bundle_activation_state_for_checkout(&managed, &data_root, &installs)
            .expect("invalid target state");
        assert_eq!(invalid.status, "invalid_current");

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn activation_record_parser_rejects_duplicates_extra_fields_and_bad_tags() {
        let root = temp_root("strict-record");
        let record = root.join("current-installation.json");
        fs::create_dir_all(&root).expect("root");

        let cases = [
            "{ invalid",
            r#"{"schema":"feedback-mobile-edition.current-installation.v1","schema":"feedback-mobile-edition.current-installation.v1","currentTag":"v1.0.1"}"#,
            r#"{"schema":"feedback-mobile-edition.current-installation.v1","currentTag":"v1.0.1","path":"C:\\secret"}"#,
            r#"{"schema":"feedback-mobile-edition.current-installation.v1"}"#,
            r#"{"schema":"feedback-mobile-edition.current-installation.v1","currentTag":"1.0.1"}"#,
            r#"{"schema":"feedback-mobile-edition.current-installation.v2","currentTag":"v1.0.1"}"#,
        ];
        for content in cases {
            fs::write(&record, content).expect("record");
            assert_eq!(
                read_current_record_state(&record),
                CurrentRecordState::Invalid
            );
        }

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn version_inventory_sorts_validated_versions_and_filters_invalid_entries() {
        let root = temp_root("inventory");
        let data_root = root.join("data");
        let installs = root.join("installations");
        let running = write_valid_installation(&installs, "v1.2.0");
        write_valid_installation(&installs, "v1.10.0");
        write_valid_installation(&installs, "v1.2.3");
        create_invalid_installation(&installs, "v9.9.9");
        create_invalid_installation(&installs, "not-a-tag");

        let inventory =
            setup_bundle_version_inventory_for_checkout(&running, &data_root, &installs)
                .expect("inventory");

        assert_eq!(inventory.status, "ready");
        assert_eq!(inventory.current_source, "bundled");
        assert_eq!(inventory.running_tag, "v1.2.0");
        assert_eq!(
            inventory
                .versions
                .iter()
                .map(|version| version.tag.as_str())
                .collect::<Vec<_>>(),
            vec!["v1.10.0", "v1.2.3", "v1.2.0"]
        );

        let unavailable = setup_bundle_version_inventory_for_checkout(&root, &data_root, &installs)
            .expect("unavailable");
        assert_eq!(unavailable.status, "unavailable");

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn version_management_requires_complete_valid_running_setup_bundle() {
        let root = temp_root("running-validation");
        let installs = root.join("installations");
        write_valid_installation(&installs, "v1.0.2");

        let minimal_root = root.join("minimal-running");
        let minimal_data = root.join("minimal-data");
        write_minimal_setup_bundle_manifest(&minimal_root, "v1.0.1");
        assert_running_bundle_cannot_manage_versions(&minimal_root, &minimal_data, &installs);

        let damaged_running = write_valid_installation(&root.join("damaged-running"), "v1.0.1");
        fs::write(
            damaged_running.join("Setup-MobileEdition.exe"),
            b"damaged companion bytes",
        )
        .expect("damage companion");
        assert_running_bundle_cannot_manage_versions(
            &damaged_running,
            &root.join("damaged-data"),
            &installs,
        );

        let forbidden_running = write_valid_installation(&root.join("forbidden-running"), "v1.0.1");
        fs::create_dir_all(forbidden_running.join("node_modules").join("pkg"))
            .expect("forbidden dir");
        fs::write(
            forbidden_running
                .join("node_modules")
                .join("pkg")
                .join("index.js"),
            b"cache",
        )
        .expect("forbidden file");
        assert_running_bundle_cannot_manage_versions(
            &forbidden_running,
            &root.join("forbidden-data"),
            &installs,
        );

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn version_management_rejects_linked_running_root_but_allows_valid_external_bundle() {
        let root = temp_root("running-link");
        let installs = root.join("installations");
        write_valid_installation(&installs, "v1.0.2");
        write_valid_installation(&installs, "v1.0.3");

        let external_running = write_valid_installation(&root.join("external-original"), "v1.0.1");
        let data_root = root.join("data");
        let inventory =
            setup_bundle_version_inventory_for_checkout(&external_running, &data_root, &installs)
                .expect("valid external inventory");
        assert_eq!(inventory.status, "ready");
        assert_eq!(inventory.running_tag, "v1.0.1");
        assert_eq!(
            inventory
                .versions
                .iter()
                .map(|version| version.tag.as_str())
                .collect::<Vec<_>>(),
            vec!["v1.0.3", "v1.0.2"]
        );

        let selected = select_setup_bundle_version_for_checkout(
            &external_running,
            &data_root,
            &installs,
            "v1.0.2",
        )
        .expect("valid external selection");
        assert_eq!(selected.current_tag, "v1.0.2");
        let restored = restore_bundled_setup_for_checkout(&external_running, &data_root, &installs)
            .expect("valid external restore");
        assert_eq!(restored.current_source, "bundled");

        let linked_root = root.join("linked-running");
        if create_dir_link(&external_running, &linked_root).is_ok() {
            assert_running_bundle_cannot_manage_versions(
                &linked_root,
                &root.join("linked-data"),
                &installs,
            );
            let _ = fs::remove_dir(&linked_root);
        }

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn version_inventory_reports_managed_bundled_and_invalid_current_states() {
        let root = temp_root("current-states");
        let data_root = root.join("data");
        let installs = root.join("installations");
        let running = write_valid_installation(&installs, "v1.0.1");

        let bundled = setup_bundle_version_inventory_for_checkout(&running, &data_root, &installs)
            .expect("bundled");
        assert_eq!(bundled.current_source, "bundled");
        assert_eq!(bundled.current_tag, "");

        write_record(&data_root, &valid_record("v1.0.1"));
        let managed = setup_bundle_version_inventory_for_checkout(&running, &data_root, &installs)
            .expect("managed");
        assert_eq!(managed.current_source, "managed");
        assert_eq!(managed.current_tag, "v1.0.1");

        write_record(&data_root, "{ invalid");
        let invalid = setup_bundle_version_inventory_for_checkout(&running, &data_root, &installs)
            .expect("invalid");
        assert_eq!(invalid.current_source, "invalid");
        assert_eq!(invalid.current_tag, "");

        write_record(&data_root, &valid_record("v9.9.9"));
        let invalid_target =
            setup_bundle_version_inventory_for_checkout(&running, &data_root, &installs)
                .expect("invalid target");
        assert_eq!(invalid_target.current_source, "invalid");

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn selecting_versions_reuses_tag_only_record_and_is_idempotent() {
        let root = temp_root("select");
        let data_root = root.join("data");
        let installs = root.join("installations");
        let running = write_valid_installation(&installs, "v1.0.1");
        write_valid_installation(&installs, "v1.0.2");

        let selected =
            select_setup_bundle_version_for_checkout(&running, &data_root, &installs, "v1.0.2")
                .expect("selected");
        assert_eq!(selected.status, "selected");
        assert_eq!(selected.current_source, "managed");
        assert_eq!(selected.current_tag, "v1.0.2");
        let record = fs::read_to_string(current_record_path(&data_root)).expect("record");
        assert_eq!(record, valid_record("v1.0.2"));
        assert!(!record.contains("installations"));
        assert_eq!(
            fs::read_dir(&data_root)
                .expect("data entries")
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
                .count(),
            0
        );

        let same =
            select_setup_bundle_version_for_checkout(&running, &data_root, &installs, "v1.0.2")
                .expect("same tag");
        assert_eq!(same.current_tag, "v1.0.2");

        let bad_tag =
            select_setup_bundle_version_for_checkout(&running, &data_root, &installs, "1.0.2")
                .expect_err("bad tag");
        assert_ne!(bad_tag.code, "");
        let missing =
            select_setup_bundle_version_for_checkout(&running, &data_root, &installs, "v9.9.9")
                .expect_err("missing target");
        assert_ne!(missing.code, "");

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn restoring_bundled_fallback_removes_only_ordinary_current_record() {
        let root = temp_root("restore");
        let data_root = root.join("data");
        let installs = root.join("installations");
        let running = write_valid_installation(&installs, "v1.0.1");
        write_record(&data_root, &valid_record("v1.0.1"));

        let restored =
            restore_bundled_setup_for_checkout(&running, &data_root, &installs).expect("restore");
        assert_eq!(restored.status, "bundled");
        assert_eq!(restored.current_source, "bundled");
        assert!(!current_record_path(&data_root).exists());

        let same =
            restore_bundled_setup_for_checkout(&running, &data_root, &installs).expect("missing");
        assert_eq!(same.current_source, "bundled");

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn restore_refuses_directory_and_link_records_without_following_them() {
        let root = temp_root("restore-link");
        let data_root = root.join("data");
        let installs = root.join("installations");
        let running = write_valid_installation(&installs, "v1.0.1");
        fs::create_dir_all(&data_root).expect("data root");
        let record_path = current_record_path(&data_root);
        fs::create_dir(&record_path).expect("record directory");

        let directory_error = restore_bundled_setup_for_checkout(&running, &data_root, &installs)
            .expect_err("directory record rejected");
        assert_eq!(directory_error.code, "version_restore_failed");
        fs::remove_dir(&record_path).expect("remove record directory");

        let target = root.join("linked-record-target.json");
        fs::write(&target, valid_record("v1.0.1")).expect("target record");
        if create_file_link(&target, &record_path).is_ok() {
            let link_error = restore_bundled_setup_for_checkout(&running, &data_root, &installs)
                .expect_err("link record rejected");
            assert_eq!(link_error.code, "version_restore_failed");
            assert!(target.exists());
            let _ = fs::remove_file(&record_path);
        }

        fs::remove_dir_all(root).expect("remove temp root");
    }
}
