[CmdletBinding()]
param(
    [ValidateSet('EnableHttps', 'OpenGuide')]
    [string]$Action = 'EnableHttps',
    [string]$RepositoryRoot,
    [switch]$Json
)

Set-StrictMode -Version 2.0

$requestedAction = $Action
$requestedRepositoryRoot = $RepositoryRoot
$jsonRequested = $Json.IsPresent

$setupPath = Join-Path -Path $PSScriptRoot -ChildPath 'Setup-MobileEdition.ps1'
. $setupPath

function New-MobileEditionDeviceActionResult {
    param(
        [ValidateSet('EnableHttps', 'OpenGuide')]
        [string]$Action,
        [string]$Status,
        [bool]$Changed,
        [string]$Reason,
        [object]$Report,
        [string]$Url,
        [string]$Path
    )

    $result = [ordered]@{
        action = $Action
        status = $Status
        changed = $Changed
        reason = $Reason
        report = $Report
    }
    if ($Url) {
        $result.url = $Url
    }
    if ($Path) {
        $result.path = $Path
    }

    [pscustomobject]$result
}

function Invoke-MobileEditionDeviceActionDoctor {
    param(
        [string]$RepositoryRoot,
        [scriptblock]$DoctorRunner
    )

    if ($DoctorRunner) {
        return & $DoctorRunner -RepositoryRoot $RepositoryRoot
    }

    Get-MobileEditionSetupReport -RepositoryRoot $RepositoryRoot
}

function Get-MobileEditionDeviceActionPort {
    param([string]$RepositoryRoot)

    $envPath = Join-Path -Path $RepositoryRoot -ChildPath '.env'
    $envResult = Read-MobileEditionEnvFile -Path $envPath
    $settings = Resolve-MobileEditionSettings -RepositoryRoot $RepositoryRoot -EnvValues $envResult.values
    if (-not $settings.feedbackPortValid) {
        return [pscustomobject]@{
            valid = $false
            port = 0
            reason = 'FEEDBACK_PORT is not a valid TCP port.'
        }
    }

    [pscustomobject]@{
        valid = $true
        port = $settings.feedbackPort
        reason = ''
    }
}

function Get-MobileEditionPrivateHttpsUrlFromReport {
    param([object]$Report)

    if (-not $Report -or -not $Report.checks.privateHttps.PSObject.Properties['url']) {
        return $null
    }
    $url = [string]$Report.checks.privateHttps.url
    if (Test-MobileEditionPrivateHttpsUrl -Url $url) {
        return $url
    }
    $null
}

function Invoke-MobileEditionDeviceAction {
    param(
        [string]$RepositoryRoot,
        [ValidateSet('EnableHttps', 'OpenGuide')]
        [string]$Action,
        [scriptblock]$CommandRunner,
        [scriptblock]$DoctorRunner,
        [scriptblock]$ServeRunner,
        [scriptblock]$GuideRunner,
        [scriptblock]$BrowserLauncher,
        [object]$TailscaleCommand,
        [object]$DockerCommand,
        [string]$DeviceGuidePath
    )

    $initialReport = Invoke-MobileEditionDeviceActionDoctor -RepositoryRoot $RepositoryRoot -DoctorRunner $DoctorRunner

    if ($Action -eq 'EnableHttps') {
        if ($initialReport.checks.repository.status -ne 'ready') {
            return New-MobileEditionDeviceActionResult -Action $Action -Status 'needs_action' -Changed $false -Reason 'Repository configuration must be ready before private HTTPS can be enabled.' -Report $initialReport
        }
        if ($initialReport.checks.server.status -ne 'ready') {
            return New-MobileEditionDeviceActionResult -Action $Action -Status 'needs_action' -Changed $false -Reason 'The local Mobile Edition server must be ready before private HTTPS can be enabled.' -Report $initialReport
        }
        if ($initialReport.checks.tailscale.status -ne 'ready') {
            return New-MobileEditionDeviceActionResult -Action $Action -Status 'needs_action' -Changed $false -Reason 'Tailscale must be ready before private HTTPS can be enabled.' -Report $initialReport
        }
        if ($initialReport.checks.privateHttps.status -eq 'ready') {
            $existingUrl = Get-MobileEditionPrivateHttpsUrlFromReport -Report $initialReport
            return New-MobileEditionDeviceActionResult -Action $Action -Status 'ready' -Changed $false -Reason 'Private HTTPS is already ready.' -Report $initialReport -Url $existingUrl
        }

        $portChoice = Get-MobileEditionDeviceActionPort -RepositoryRoot $RepositoryRoot
        if (-not $portChoice.valid) {
            return New-MobileEditionDeviceActionResult -Action $Action -Status 'needs_action' -Changed $false -Reason $portChoice.reason -Report $initialReport
        }

        $confirmYes = { param($Prompt) $true }
        $serveResult = if ($ServeRunner) {
            & $ServeRunner -RepositoryRoot $RepositoryRoot -Port $portChoice.port -CommandRunner $CommandRunner -ConfirmHandler $confirmYes -TailscaleCommand $TailscaleCommand
        } else {
            Invoke-MobileEditionServeSetup -RepositoryRoot $RepositoryRoot -Port $portChoice.port -CommandRunner $CommandRunner -ConfirmHandler $confirmYes -TailscaleCommand $TailscaleCommand
        }
        $finalReport = Invoke-MobileEditionDeviceActionDoctor -RepositoryRoot $RepositoryRoot -DoctorRunner $DoctorRunner
        $finalUrl = Get-MobileEditionPrivateHttpsUrlFromReport -Report $finalReport

        if ($finalReport.checks.privateHttps.status -eq 'ready' -and $finalUrl) {
            return New-MobileEditionDeviceActionResult -Action $Action -Status 'ready' -Changed ($initialReport.checks.privateHttps.status -ne 'ready') -Reason 'Private HTTPS is ready. Setup doctor refreshed.' -Report $finalReport -Url $finalUrl
        }

        if ($serveResult.status -eq 'conflict') {
            return New-MobileEditionDeviceActionResult -Action $Action -Status 'conflict' -Changed $false -Reason $serveResult.reason -Report $finalReport -Url $serveResult.url
        }
        if ($serveResult.status -eq 'failed') {
            return New-MobileEditionDeviceActionResult -Action $Action -Status 'failed' -Changed $false -Reason $serveResult.reason -Report $finalReport
        }

        $privateReason = $finalReport.checks.privateHttps.reason
        if (-not $privateReason) {
            $privateReason = 'Private HTTPS is not ready yet.'
        }
        return New-MobileEditionDeviceActionResult -Action $Action -Status 'needs_action' -Changed ($serveResult.status -eq 'ready') -Reason "Private HTTPS is still not ready: $privateReason" -Report $finalReport
    }

    $url = Get-MobileEditionPrivateHttpsUrlFromReport -Report $initialReport
    if ($initialReport.checks.privateHttps.status -ne 'ready' -or -not $url) {
        return New-MobileEditionDeviceActionResult -Action $Action -Status 'needs_action' -Changed $false -Reason 'A doctor-validated private HTTPS URL is required before opening the device guide.' -Report $initialReport
    }

    $confirmYes = { param($Prompt) $true }
    $guideResult = if ($GuideRunner) {
        & $GuideRunner -RepositoryRoot $RepositoryRoot -Url $url -CommandRunner $CommandRunner -ConfirmHandler $confirmYes -BrowserLauncher $BrowserLauncher -GuidePath $DeviceGuidePath -DockerCommand $DockerCommand
    } else {
        Invoke-MobileEditionDeviceGuide -RepositoryRoot $RepositoryRoot -Url $url -CommandRunner $CommandRunner -ConfirmHandler $confirmYes -BrowserLauncher $BrowserLauncher -GuidePath $DeviceGuidePath -DockerCommand $DockerCommand
    }

    New-MobileEditionDeviceActionResult -Action $Action -Status $guideResult.status -Changed ($guideResult.status -eq 'ready') -Reason $guideResult.reason -Report $initialReport -Url $url -Path $guideResult.path
}

function Invoke-MobileEditionDeviceActionMain {
    param(
        [string]$Action,
        [string]$RepositoryRoot,
        [switch]$Json
    )

    if (-not $RepositoryRoot) {
        $RepositoryRoot = Split-Path -Parent $PSScriptRoot
    }

    $result = Invoke-MobileEditionDeviceAction -RepositoryRoot $RepositoryRoot -Action $Action
    if ($Json) {
        $result | ConvertTo-Json -Depth 10
    } else {
        $result
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-MobileEditionDeviceActionMain -Action $requestedAction -RepositoryRoot $requestedRepositoryRoot -Json:$jsonRequested
}
