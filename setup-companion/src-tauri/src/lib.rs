use serde::{Deserialize, Serialize};
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

const DOCTOR_RELATIVE_PATH: &[&str] = &["scripts", "Test-MobileEditionSetup.ps1"];
const LIBRARY_RELATIVE_PATH: &[&str] = &["scripts", "Set-MobileEditionLibrary.ps1"];
const SERVER_ACTION_RELATIVE_PATH: &[&str] = &["scripts", "Invoke-MobileEditionServerAction.ps1"];
const DEVICE_ACTION_RELATIVE_PATH: &[&str] = &["scripts", "Invoke-MobileEditionDeviceAction.ps1"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiError {
    code: String,
    message: String,
}

impl UiError {
    fn new(code: &str, message: impl Into<String>) -> Self {
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

pub fn run() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let current_dir = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let checkout = resolve_checkout_from_args(&args, &current_dir);

    tauri::Builder::default()
        .manage(CompanionState { checkout })
        .invoke_handler(tauri::generate_handler![
            get_setup_status,
            get_library_state,
            choose_library_folder,
            validate_library_folder,
            configure_library,
            run_server_action,
            run_device_action
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
    let output = Command::new(&spec.program)
        .args(&spec.args)
        .current_dir(&spec.working_directory)
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
