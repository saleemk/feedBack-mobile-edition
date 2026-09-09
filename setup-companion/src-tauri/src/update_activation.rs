use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::update_install::{local_installations_root, validate_installed_setup_bundle_in_root};
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
}
