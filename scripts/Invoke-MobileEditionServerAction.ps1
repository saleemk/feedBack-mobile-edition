[CmdletBinding()]
param(
    [ValidateSet('Start', 'Restart')]
    [string]$Action = 'Start',
    [string]$RepositoryRoot,
    [switch]$Json
)

Set-StrictMode -Version 2.0

$requestedAction = $Action
$requestedRepositoryRoot = $RepositoryRoot
$jsonRequested = $Json.IsPresent

$doctorPath = Join-Path -Path $PSScriptRoot -ChildPath 'Test-MobileEditionSetup.ps1'
. $doctorPath

function New-MobileEditionServerActionResult {
    param(
        [ValidateSet('Start', 'Restart')]
        [string]$Action,
        [string]$Status,
        [bool]$Changed,
        [string]$Reason,
        [object]$Report
    )

    [pscustomobject]@{
        action = $Action
        status = $Status
        changed = $Changed
        reason = $Reason
        report = $Report
    }
}

function Get-MobileEditionServerActionArguments {
    param(
        [ValidateSet('Start', 'Restart')]
        [string]$Action
    )

    if ($Action -eq 'Restart') {
        return @('compose', '-f', 'docker-compose.release.yml', 'restart', 'web')
    }

    @('compose', '-f', 'docker-compose.release.yml', 'up', '-d', '--build')
}

function Get-MobileEditionActionFailureSummary {
    param([string]$Output)

    if (-not $Output) {
        return 'The command exited with a non-zero status.'
    }

    $lines = @($Output -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 3)
    if ($lines.Count -eq 0) {
        return 'The command exited with a non-zero status.'
    }

    $lines -join ' '
}

function Invoke-MobileEditionServerActionDoctor {
    param(
        [string]$RepositoryRoot,
        [scriptblock]$DoctorRunner
    )

    if ($DoctorRunner) {
        return & $DoctorRunner -RepositoryRoot $RepositoryRoot
    }

    Get-MobileEditionSetupReport -RepositoryRoot $RepositoryRoot
}

function Wait-MobileEditionServerReadyReport {
    param(
        [string]$RepositoryRoot,
        [scriptblock]$DoctorRunner,
        [scriptblock]$SleepHandler,
        [int]$MaxAttempts = 12,
        [int]$DelaySeconds = 5
    )

    $attemptLimit = [Math]::Max(1, $MaxAttempts)
    $lastReport = $null
    for ($attempt = 1; $attempt -le $attemptLimit; $attempt += 1) {
        $lastReport = Invoke-MobileEditionServerActionDoctor -RepositoryRoot $RepositoryRoot -DoctorRunner $DoctorRunner
        if ($lastReport.checks.server.status -eq 'ready') {
            return [pscustomobject]@{
                ready = $true
                report = $lastReport
                attempts = $attempt
            }
        }

        if ($attempt -lt $attemptLimit) {
            if ($SleepHandler) {
                [void](& $SleepHandler -Seconds $DelaySeconds -Attempt $attempt)
            } elseif ($DelaySeconds -gt 0) {
                Start-Sleep -Seconds $DelaySeconds
            }
        }
    }

    [pscustomobject]@{
        ready = $false
        report = $lastReport
        attempts = $attemptLimit
    }
}

function Invoke-MobileEditionServerAction {
    param(
        [string]$RepositoryRoot,
        [ValidateSet('Start', 'Restart')]
        [string]$Action,
        [scriptblock]$CommandRunner,
        [scriptblock]$DoctorRunner,
        [scriptblock]$SleepHandler,
        [object]$DockerCommand,
        [int]$MaxReadinessAttempts = 12,
        [int]$ReadinessDelaySeconds = 5,
        [switch]$SkipDockerDiscovery
    )

    $initialReport = Invoke-MobileEditionServerActionDoctor -RepositoryRoot $RepositoryRoot -DoctorRunner $DoctorRunner
    if ($initialReport.checks.repository.status -ne 'ready') {
        return New-MobileEditionServerActionResult -Action $Action -Status 'needs_action' -Changed $false -Reason 'Repository configuration must be ready before server actions can run.' -Report $initialReport
    }

    $docker = $DockerCommand
    if (-not $docker -and -not $SkipDockerDiscovery) {
        $docker = Get-Command docker -ErrorAction SilentlyContinue
    }
    if (-not $docker) {
        return New-MobileEditionServerActionResult -Action $Action -Status 'unavailable' -Changed $false -Reason 'Docker CLI is not available.' -Report $initialReport
    }

    $arguments = @(Get-MobileEditionServerActionArguments -Action $Action)
    $result = Invoke-MobileEditionCommandWithRunner -CommandRunner $CommandRunner -FilePath $docker.Source -Arguments $arguments -WorkingDirectory $RepositoryRoot

    if ($result.exitCode -ne 0) {
        $afterReport = Invoke-MobileEditionServerActionDoctor -RepositoryRoot $RepositoryRoot -DoctorRunner $DoctorRunner
        $summary = Get-MobileEditionActionFailureSummary -Output $result.output
        return New-MobileEditionServerActionResult -Action $Action -Status 'failed' -Changed $false -Reason "Docker $($Action.ToLowerInvariant()) failed: $summary" -Report $afterReport
    }

    $readiness = Wait-MobileEditionServerReadyReport -RepositoryRoot $RepositoryRoot -DoctorRunner $DoctorRunner -SleepHandler $SleepHandler -MaxAttempts $MaxReadinessAttempts -DelaySeconds $ReadinessDelaySeconds

    if (-not $readiness.ready) {
        $serverReason = 'The local Mobile Edition server is not ready yet.'
        if ($readiness.report -and $readiness.report.checks.server.reason) {
            $serverReason = $readiness.report.checks.server.reason
        }
        return New-MobileEditionServerActionResult -Action $Action -Status 'needs_action' -Changed $true -Reason "Docker $($Action.ToLowerInvariant()) command completed, but the server is not ready yet: $serverReason" -Report $readiness.report
    }

    New-MobileEditionServerActionResult -Action $Action -Status 'ready' -Changed $true -Reason "Docker $($Action.ToLowerInvariant()) command completed and the server is ready. Setup doctor refreshed." -Report $readiness.report
}

function Invoke-MobileEditionServerActionMain {
    param(
        [string]$Action,
        [string]$RepositoryRoot,
        [switch]$Json
    )

    if (-not $RepositoryRoot) {
        $RepositoryRoot = Split-Path -Parent $PSScriptRoot
    }

    $result = Invoke-MobileEditionServerAction -RepositoryRoot $RepositoryRoot -Action $Action
    if ($Json) {
        $result | ConvertTo-Json -Depth 10
    } else {
        $result
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-MobileEditionServerActionMain -Action $requestedAction -RepositoryRoot $requestedRepositoryRoot -Json:$jsonRequested
}
