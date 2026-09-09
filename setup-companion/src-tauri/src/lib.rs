use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::Emitter;
use update_activation::{
    activate_setup_bundle_for_local_checkout, restore_bundled_setup_for_local_checkout,
    select_setup_bundle_version_for_local_checkout,
    setup_bundle_activation_state_for_local_checkout,
    setup_bundle_version_inventory_for_local_checkout, ActivationPayload, ActivationStatePayload,
    VersionInventoryPayload, VersionSelectionPayload,
};
use update_install::{
    install_setup_bundle_update_for_tag, local_installations_root,
    open_installed_setup_bundle_update_for_tag, setup_bundle_update_state_for_tag,
    UpdateInstallPayload, UpdateInstallStatePayload, UpdateOpenPayload,
};
use update_staging::{
    ensure_setup_bundle_update_target_eligible, local_update_cache_root,
    stage_setup_bundle_update_for_tag, ReqwestUpdateDownloadSource, UpdateStagePayload,
};

mod update_activation;
mod update_install;
mod update_staging;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const DOCTOR_RELATIVE_PATH: &[&str] = &["scripts", "Test-MobileEditionSetup.ps1"];
const LIBRARY_RELATIVE_PATH: &[&str] = &["scripts", "Set-MobileEditionLibrary.ps1"];
const SERVER_ACTION_RELATIVE_PATH: &[&str] = &["scripts", "Invoke-MobileEditionServerAction.ps1"];
const DEVICE_ACTION_RELATIVE_PATH: &[&str] = &["scripts", "Invoke-MobileEditionDeviceAction.ps1"];
const EDITION_IDENTITY_RELATIVE_PATH: &[&str] = &["MOBILE-EDITION-IDENTITY.json"];
const SETUP_BUNDLE_MANIFEST_RELATIVE_PATH: &[&str] = &["SETUP-BUNDLE-MANIFEST.json"];
const EDITION_IDENTITY_SCHEMA: &str = "feedback-mobile-edition.identity.v1";
const SETUP_BUNDLE_SCHEMA: &str = "feedback-mobile-edition.setup-bundle.v1";
const DEVELOPMENT_CHECKOUT_KIND: &str = "development";
const LATEST_STABLE_RELEASE_API_URL: &str =
    "https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest";
const EDITION_RELEASE_PAGE_BASE_URL: &str =
    "https://github.com/saleemk/feedBack-mobile-edition/releases/tag/";
const DOCKER_INSTALL_URL: &str = "https://docs.docker.com/desktop/setup/install/windows-install/";
const TAILSCALE_INSTALL_URL: &str = "https://tailscale.com/docs/install/windows";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiError {
    code: String,
    message: String,
}

impl UiError {
    pub(crate) fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone)]
struct CompanionState {
    checkout: Result<PathBuf, UiError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateIdentityPayload {
    pub status: String,
    pub source: String,
    pub local_version: Option<String>,
    pub local_tag: Option<String>,
    pub latest_stable_release_api_url: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditionIdentityFile {
    schema: String,
    edition_version: String,
    release_tag: String,
    checkout_kind: String,
    latest_stable_release_api_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetupBundleManifestFile {
    schema: String,
    edition_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatusPayload {
    pub report: SetupReport,
    pub rows: Vec<SetupCheckRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupReport {
    pub schema: String,
    pub generated_at: String,
    pub overall: OverallStatus,
    pub checks: SetupChecks,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverallStatus {
    pub status: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupChecks {
    pub repository: SetupCheck,
    pub docker: SetupCheck,
    pub server: SetupCheck,
    pub tailscale: SetupCheck,
    pub private_https: SetupCheck,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupCheck {
    pub status: String,
    pub reason: String,
    #[serde(default)]
    pub next_action: Option<String>,
    #[serde(default)]
    pub remediation: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupCheckRow {
    pub key: String,
    pub label: String,
    pub status: String,
    pub reason: String,
    #[serde(default)]
    pub next_action: Option<String>,
    #[serde(default)]
    pub remediation: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryResult {
    pub status: String,
    pub valid: bool,
    pub changed: bool,
    pub reason: String,
    pub path: String,
    pub port: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerAction {
    Start,
    Restart,
}

impl ServerAction {
    fn script_value(self) -> &'static str {
        match self {
            Self::Start => "Start",
            Self::Restart => "Restart",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerActionPayload {
    pub action: String,
    pub status: String,
    pub changed: bool,
    pub reason: String,
    pub status_payload: SetupStatusPayload,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerActionScriptResult {
    action: String,
    status: String,
    changed: bool,
    reason: String,
    report: SetupReport,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceAction {
    EnableHttps,
    OpenGuide,
}

impl DeviceAction {
    fn script_value(self) -> &'static str {
        match self {
            Self::EnableHttps => "EnableHttps",
            Self::OpenGuide => "OpenGuide",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrerequisiteAction {
    GetDocker,
    OpenDocker,
    GetTailscale,
    TailscaleHelp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrerequisiteActionPayload {
    pub action: PrerequisiteAction,
    pub status: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReviewPayload {
    pub status: String,
    pub tag: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceActionPayload {
    pub action: String,
    pub status: String,
    pub changed: bool,
    pub reason: String,
    pub status_payload: SetupStatusPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceActionScriptResult {
    action: String,
    status: String,
    changed: bool,
    reason: String,
    report: SetupReport,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DoctorCommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub working_directory: PathBuf,
}

#[tauri::command]
fn get_setup_status(
    state: tauri::State<'_, CompanionState>,
) -> Result<SetupStatusPayload, UiError> {
    let checkout = state.checkout.clone()?;
    get_setup_status_for_checkout(&checkout)
}

#[tauri::command]
fn get_library_state(state: tauri::State<'_, CompanionState>) -> Result<LibraryResult, UiError> {
    let checkout = state.checkout.clone()?;
    run_library_action(&checkout, "Inspect", None)
}

#[tauri::command]
fn get_update_identity(state: tauri::State<'_, CompanionState>) -> UpdateIdentityPayload {
    match state.checkout.clone() {
        Ok(checkout) => update_identity_for_checkout(&checkout),
        Err(error) => unavailable_update_identity(error.message),
    }
}

#[tauri::command]
fn choose_library_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Choose your fee[dB]ack song library")
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn validate_library_folder(
    state: tauri::State<'_, CompanionState>,
    path: String,
) -> Result<LibraryResult, UiError> {
    let checkout = state.checkout.clone()?;
    run_library_action(&checkout, "Validate", Some(&path))
}

#[tauri::command]
fn configure_library(
    state: tauri::State<'_, CompanionState>,
    path: String,
) -> Result<LibraryResult, UiError> {
    let checkout = state.checkout.clone()?;
    run_library_action(&checkout, "Apply", Some(&path))
}

#[tauri::command]
async fn run_server_action(
    state: tauri::State<'_, CompanionState>,
    action: ServerAction,
) -> Result<ServerActionPayload, UiError> {
    let checkout = state.checkout.clone()?;
    tauri::async_runtime::spawn_blocking(move || run_server_action_for_checkout(&checkout, action))
        .await
        .map_err(|_| UiError::new("server_action_failed", "Server action was interrupted."))?
}

#[tauri::command]
async fn run_device_action(
    state: tauri::State<'_, CompanionState>,
    action: DeviceAction,
) -> Result<DeviceActionPayload, UiError> {
    let checkout = state.checkout.clone()?;
    tauri::async_runtime::spawn_blocking(move || run_device_action_for_checkout(&checkout, action))
        .await
        .map_err(|_| UiError::new("device_action_failed", "Device action was interrupted."))?
}

#[tauri::command]
async fn run_prerequisite_action(
    action: PrerequisiteAction,
) -> Result<PrerequisiteActionPayload, UiError> {
    tauri::async_runtime::spawn_blocking(move || run_prerequisite_action_for(action))
        .await
        .map_err(|_| {
            UiError::new(
                "prerequisite_action_failed",
                "Prerequisite action was interrupted.",
            )
        })?
}

#[tauri::command]
async fn review_available_update(tag: String) -> Result<UpdateReviewPayload, UiError> {
    tauri::async_runtime::spawn_blocking(move || review_available_update_for_tag(&tag))
        .await
        .map_err(|_| UiError::new("update_review_failed", "Update review was interrupted."))?
}

#[tauri::command]
async fn stage_setup_bundle_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, CompanionState>,
    tag: String,
) -> Result<UpdateStagePayload, UiError> {
    let checkout = state.checkout.clone()?;
    ensure_setup_bundle_update_target_eligible(&checkout, &tag)?;
    let cache_root = local_update_cache_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut transport = ReqwestUpdateDownloadSource::new()?;
        stage_setup_bundle_update_for_tag(&tag, &cache_root, &mut transport, |progress| {
            let _ = app.emit("setup-bundle-update-progress", progress);
        })
    })
    .await
    .map_err(|_| UiError::new("update_stage_failed", "Update staging was interrupted."))?
}

#[tauri::command]
async fn get_setup_bundle_update_state(
    state: tauri::State<'_, CompanionState>,
    tag: String,
) -> Result<UpdateInstallStatePayload, UiError> {
    let checkout = state.checkout.clone()?;
    tauri::async_runtime::spawn_blocking(move || {
        let cache_root = local_update_cache_root()?;
        let installations_root = local_installations_root()?;
        setup_bundle_update_state_for_tag(&checkout, &tag, &cache_root, &installations_root)
    })
    .await
    .map_err(|_| UiError::new("update_state_failed", "Update state check was interrupted."))?
}

#[tauri::command]
async fn install_setup_bundle_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, CompanionState>,
    tag: String,
) -> Result<UpdateInstallPayload, UiError> {
    let checkout = state.checkout.clone()?;
    tauri::async_runtime::spawn_blocking(move || {
        let cache_root = local_update_cache_root()?;
        let installations_root = local_installations_root()?;
        install_setup_bundle_update_for_tag(
            &checkout,
            &tag,
            &cache_root,
            &installations_root,
            |progress| {
                let _ = app.emit("setup-bundle-install-progress", progress);
            },
        )
    })
    .await
    .map_err(|_| {
        UiError::new(
            "update_install_failed",
            "Update installation was interrupted.",
        )
    })?
}

#[tauri::command]
async fn open_installed_setup_bundle_update(
    state: tauri::State<'_, CompanionState>,
    tag: String,
) -> Result<UpdateOpenPayload, UiError> {
    let checkout = state.checkout.clone()?;
    tauri::async_runtime::spawn_blocking(move || {
        let installations_root = local_installations_root()?;
        open_installed_setup_bundle_update_for_tag(&checkout, &tag, &installations_root)
    })
    .await
    .map_err(|_| {
        UiError::new(
            "update_launch_failed",
            "Opening the update was interrupted.",
        )
    })?
}

#[tauri::command]
async fn get_setup_bundle_activation_state(
    state: tauri::State<'_, CompanionState>,
) -> Result<ActivationStatePayload, UiError> {
    let checkout = state.checkout.clone()?;
    tauri::async_runtime::spawn_blocking(move || {
        setup_bundle_activation_state_for_local_checkout(&checkout)
    })
    .await
    .map_err(|_| {
        UiError::new(
            "activation_failed",
            "Activation state check was interrupted.",
        )
    })?
}

#[tauri::command]
async fn activate_setup_bundle_current(
    state: tauri::State<'_, CompanionState>,
) -> Result<ActivationPayload, UiError> {
    let checkout = state.checkout.clone()?;
    tauri::async_runtime::spawn_blocking(move || {
        activate_setup_bundle_for_local_checkout(&checkout)
    })
    .await
    .map_err(|_| UiError::new("activation_failed", "Activation was interrupted."))?
}

#[tauri::command]
async fn get_setup_bundle_version_inventory(
    state: tauri::State<'_, CompanionState>,
) -> Result<VersionInventoryPayload, UiError> {
    let checkout = state.checkout.clone()?;
    tauri::async_runtime::spawn_blocking(move || {
        setup_bundle_version_inventory_for_local_checkout(&checkout)
    })
    .await
    .map_err(|_| {
        UiError::new(
            "version_inventory_failed",
            "Version inventory check was interrupted.",
        )
    })?
}

#[tauri::command]
async fn select_setup_bundle_version_current(
    state: tauri::State<'_, CompanionState>,
    tag: String,
) -> Result<VersionSelectionPayload, UiError> {
    let checkout = state.checkout.clone()?;
    tauri::async_runtime::spawn_blocking(move || {
        select_setup_bundle_version_for_local_checkout(&checkout, &tag)
    })
    .await
    .map_err(|_| {
        UiError::new(
            "version_select_failed",
            "Version selection was interrupted.",
        )
    })?
}

#[tauri::command]
async fn restore_bundled_setup_current(
    state: tauri::State<'_, CompanionState>,
) -> Result<VersionSelectionPayload, UiError> {
    let checkout = state.checkout.clone()?;
    tauri::async_runtime::spawn_blocking(move || {
        restore_bundled_setup_for_local_checkout(&checkout)
    })
    .await
    .map_err(|_| {
        UiError::new(
            "version_restore_failed",
            "Bundled setup restore was interrupted.",
        )
    })?
}

pub fn run() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let current_dir = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let checkout = resolve_checkout_from_args(&args, &current_dir);

    tauri::Builder::default()
        .manage(CompanionState { checkout })
        .invoke_handler(tauri::generate_handler![
            get_setup_status,
            get_library_state,
            get_update_identity,
            choose_library_folder,
            validate_library_folder,
            configure_library,
            run_server_action,
            run_device_action,
            run_prerequisite_action,
            review_available_update,
            stage_setup_bundle_update,
            get_setup_bundle_update_state,
            install_setup_bundle_update,
            open_installed_setup_bundle_update,
            get_setup_bundle_activation_state,
            activate_setup_bundle_current,
            get_setup_bundle_version_inventory,
            select_setup_bundle_version_current,
            restore_bundled_setup_current
        ])
        .run(tauri::generate_context!())
        .expect("error while running setup companion");
}

pub fn resolve_checkout_from_args(args: &[String], current_dir: &Path) -> Result<PathBuf, UiError> {
    if let Some(explicit) = parse_checkout_arg(args)? {
        return validate_checkout_root(resolve_path(current_dir, &explicit));
    }

    for candidate in default_checkout_candidates(current_dir) {
        if let Ok(root) = validate_checkout_root(candidate) {
            return Ok(root);
        }
    }

    Err(UiError::new(
        "invalid_checkout",
        "Could not locate a Mobile Edition checkout containing scripts/Test-MobileEditionSetup.ps1.",
    ))
}

fn parse_checkout_arg(args: &[String]) -> Result<Option<PathBuf>, UiError> {
    let mut checkout = None;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--checkout" {
            index += 1;
            let Some(value) = args.get(index) else {
                return Err(UiError::new(
                    "invalid_args",
                    "--checkout requires a path value.",
                ));
            };
            if checkout.is_some() {
                return Err(UiError::new(
                    "invalid_args",
                    "--checkout may only be supplied once.",
                ));
            }
            checkout = Some(PathBuf::from(value));
        } else if let Some(value) = arg.strip_prefix("--checkout=") {
            if value.is_empty() || checkout.is_some() {
                return Err(UiError::new(
                    "invalid_args",
                    "--checkout requires one non-empty path value.",
                ));
            }
            checkout = Some(PathBuf::from(value));
        }
        index += 1;
    }
    Ok(checkout)
}

fn resolve_path(current_dir: &Path, path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        current_dir.join(path)
    }
}

fn default_checkout_candidates(current_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    candidates.push(current_dir.to_path_buf());
    if current_dir.file_name().and_then(|name| name.to_str()) == Some("setup-companion") {
        if let Some(parent) = current_dir.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    #[cfg(debug_assertions)]
    {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        if let Some(setup_companion) = manifest_dir.parent() {
            if let Some(repository_root) = setup_companion.parent() {
                candidates.push(repository_root.to_path_buf());
            }
        }
    }
    candidates
}

pub fn validate_checkout_root(root: PathBuf) -> Result<PathBuf, UiError> {
    let canonical = root
        .canonicalize()
        .map(normalize_canonical_path)
        .map_err(|_| {
            UiError::new(
                "invalid_checkout",
                "The selected Mobile Edition checkout path does not exist.",
            )
        })?;
    if doctor_script_path(&canonical).is_file() {
        Ok(canonical)
    } else {
        Err(UiError::new(
            "invalid_checkout",
            "The selected checkout does not contain scripts/Test-MobileEditionSetup.ps1.",
        ))
    }
}

fn normalize_canonical_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let path_text = path.to_string_lossy();
        if let Some(unc_path) = path_text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{unc_path}"));
        }
        if let Some(drive_path) = path_text.strip_prefix(r"\\?\") {
            return PathBuf::from(drive_path);
        }
    }

    path
}

fn doctor_script_path(root: &Path) -> PathBuf {
    DOCTOR_RELATIVE_PATH
        .iter()
        .fold(root.to_path_buf(), |path, part| path.join(part))
}

fn library_script_path(root: &Path) -> PathBuf {
    LIBRARY_RELATIVE_PATH
        .iter()
        .fold(root.to_path_buf(), |path, part| path.join(part))
}

fn server_action_script_path(root: &Path) -> PathBuf {
    SERVER_ACTION_RELATIVE_PATH
        .iter()
        .fold(root.to_path_buf(), |path, part| path.join(part))
}

fn device_action_script_path(root: &Path) -> PathBuf {
    DEVICE_ACTION_RELATIVE_PATH
        .iter()
        .fold(root.to_path_buf(), |path, part| path.join(part))
}

fn edition_identity_path(root: &Path) -> PathBuf {
    EDITION_IDENTITY_RELATIVE_PATH
        .iter()
        .fold(root.to_path_buf(), |path, part| path.join(part))
}

fn setup_bundle_manifest_path(root: &Path) -> PathBuf {
    SETUP_BUNDLE_MANIFEST_RELATIVE_PATH
        .iter()
        .fold(root.to_path_buf(), |path, part| path.join(part))
}

pub fn update_identity_for_checkout(root: &Path) -> UpdateIdentityPayload {
    let bundle_manifest = setup_bundle_manifest_path(root);
    if bundle_manifest.is_file() {
        return update_identity_from_bundle_manifest(&bundle_manifest);
    }

    update_identity_from_edition_identity_file(&edition_identity_path(root))
}

fn update_identity_from_bundle_manifest(path: &Path) -> UpdateIdentityPayload {
    match fs::read_to_string(path)
        .map_err(|_| "Setup bundle manifest could not be read.".to_string())
        .and_then(|content| {
            serde_json::from_str::<SetupBundleManifestFile>(&content)
                .map_err(|_| "Setup bundle manifest is not valid.".to_string())
        })
        .and_then(validate_setup_bundle_manifest)
    {
        Ok((version, tag)) => ready_update_identity(
            "setup_bundle",
            version,
            tag,
            "Installed setup bundle identity resolved.",
        ),
        Err(reason) => unavailable_update_identity(reason),
    }
}

fn update_identity_from_edition_identity_file(path: &Path) -> UpdateIdentityPayload {
    match fs::read_to_string(path)
        .map_err(|_| "Edition identity metadata could not be read.".to_string())
        .and_then(|content| {
            serde_json::from_str::<EditionIdentityFile>(&content)
                .map_err(|_| "Edition identity metadata is not valid.".to_string())
        })
        .and_then(validate_edition_identity_file)
    {
        Ok((version, tag)) => ready_update_identity(
            "development_checkout",
            version,
            tag,
            "Development checkout identity resolved.",
        ),
        Err(reason) => unavailable_update_identity(reason),
    }
}

fn validate_setup_bundle_manifest(
    manifest: SetupBundleManifestFile,
) -> Result<(String, String), String> {
    if manifest.schema != SETUP_BUNDLE_SCHEMA {
        return Err("Setup bundle manifest has an unsupported schema.".to_string());
    }
    let (version, tag) = normalize_local_release_version(&manifest.edition_version)
        .ok_or_else(|| "Setup bundle manifest has an unsupported Edition version.".to_string())?;
    Ok((version, tag))
}

fn validate_edition_identity_file(
    manifest: EditionIdentityFile,
) -> Result<(String, String), String> {
    if manifest.schema != EDITION_IDENTITY_SCHEMA {
        return Err("Edition identity metadata has an unsupported schema.".to_string());
    }
    if manifest.checkout_kind != DEVELOPMENT_CHECKOUT_KIND {
        return Err("Edition identity metadata has an unsupported checkout kind.".to_string());
    }
    if manifest.latest_stable_release_api_url != LATEST_STABLE_RELEASE_API_URL {
        return Err("Edition identity metadata has an unsupported release endpoint.".to_string());
    }
    let (version, tag) =
        normalize_local_release_version(&manifest.edition_version).ok_or_else(|| {
            "Edition identity metadata has an unsupported Edition version.".to_string()
        })?;
    if manifest.release_tag != tag {
        return Err(
            "Edition identity metadata release tag does not match the Edition version.".to_string(),
        );
    }
    Ok((version, tag))
}

fn normalize_local_release_version(value: &str) -> Option<(String, String)> {
    let trimmed = value.trim();
    let version = trimmed.strip_prefix('v').unwrap_or(trimmed);
    if !is_strict_semver(version) {
        return None;
    }
    Some((version.to_string(), format!("v{version}")))
}

fn is_strict_semver(value: &str) -> bool {
    let parts = value.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
        })
}

fn ready_update_identity(
    source: &str,
    local_version: String,
    local_tag: String,
    reason: &str,
) -> UpdateIdentityPayload {
    UpdateIdentityPayload {
        status: "ready".to_string(),
        source: source.to_string(),
        local_version: Some(local_version),
        local_tag: Some(local_tag),
        latest_stable_release_api_url: LATEST_STABLE_RELEASE_API_URL.to_string(),
        reason: reason.to_string(),
    }
}

fn unavailable_update_identity(reason: impl Into<String>) -> UpdateIdentityPayload {
    UpdateIdentityPayload {
        status: "unavailable".to_string(),
        source: "unavailable".to_string(),
        local_version: None,
        local_tag: None,
        latest_stable_release_api_url: LATEST_STABLE_RELEASE_API_URL.to_string(),
        reason: reason.into(),
    }
}

pub fn get_setup_status_for_checkout(root: &Path) -> Result<SetupStatusPayload, UiError> {
    let json = run_doctor(root)?;
    setup_status_from_json(&json)
}

pub fn run_server_action_for_checkout(
    root: &Path,
    action: ServerAction,
) -> Result<ServerActionPayload, UiError> {
    if !server_action_script_path(root).is_file() {
        return Err(UiError::new(
            "invalid_checkout",
            "The selected checkout does not contain scripts/Invoke-MobileEditionServerAction.ps1.",
        ));
    }

    let spec = build_server_action_command_spec(root, action);
    let json = run_powershell_command(
        &spec,
        "server_action_launch_failed",
        "Could not launch server action",
        "server_action_failed",
        "Server action",
        "server_action_invalid_json",
        "Server action returned invalid output.",
    )?;
    server_action_from_json(&json)
}

pub fn run_device_action_for_checkout(
    root: &Path,
    action: DeviceAction,
) -> Result<DeviceActionPayload, UiError> {
    if !device_action_script_path(root).is_file() {
        return Err(UiError::new(
            "invalid_checkout",
            "The selected checkout does not contain scripts/Invoke-MobileEditionDeviceAction.ps1.",
        ));
    }

    let spec = build_device_action_command_spec(root, action);
    let json = run_powershell_command(
        &spec,
        "device_action_launch_failed",
        "Could not launch device action",
        "device_action_failed",
        "Device action",
        "device_action_invalid_json",
        "Device action returned invalid output.",
    )?;
    device_action_from_json(&json)
}

pub fn run_prerequisite_action_for(
    action: PrerequisiteAction,
) -> Result<PrerequisiteActionPayload, UiError> {
    match action {
        PrerequisiteAction::GetDocker
        | PrerequisiteAction::GetTailscale
        | PrerequisiteAction::TailscaleHelp => {
            let url = prerequisite_action_url(action).ok_or_else(|| {
                UiError::new(
                    "prerequisite_action_unsupported",
                    "This prerequisite action does not have installation guidance.",
                )
            })?;
            open_prerequisite_url_in_default_browser(url)?;
            Ok(PrerequisiteActionPayload {
                action,
                status: "opened".to_string(),
                reason: prerequisite_action_success_reason(action).to_string(),
            })
        }
        PrerequisiteAction::OpenDocker => {
            let path = prerequisite_action_candidate_paths(
                action,
                env::var_os("LOCALAPPDATA").map(PathBuf::from).as_deref(),
                env::var_os("ProgramFiles").map(PathBuf::from).as_deref(),
            )
            .into_iter()
            .find(|candidate| candidate.is_file())
            .ok_or_else(|| {
                UiError::new(
                    "prerequisite_app_not_found",
                    prerequisite_action_missing_app_reason(action),
                )
            })?;
            launch_known_application(&path)?;
            Ok(PrerequisiteActionPayload {
                action,
                status: "opened".to_string(),
                reason: prerequisite_action_success_reason(action).to_string(),
            })
        }
    }
}

pub fn canonical_edition_release_url_for_tag(tag: &str) -> Result<String, UiError> {
    validate_stable_release_tag(tag)
        .map(|validated| format!("{EDITION_RELEASE_PAGE_BASE_URL}{validated}"))
}

pub fn review_available_update_for_tag(tag: &str) -> Result<UpdateReviewPayload, UiError> {
    review_available_update_for_tag_with_opener(tag, open_update_release_url_in_default_browser)
}

pub fn review_available_update_for_tag_with_opener<F>(
    tag: &str,
    opener: F,
) -> Result<UpdateReviewPayload, UiError>
where
    F: FnOnce(&str) -> Result<(), UiError>,
{
    let canonical_url = canonical_edition_release_url_for_tag(tag)?;
    opener(&canonical_url)?;
    Ok(UpdateReviewPayload {
        status: "opened".to_string(),
        tag: tag.to_string(),
        reason: format!("Opened the {tag} Mobile Edition release page."),
    })
}

pub(crate) fn validate_stable_release_tag(tag: &str) -> Result<&str, UiError> {
    let version = tag.strip_prefix('v').ok_or_else(|| {
        UiError::new(
            "update_review_invalid_tag",
            "The latest stable release tag is not supported.",
        )
    })?;
    if !is_strict_semver(version) {
        return Err(UiError::new(
            "update_review_invalid_tag",
            "The latest stable release tag is not supported.",
        ));
    }
    Ok(tag)
}

pub fn prerequisite_action_url(action: PrerequisiteAction) -> Option<&'static str> {
    match action {
        PrerequisiteAction::GetDocker => Some(DOCKER_INSTALL_URL),
        PrerequisiteAction::GetTailscale => Some(TAILSCALE_INSTALL_URL),
        PrerequisiteAction::TailscaleHelp => Some(TAILSCALE_INSTALL_URL),
        PrerequisiteAction::OpenDocker => None,
    }
}

pub fn prerequisite_action_candidate_paths(
    action: PrerequisiteAction,
    local_app_data: Option<&Path>,
    program_files: Option<&Path>,
) -> Vec<PathBuf> {
    match action {
        PrerequisiteAction::OpenDocker => {
            docker_desktop_candidate_paths(local_app_data, program_files)
        }
        PrerequisiteAction::GetDocker
        | PrerequisiteAction::GetTailscale
        | PrerequisiteAction::TailscaleHelp => Vec::new(),
    }
}

pub fn docker_desktop_candidate_paths(
    local_app_data: Option<&Path>,
    program_files: Option<&Path>,
) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(root) = local_app_data {
        paths.push(
            root.join("Programs")
                .join("DockerDesktop")
                .join("Docker Desktop.exe"),
        );
    }
    if let Some(root) = program_files {
        paths.push(
            root.join("Docker")
                .join("Docker")
                .join("Docker Desktop.exe"),
        );
    }
    paths
}

fn prerequisite_action_success_reason(action: PrerequisiteAction) -> &'static str {
    match action {
        PrerequisiteAction::GetDocker => {
            "Opened Docker Desktop installation guidance. Complete that step, then use Refresh checks."
        }
        PrerequisiteAction::OpenDocker => {
            "Opened Docker Desktop. Wait until it finishes starting, then use Refresh checks."
        }
        PrerequisiteAction::GetTailscale => {
            "Opened Tailscale installation guidance. Complete that step, then use Refresh checks."
        }
        PrerequisiteAction::TailscaleHelp => {
            "Opened Tailscale sign-in steps. Use the Tailscale notification-area icon to sign in or reconnect, then use Refresh checks."
        }
    }
}

fn prerequisite_action_missing_app_reason(action: PrerequisiteAction) -> &'static str {
    match action {
        PrerequisiteAction::OpenDocker => {
            "Docker Desktop was not found in the supported Windows install locations."
        }
        PrerequisiteAction::GetDocker
        | PrerequisiteAction::GetTailscale
        | PrerequisiteAction::TailscaleHelp => {
            "This prerequisite action does not launch a local application."
        }
    }
}

fn open_prerequisite_url_in_default_browser(url: &str) -> Result<(), UiError> {
    open_url_in_default_browser(
        url,
        "prerequisite_url_launch_failed",
        "Could not open installation guidance",
        "prerequisite_action_unsupported",
        "Opening prerequisite guidance is supported only by the Windows setup companion.",
    )
}

fn open_update_release_url_in_default_browser(url: &str) -> Result<(), UiError> {
    open_url_in_default_browser(
        url,
        "update_review_launch_failed",
        "Could not open the release page",
        "update_review_unsupported",
        "Opening the release page is supported only by the Windows setup companion.",
    )
}

fn open_url_in_default_browser(
    url: &str,
    launch_code: &str,
    launch_message: &str,
    _unsupported_code: &str,
    _unsupported_message: &str,
) -> Result<(), UiError> {
    #[cfg(windows)]
    {
        let mut command = Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler").arg(url);
        spawn_no_window(command, launch_code, launch_message)
    }

    #[cfg(not(windows))]
    {
        let _ = url;
        let _ = launch_code;
        let _ = launch_message;
        Err(UiError::new(_unsupported_code, _unsupported_message))
    }
}

fn launch_known_application(path: &Path) -> Result<(), UiError> {
    let command = Command::new(path);
    spawn_no_window(
        command,
        "prerequisite_app_launch_failed",
        "Could not open prerequisite application",
    )
}

fn spawn_no_window(
    mut command: Command,
    launch_code: &str,
    launch_message: &str,
) -> Result<(), UiError> {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| UiError::new(launch_code, format!("{launch_message}: {error}")))
}

fn run_doctor(root: &Path) -> Result<String, UiError> {
    let spec = build_doctor_command_spec(root);
    run_powershell_command(
        &spec,
        "doctor_launch_failed",
        "Could not launch the setup doctor",
        "doctor_failed",
        "The setup doctor",
        "doctor_invalid_json",
        "The setup doctor returned invalid output.",
    )
}

fn run_powershell_command(
    spec: &DoctorCommandSpec,
    launch_code: &str,
    launch_message: &str,
    failure_code: &str,
    failure_subject: &str,
    invalid_output_code: &str,
    invalid_output_message: &str,
) -> Result<String, UiError> {
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .current_dir(&spec.working_directory);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|error| UiError::new(launch_code, format!("{launch_message}: {error}")))?;

    if !output.status.success() {
        let code = output
            .status
            .code()
            .map_or_else(|| "unknown".to_string(), |code| code.to_string());
        return Err(UiError::new(
            failure_code,
            format!("{failure_subject} exited with code {code}."),
        ));
    }

    String::from_utf8(output.stdout)
        .map_err(|_| UiError::new(invalid_output_code, invalid_output_message))
}

fn run_library_action(
    root: &Path,
    mode: &str,
    path: Option<&str>,
) -> Result<LibraryResult, UiError> {
    let spec = build_library_command_spec(root, mode, path);
    let json = run_powershell_command(
        &spec,
        "library_launch_failed",
        "Could not launch library configuration",
        "library_action_failed",
        "Library configuration",
        "library_invalid_json",
        "Library configuration returned invalid output.",
    )?;
    serde_json::from_str::<LibraryResult>(&json).map_err(|_| {
        UiError::new(
            "library_invalid_json",
            "Library configuration returned invalid JSON.",
        )
    })
}

pub fn build_doctor_command_spec(root: &Path) -> DoctorCommandSpec {
    DoctorCommandSpec {
        program: "powershell.exe".to_string(),
        args: vec![
            "-NoProfile".to_string(),
            "-ExecutionPolicy".to_string(),
            "Bypass".to_string(),
            "-File".to_string(),
            doctor_script_path(root).to_string_lossy().to_string(),
            "-Json".to_string(),
        ],
        working_directory: root.to_path_buf(),
    }
}

pub fn build_library_command_spec(
    root: &Path,
    mode: &str,
    path: Option<&str>,
) -> DoctorCommandSpec {
    let mut args = vec![
        "-NoProfile".to_string(),
        "-ExecutionPolicy".to_string(),
        "Bypass".to_string(),
        "-File".to_string(),
        library_script_path(root).to_string_lossy().to_string(),
        "-Mode".to_string(),
        mode.to_string(),
        "-RepositoryRoot".to_string(),
        root.to_string_lossy().to_string(),
        "-Json".to_string(),
    ];
    if let Some(path) = path {
        args.push("-LibraryPath".to_string());
        args.push(path.to_string());
    }

    DoctorCommandSpec {
        program: "powershell.exe".to_string(),
        args,
        working_directory: root.to_path_buf(),
    }
}

pub fn build_server_action_command_spec(root: &Path, action: ServerAction) -> DoctorCommandSpec {
    DoctorCommandSpec {
        program: "powershell.exe".to_string(),
        args: vec![
            "-NoProfile".to_string(),
            "-ExecutionPolicy".to_string(),
            "Bypass".to_string(),
            "-File".to_string(),
            server_action_script_path(root)
                .to_string_lossy()
                .to_string(),
            "-Action".to_string(),
            action.script_value().to_string(),
            "-RepositoryRoot".to_string(),
            root.to_string_lossy().to_string(),
            "-Json".to_string(),
        ],
        working_directory: root.to_path_buf(),
    }
}

pub fn build_device_action_command_spec(root: &Path, action: DeviceAction) -> DoctorCommandSpec {
    DoctorCommandSpec {
        program: "powershell.exe".to_string(),
        args: vec![
            "-NoProfile".to_string(),
            "-ExecutionPolicy".to_string(),
            "Bypass".to_string(),
            "-File".to_string(),
            device_action_script_path(root)
                .to_string_lossy()
                .to_string(),
            "-Action".to_string(),
            action.script_value().to_string(),
            "-RepositoryRoot".to_string(),
            root.to_string_lossy().to_string(),
            "-Json".to_string(),
        ],
        working_directory: root.to_path_buf(),
    }
}

pub fn setup_status_from_json(json: &str) -> Result<SetupStatusPayload, UiError> {
    let report = serde_json::from_str::<SetupReport>(json).map_err(|_| {
        UiError::new(
            "doctor_invalid_json",
            "The setup doctor returned invalid JSON.",
        )
    })?;
    let rows = ordered_check_rows(&report);
    Ok(SetupStatusPayload { report, rows })
}

pub fn server_action_from_json(json: &str) -> Result<ServerActionPayload, UiError> {
    let result = serde_json::from_str::<ServerActionScriptResult>(json).map_err(|_| {
        UiError::new(
            "server_action_invalid_json",
            "Server action returned invalid JSON.",
        )
    })?;
    let rows = ordered_check_rows(&result.report);
    Ok(ServerActionPayload {
        action: result.action,
        status: result.status,
        changed: result.changed,
        reason: result.reason,
        status_payload: SetupStatusPayload {
            report: result.report,
            rows,
        },
    })
}

pub fn device_action_from_json(json: &str) -> Result<DeviceActionPayload, UiError> {
    let result = serde_json::from_str::<DeviceActionScriptResult>(json).map_err(|_| {
        UiError::new(
            "device_action_invalid_json",
            "Device action returned invalid JSON.",
        )
    })?;
    let rows = ordered_check_rows(&result.report);
    Ok(DeviceActionPayload {
        action: result.action,
        status: result.status,
        changed: result.changed,
        reason: result.reason,
        status_payload: SetupStatusPayload {
            report: result.report,
            rows,
        },
        url: result.url,
        path: result.path,
    })
}

pub fn ordered_check_rows(report: &SetupReport) -> Vec<SetupCheckRow> {
    vec![
        row(
            "repository",
            "Repository configuration",
            &report.checks.repository,
        ),
        row("docker", "Docker and Compose", &report.checks.docker),
        row("server", "Edition server", &report.checks.server),
        row("tailscale", "Tailscale", &report.checks.tailscale),
        row(
            "privateHttps",
            "Private HTTPS access",
            &report.checks.private_https,
        ),
    ]
}

fn row(key: &str, label: &str, check: &SetupCheck) -> SetupCheckRow {
    SetupCheckRow {
        key: key.to_string(),
        label: label.to_string(),
        status: check.status.clone(),
        reason: check.reason.clone(),
        next_action: check.next_action.clone(),
        remediation: check.remediation.clone(),
        url: check.url.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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

    #[test]
    fn resolves_explicit_checkout_and_validates_doctor_script() {
        let root = temp_root("explicit");
        fs::write(root.join("scripts").join("Test-MobileEditionSetup.ps1"), "")
            .expect("write doctor");
        let current = env::temp_dir();
        let args = vec!["--checkout".to_string(), root.to_string_lossy().to_string()];

        let resolved = resolve_checkout_from_args(&args, &current).expect("resolve checkout");
        assert_eq!(
            resolved,
            normalize_canonical_path(root.canonicalize().expect("canonical temp root"))
        );

        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn rejects_invalid_checkout_without_doctor_script() {
        let root = temp_root("invalid");
        let args = vec![format!("--checkout={}", root.to_string_lossy())];
        let error = resolve_checkout_from_args(&args, &env::temp_dir()).expect_err("reject root");

        assert_eq!(error.code, "invalid_checkout");
        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn rejects_missing_checkout_argument_value() {
        let error = resolve_checkout_from_args(&["--checkout".to_string()], &env::temp_dir())
            .expect_err("reject missing value");

        assert_eq!(error.code, "invalid_args");
    }

    #[test]
    fn resolves_development_checkout_update_identity_from_tracked_metadata() {
        let root = temp_root("identity");
        write_valid_identity(&root, "0.3.0", "v0.3.0");

        let payload = update_identity_for_checkout(&root);

        assert_eq!(payload.status, "ready");
        assert_eq!(payload.source, "development_checkout");
        assert_eq!(payload.local_version.as_deref(), Some("0.3.0"));
        assert_eq!(payload.local_tag.as_deref(), Some("v0.3.0"));
        assert_eq!(
            payload.latest_stable_release_api_url,
            "https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest"
        );
        assert!(payload.reason.contains("Development checkout"));
        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn setup_bundle_manifest_takes_precedence_for_installed_identity() {
        let root = temp_root("bundle-identity");
        write_valid_identity(&root, "0.3.0", "v0.3.0");
        fs::write(
            root.join("SETUP-BUNDLE-MANIFEST.json"),
            r#"{
              "schema": "feedback-mobile-edition.setup-bundle.v1",
              "bundleFormat": "zip",
              "editionVersion": "v1.2.3",
              "editionCommit": "abc123",
              "companionPath": "Setup-MobileEdition.exe",
              "companionSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "generatedAtUtc": "2026-09-09T00:00:00Z"
            }"#,
        )
        .expect("write bundle manifest");

        let payload = update_identity_for_checkout(&root);

        assert_eq!(payload.status, "ready");
        assert_eq!(payload.source, "setup_bundle");
        assert_eq!(payload.local_version.as_deref(), Some("1.2.3"));
        assert_eq!(payload.local_tag.as_deref(), Some("v1.2.3"));
        fs::remove_dir_all(root).expect("remove temp root");
    }

    #[test]
    fn real_edition_identity_file_matches_update_contract() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let root = manifest_dir
            .parent()
            .and_then(|setup_companion| setup_companion.parent())
            .expect("repository root");

        let payload = update_identity_for_checkout(root);

        assert_eq!(payload.status, "ready");
        assert_eq!(payload.source, "development_checkout");
        assert_eq!(payload.local_version.as_deref(), Some("0.3.0"));
        assert_eq!(payload.local_tag.as_deref(), Some("v0.3.0"));
        assert_eq!(
            payload.latest_stable_release_api_url,
            "https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest"
        );
    }

    #[test]
    fn malformed_update_identity_metadata_returns_unavailable_payload() {
        let cases = [
            (
                "missing",
                None,
                "Edition identity metadata could not be read.",
            ),
            (
                "malformed",
                Some("{ not json"),
                "Edition identity metadata is not valid.",
            ),
            (
                "bad-schema",
                Some(
                    r#"{"schema":"feedback-mobile-edition.identity.v2","editionVersion":"0.3.0","releaseTag":"v0.3.0","checkoutKind":"development","latestStableReleaseApiUrl":"https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest"}"#,
                ),
                "unsupported schema",
            ),
            (
                "bad-kind",
                Some(
                    r#"{"schema":"feedback-mobile-edition.identity.v1","editionVersion":"0.3.0","releaseTag":"v0.3.0","checkoutKind":"release","latestStableReleaseApiUrl":"https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest"}"#,
                ),
                "unsupported checkout kind",
            ),
            (
                "bad-endpoint",
                Some(
                    r#"{"schema":"feedback-mobile-edition.identity.v1","editionVersion":"0.3.0","releaseTag":"v0.3.0","checkoutKind":"development","latestStableReleaseApiUrl":"https://example.com/latest"}"#,
                ),
                "unsupported release endpoint",
            ),
            (
                "bad-version",
                Some(
                    r#"{"schema":"feedback-mobile-edition.identity.v1","editionVersion":"0.3","releaseTag":"v0.3","checkoutKind":"development","latestStableReleaseApiUrl":"https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest"}"#,
                ),
                "unsupported Edition version",
            ),
            (
                "tag-mismatch",
                Some(
                    r#"{"schema":"feedback-mobile-edition.identity.v1","editionVersion":"0.3.0","releaseTag":"v0.4.0","checkoutKind":"development","latestStableReleaseApiUrl":"https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest"}"#,
                ),
                "release tag does not match",
            ),
            (
                "extra-field",
                Some(
                    r#"{"schema":"feedback-mobile-edition.identity.v1","editionVersion":"0.3.0","releaseTag":"v0.3.0","checkoutKind":"development","latestStableReleaseApiUrl":"https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest","extra":"nope"}"#,
                ),
                "Edition identity metadata is not valid.",
            ),
        ];

        for (name, content, expected_reason) in cases {
            let root = temp_root(name);
            if let Some(content) = content {
                fs::write(root.join("MOBILE-EDITION-IDENTITY.json"), content)
                    .expect("write bad identity metadata");
            }

            let payload = update_identity_for_checkout(&root);

            assert_eq!(payload.status, "unavailable", "{name}");
            assert_eq!(payload.source, "unavailable", "{name}");
            assert_eq!(payload.local_version, None, "{name}");
            assert!(
                payload.reason.contains(expected_reason),
                "{name}: {}",
                payload.reason
            );
            fs::remove_dir_all(root).expect("remove temp root");
        }
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn removes_windows_verbatim_prefix_before_invoking_powershell() {
        assert_eq!(
            normalize_canonical_path(PathBuf::from(r"\\?\D:\Mobile Edition")),
            PathBuf::from(r"D:\Mobile Edition")
        );
        assert_eq!(
            normalize_canonical_path(PathBuf::from(r"\\?\UNC\server\share\edition")),
            PathBuf::from(r"\\server\share\edition")
        );
    }

    #[test]
    fn builds_narrow_windows_doctor_command() {
        let root = PathBuf::from(r"C:\MobileEdition");
        let spec = build_doctor_command_spec(&root);

        assert_eq!(spec.program, "powershell.exe");
        assert_eq!(
            spec.args,
            vec![
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                r"C:\MobileEdition\scripts\Test-MobileEditionSetup.ps1",
                "-Json"
            ]
        );
        assert_eq!(spec.working_directory, root);
    }

    #[test]
    fn builds_library_command_with_path_as_one_argument() {
        let root = PathBuf::from(r"C:\Mobile Edition");
        let library = r"D:\Music Library\My Songs";
        let spec = build_library_command_spec(&root, "Validate", Some(library));

        assert_eq!(spec.program, "powershell.exe");
        assert_eq!(
            spec.args,
            vec![
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                r"C:\Mobile Edition\scripts\Set-MobileEditionLibrary.ps1",
                "-Mode",
                "Validate",
                "-RepositoryRoot",
                r"C:\Mobile Edition",
                "-Json",
                "-LibraryPath",
                library,
            ]
        );
        assert_eq!(spec.working_directory, root);
    }

    #[test]
    fn deserializes_only_allowed_server_actions() {
        assert_eq!(
            serde_json::from_str::<ServerAction>("\"start\"").expect("start"),
            ServerAction::Start
        );
        assert_eq!(
            serde_json::from_str::<ServerAction>("\"restart\"").expect("restart"),
            ServerAction::Restart
        );
        assert!(serde_json::from_str::<ServerAction>("\"stop\"").is_err());
    }

    #[test]
    fn builds_server_action_command_specs() {
        let root = PathBuf::from(r"C:\Mobile Edition");
        let start = build_server_action_command_spec(&root, ServerAction::Start);
        let restart = build_server_action_command_spec(&root, ServerAction::Restart);

        assert_eq!(start.program, "powershell.exe");
        assert_eq!(
            start.args,
            vec![
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                r"C:\Mobile Edition\scripts\Invoke-MobileEditionServerAction.ps1",
                "-Action",
                "Start",
                "-RepositoryRoot",
                r"C:\Mobile Edition",
                "-Json",
            ]
        );
        assert_eq!(
            restart.args,
            vec![
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                r"C:\Mobile Edition\scripts\Invoke-MobileEditionServerAction.ps1",
                "-Action",
                "Restart",
                "-RepositoryRoot",
                r"C:\Mobile Edition",
                "-Json",
            ]
        );
        assert_eq!(start.working_directory, root);
    }

    #[test]
    fn parses_server_action_result_into_status_payload() {
        let json = r#"{
          "action": "Start",
          "status": "ready",
          "changed": true,
          "reason": "Docker start command completed. Setup doctor refreshed.",
          "report": {
            "schema": "feedback.mobile-edition.setup-doctor.v1",
            "generatedAt": "2026-09-02T08:00:00.0000000Z",
            "overall": {
              "status": "local_ready_mobile_setup_remaining",
              "reason": "Local Mobile Edition is ready; private mobile HTTPS still needs action."
            },
            "checks": {
              "repository": {"status": "ready", "reason": "Repository ready."},
              "docker": {"status": "ready", "reason": "Docker ready."},
              "server": {"status": "ready", "reason": "Server ready."},
              "tailscale": {"status": "unavailable", "reason": "Tailscale unavailable."},
              "privateHttps": {"status": "needs_action", "reason": "HTTPS needs action."}
            }
          }
        }"#;

        let payload = server_action_from_json(json).expect("server action json");

        assert_eq!(payload.action, "Start");
        assert_eq!(payload.status, "ready");
        assert!(payload.changed);
        assert_eq!(payload.status_payload.rows.len(), 5);
        assert_eq!(payload.status_payload.rows[2].key, "server");
        assert_eq!(payload.status_payload.rows[2].status, "ready");
    }

    #[test]
    fn parses_server_action_timeout_result_without_fake_ready() {
        let json = r#"{
          "action": "Restart",
          "status": "needs_action",
          "changed": true,
          "reason": "Docker restart command completed, but the server is not ready yet: The local server is not reachable.",
          "report": {
            "schema": "feedback.mobile-edition.setup-doctor.v1",
            "generatedAt": "2026-09-02T08:00:00.0000000Z",
            "overall": {
              "status": "blocked",
              "reason": "The local Mobile Edition server is not ready yet."
            },
            "checks": {
              "repository": {"status": "ready", "reason": "Repository ready."},
              "docker": {"status": "ready", "reason": "Docker ready."},
              "server": {"status": "needs_action", "reason": "The local server is not reachable."},
              "tailscale": {"status": "unavailable", "reason": "Tailscale unavailable."},
              "privateHttps": {"status": "needs_action", "reason": "HTTPS needs action."}
            }
          }
        }"#;

        let payload = server_action_from_json(json).expect("server action timeout json");

        assert_eq!(payload.action, "Restart");
        assert_eq!(payload.status, "needs_action");
        assert!(payload.changed);
        assert_eq!(payload.status_payload.rows[2].status, "needs_action");
        assert_eq!(
            payload.status_payload.rows[2].reason,
            "The local server is not reachable."
        );
    }

    #[test]
    fn shapes_invalid_server_action_json_as_ui_safe_error() {
        let error = server_action_from_json("not json").expect_err("invalid json");

        assert_eq!(error.code, "server_action_invalid_json");
        assert!(!error.message.contains("not json"));
    }

    #[test]
    fn deserializes_only_allowed_device_actions() {
        assert_eq!(
            serde_json::from_str::<DeviceAction>("\"enable_https\"").expect("enable_https"),
            DeviceAction::EnableHttps
        );
        assert_eq!(
            serde_json::from_str::<DeviceAction>("\"open_guide\"").expect("open_guide"),
            DeviceAction::OpenGuide
        );
        assert!(serde_json::from_str::<DeviceAction>("\"reset_tailscale\"").is_err());
    }

    #[test]
    fn deserializes_only_allowed_prerequisite_actions() {
        assert_eq!(
            serde_json::from_str::<PrerequisiteAction>("\"get_docker\"").expect("get_docker"),
            PrerequisiteAction::GetDocker
        );
        assert_eq!(
            serde_json::from_str::<PrerequisiteAction>("\"open_docker\"").expect("open_docker"),
            PrerequisiteAction::OpenDocker
        );
        assert_eq!(
            serde_json::from_str::<PrerequisiteAction>("\"get_tailscale\"").expect("get_tailscale"),
            PrerequisiteAction::GetTailscale
        );
        assert_eq!(
            serde_json::from_str::<PrerequisiteAction>("\"tailscale_help\"")
                .expect("tailscale_help"),
            PrerequisiteAction::TailscaleHelp
        );
        assert!(serde_json::from_str::<PrerequisiteAction>("\"install_docker\"").is_err());
        assert!(serde_json::from_str::<PrerequisiteAction>("\"open_tailscale\"").is_err());
        assert!(serde_json::from_str::<PrerequisiteAction>(
            "\"C:\\\\Windows\\\\System32\\\\calc.exe\""
        )
        .is_err());
    }

    #[test]
    fn prerequisite_browser_actions_use_only_fixed_official_urls() {
        assert_eq!(
            prerequisite_action_url(PrerequisiteAction::GetDocker),
            Some("https://docs.docker.com/desktop/setup/install/windows-install/")
        );
        assert_eq!(
            prerequisite_action_url(PrerequisiteAction::GetTailscale),
            Some("https://tailscale.com/docs/install/windows")
        );
        assert_eq!(
            prerequisite_action_url(PrerequisiteAction::TailscaleHelp),
            Some("https://tailscale.com/docs/install/windows")
        );
        assert_eq!(
            prerequisite_action_url(PrerequisiteAction::OpenDocker),
            None
        );
    }

    #[test]
    fn update_review_accepts_only_strict_stable_tags() {
        assert_eq!(
            canonical_edition_release_url_for_tag("v1.2.3").expect("valid stable tag"),
            "https://github.com/saleemk/feedBack-mobile-edition/releases/tag/v1.2.3"
        );

        for tag in [
            "1.2.3",
            "v1.2",
            "v1.2.3-rc.1",
            "v1.2.3/../../releases",
            "https://github.com/saleemk/feedBack-mobile-edition/releases/tag/v1.2.3",
            "v1.2.3?download=1",
            " v1.2.3",
        ] {
            let error = canonical_edition_release_url_for_tag(tag).expect_err("reject bad tag");
            assert_eq!(error.code, "update_review_invalid_tag", "{tag}");
            assert!(!error.message.contains(tag), "{tag}");
        }
    }

    #[test]
    fn update_review_constructs_only_canonical_release_url() {
        let mut opened_url = String::new();
        let payload = review_available_update_for_tag_with_opener("v9.8.7", |url| {
            opened_url = url.to_string();
            Ok(())
        })
        .expect("review release");

        assert_eq!(payload.status, "opened");
        assert_eq!(payload.tag, "v9.8.7");
        assert!(payload.reason.contains("v9.8.7"));
        assert_eq!(
            opened_url,
            "https://github.com/saleemk/feedBack-mobile-edition/releases/tag/v9.8.7"
        );
        assert!(!opened_url.contains("api.github.com"));
        assert!(!opened_url.contains("/download/"));
        assert!(!opened_url.contains("/assets/"));
    }

    #[test]
    fn update_review_launcher_failure_returns_bounded_error() {
        let error = review_available_update_for_tag_with_opener("v1.2.3", |_url| {
            Err(UiError::new(
                "update_review_launch_failed",
                "Could not open the release page: simulated browser failure",
            ))
        })
        .expect_err("launcher failure");

        assert_eq!(error.code, "update_review_launch_failed");
        assert!(error.message.contains("Could not open the release page"));
        assert!(!error.message.contains("rundll32"));
    }

    #[test]
    fn prerequisite_app_actions_consider_only_approved_docker_paths() {
        let local_app_data = PathBuf::from(r"C:\Users\person\AppData\Local");
        let program_files = PathBuf::from(r"C:\Program Files");

        assert_eq!(
            prerequisite_action_candidate_paths(
                PrerequisiteAction::OpenDocker,
                Some(&local_app_data),
                Some(&program_files)
            ),
            vec![
                PathBuf::from(
                    r"C:\Users\person\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe"
                ),
                PathBuf::from(r"C:\Program Files\Docker\Docker\Docker Desktop.exe"),
            ]
        );
        assert!(prerequisite_action_candidate_paths(
            PrerequisiteAction::GetDocker,
            Some(&local_app_data),
            Some(&program_files)
        )
        .is_empty());
        assert!(prerequisite_action_candidate_paths(
            PrerequisiteAction::TailscaleHelp,
            Some(&local_app_data),
            Some(&program_files)
        )
        .is_empty());
    }

    #[test]
    fn builds_device_action_command_specs() {
        let root = PathBuf::from(r"C:\Mobile Edition");
        let enable = build_device_action_command_spec(&root, DeviceAction::EnableHttps);
        let guide = build_device_action_command_spec(&root, DeviceAction::OpenGuide);

        assert_eq!(enable.program, "powershell.exe");
        assert_eq!(
            enable.args,
            vec![
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                r"C:\Mobile Edition\scripts\Invoke-MobileEditionDeviceAction.ps1",
                "-Action",
                "EnableHttps",
                "-RepositoryRoot",
                r"C:\Mobile Edition",
                "-Json",
            ]
        );
        assert_eq!(
            guide.args,
            vec![
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                r"C:\Mobile Edition\scripts\Invoke-MobileEditionDeviceAction.ps1",
                "-Action",
                "OpenGuide",
                "-RepositoryRoot",
                r"C:\Mobile Edition",
                "-Json",
            ]
        );
        assert_eq!(enable.working_directory, root);
    }

    #[test]
    fn parses_device_action_result_into_status_payload() {
        let json = r#"{
          "action": "EnableHttps",
          "status": "ready",
          "changed": true,
          "reason": "Private HTTPS is ready. Setup doctor refreshed.",
          "url": "https://desktop.example.ts.net",
          "report": {
            "schema": "feedback.mobile-edition.setup-doctor.v1",
            "generatedAt": "2026-09-02T08:00:00.0000000Z",
            "overall": {
              "status": "ready",
              "reason": "Local and private mobile HTTPS access are ready."
            },
            "checks": {
              "repository": {"status": "ready", "reason": "Repository ready."},
              "docker": {"status": "ready", "reason": "Docker ready."},
              "server": {"status": "ready", "reason": "Server ready."},
              "tailscale": {"status": "ready", "reason": "Tailscale ready."},
              "privateHttps": {"status": "ready", "reason": "HTTPS ready.", "url": "https://desktop.example.ts.net"}
            }
          }
        }"#;

        let payload = device_action_from_json(json).expect("device action json");

        assert_eq!(payload.action, "EnableHttps");
        assert_eq!(payload.status, "ready");
        assert!(payload.changed);
        assert_eq!(
            payload.url.as_deref(),
            Some("https://desktop.example.ts.net")
        );
        assert_eq!(payload.status_payload.rows.len(), 5);
        assert_eq!(payload.status_payload.rows[4].key, "privateHttps");
        assert_eq!(payload.status_payload.rows[4].status, "ready");
    }

    #[test]
    fn parses_device_guide_result_path_and_conflict_result() {
        let guide_json = r#"{
          "action": "OpenGuide",
          "status": "ready",
          "changed": true,
          "reason": "Device guide created and opened.",
          "url": "https://desktop.example.ts.net",
          "path": "C:\\Temp\\feedback-mobile-edition-device-guide.html",
          "report": {
            "schema": "feedback.mobile-edition.setup-doctor.v1",
            "generatedAt": "2026-09-02T08:00:00.0000000Z",
            "overall": {"status": "ready", "reason": "Ready."},
            "checks": {
              "repository": {"status": "ready", "reason": "Repository ready."},
              "docker": {"status": "ready", "reason": "Docker ready."},
              "server": {"status": "ready", "reason": "Server ready."},
              "tailscale": {"status": "ready", "reason": "Tailscale ready."},
              "privateHttps": {"status": "ready", "reason": "HTTPS ready.", "url": "https://desktop.example.ts.net"}
            }
          }
        }"#;
        let conflict_json = r#"{
          "action": "EnableHttps",
          "status": "conflict",
          "changed": false,
          "reason": "Tailscale Serve already has a root HTTPS handler for another target.",
          "url": "https://desktop.example.ts.net",
          "report": {
            "schema": "feedback.mobile-edition.setup-doctor.v1",
            "generatedAt": "2026-09-02T08:00:00.0000000Z",
            "overall": {"status": "local_ready_mobile_setup_remaining", "reason": "Needs HTTPS."},
            "checks": {
              "repository": {"status": "ready", "reason": "Repository ready."},
              "docker": {"status": "ready", "reason": "Docker ready."},
              "server": {"status": "ready", "reason": "Server ready."},
              "tailscale": {"status": "ready", "reason": "Tailscale ready."},
              "privateHttps": {"status": "needs_action", "reason": "HTTPS needs action."}
            }
          }
        }"#;

        let guide = device_action_from_json(guide_json).expect("guide action json");
        let conflict = device_action_from_json(conflict_json).expect("conflict action json");

        assert_eq!(
            guide.path.as_deref(),
            Some(r"C:\Temp\feedback-mobile-edition-device-guide.html")
        );
        assert_eq!(guide.status, "ready");
        assert_eq!(conflict.status, "conflict");
        assert!(!conflict.changed);
    }

    #[test]
    fn shapes_invalid_device_action_json_as_ui_safe_error() {
        let error = device_action_from_json("not json").expect_err("invalid json");

        assert_eq!(error.code, "device_action_invalid_json");
        assert!(!error.message.contains("not json"));
    }

    #[test]
    fn parses_ready_fixture_and_maps_ordered_rows() {
        let payload =
            setup_status_from_json(include_str!("../../tests/fixtures/ready.json")).expect("json");

        assert_eq!(payload.report.overall.status, "ready");
        assert_eq!(
            payload
                .rows
                .iter()
                .map(|row| row.key.as_str())
                .collect::<Vec<_>>(),
            vec![
                "repository",
                "docker",
                "server",
                "tailscale",
                "privateHttps"
            ]
        );
        assert_eq!(
            payload.rows.last().and_then(|row| row.url.as_deref()),
            Some("https://desktop.example.ts.net")
        );
    }

    #[test]
    fn parses_remediation_values_into_ordered_rows() {
        let json = r#"{
          "schema": "feedback.mobile-edition.setup-doctor.v1",
          "generatedAt": "2026-09-02T08:00:00.0000000Z",
          "overall": {
            "status": "blocked",
            "reason": "Prerequisites need action."
          },
          "checks": {
            "repository": {"status": "ready", "reason": "Repository ready."},
            "docker": {
              "status": "unavailable",
              "reason": "Docker missing.",
              "nextAction": "Install Docker Desktop.",
              "remediation": "get_docker"
            },
            "server": {"status": "needs_action", "reason": "Server not ready."},
            "tailscale": {
              "status": "needs_action",
              "reason": "Tailscale needs sign-in.",
              "remediation": "tailscale_help"
            },
            "privateHttps": {"status": "needs_action", "reason": "HTTPS not ready."}
          }
        }"#;

        let payload = setup_status_from_json(json).expect("json with remediation");

        assert_eq!(
            payload.report.checks.docker.remediation.as_deref(),
            Some("get_docker")
        );
        assert_eq!(
            payload.report.checks.tailscale.remediation.as_deref(),
            Some("tailscale_help")
        );
        assert_eq!(payload.rows[1].remediation.as_deref(), Some("get_docker"));
        assert_eq!(
            payload.rows[3].remediation.as_deref(),
            Some("tailscale_help")
        );
        assert_eq!(payload.rows[4].remediation, None);
    }

    #[test]
    fn parses_needs_action_and_unavailable_fixtures() {
        let needs_action =
            setup_status_from_json(include_str!("../../tests/fixtures/needs-action.json"))
                .expect("needs action");
        let unavailable =
            setup_status_from_json(include_str!("../../tests/fixtures/unavailable.json"))
                .expect("unavailable");

        assert_eq!(needs_action.rows[0].status, "needs_action");
        assert_eq!(
            needs_action.rows[0].next_action.as_deref(),
            Some("Run: Copy-Item .env.example .env, then edit LIBRARY_PATH.")
        );
        assert_eq!(unavailable.rows[3].status, "unavailable");
    }

    #[test]
    fn shapes_invalid_json_as_ui_safe_error() {
        let error = setup_status_from_json("not json").expect_err("invalid json");

        assert_eq!(error.code, "doctor_invalid_json");
        assert!(!error.message.contains("not json"));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn validates_real_checkout_and_runs_read_only_doctor() {
        let root = resolve_checkout_from_args(&[], Path::new(env!("CARGO_MANIFEST_DIR")))
            .expect("resolve repository checkout");
        let payload = get_setup_status_for_checkout(&root).expect("run setup doctor");

        assert_eq!(
            payload.report.schema,
            "feedback.mobile-edition.setup-doctor.v1"
        );
        assert_eq!(payload.rows.len(), 5);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn reads_real_library_state_through_json_command_contract() {
        let root = resolve_checkout_from_args(&[], Path::new(env!("CARGO_MANIFEST_DIR")))
            .expect("resolve repository checkout");
        let result = run_library_action(&root, "Inspect", None).expect("inspect library");

        assert!(!result.status.is_empty());
        assert!(!result.reason.is_empty());
    }
}
