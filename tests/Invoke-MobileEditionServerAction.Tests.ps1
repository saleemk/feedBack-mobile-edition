$ErrorActionPreference = 'Stop'

$serverActionScriptPath = Join-Path -Path (Split-Path -Parent $PSScriptRoot) -ChildPath 'scripts\Invoke-MobileEditionServerAction.ps1'
. $serverActionScriptPath

function Assert-Equal {
    param([object]$Actual, [object]$Expected, [string]$Message)
    if ($Actual -ne $Expected) {
        throw "$Message Expected '$Expected', got '$Actual'."
    }
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        throw $Message
    }
}

function New-TestCommand {
    param([string]$Source)
    [pscustomobject]@{
        Source = $Source
    }
}

function New-TestReport {
    param(
        [string]$RepositoryStatus = 'ready',
        [string]$DockerStatus = 'ready',
        [string]$ServerStatus = 'needs_action'
    )

    New-MobileEditionReport `
        -RepositoryCheck (New-MobileEditionCheck -Status $RepositoryStatus -Reason "repository $RepositoryStatus") `
        -DockerCheck (New-MobileEditionCheck -Status $DockerStatus -Reason "docker $DockerStatus") `
        -ServerCheck (New-MobileEditionCheck -Status $ServerStatus -Reason "server $ServerStatus") `
        -TailscaleCheck (New-MobileEditionCheck -Status 'unavailable' -Reason 'tailscale unavailable') `
        -PrivateHttpsCheck (New-MobileEditionCheck -Status 'needs_action' -Reason 'https needs action')
}

$repoRoot = 'C:\MobileEdition'
$docker = New-TestCommand -Source 'C:\Program Files\Docker\docker.exe'

Assert-Equal ((Get-MobileEditionServerActionArguments -Action Start) -join '|') 'compose|-f|docker-compose.release.yml|up|-d|--build' 'Start arguments should use the release compose start path.'
Assert-Equal ((Get-MobileEditionServerActionArguments -Action Restart) -join '|') 'compose|-f|docker-compose.release.yml|restart|web' 'Restart arguments should target only the release web service.'

$startCalls = [System.Collections.ArrayList]::new()
$startDoctorCalls = 0
$startResult = Invoke-MobileEditionServerAction `
    -RepositoryRoot $repoRoot `
    -Action Start `
    -DockerCommand $docker `
    -DoctorRunner {
        param($RepositoryRoot)
        $script:startDoctorCalls += 1
        New-TestReport -ServerStatus 'ready'
    } `
    -CommandRunner {
        param($FilePath, $Arguments, $WorkingDirectory)
        [void]$startCalls.Add([pscustomobject]@{
            filePath = $FilePath
            arguments = @($Arguments)
            workingDirectory = $WorkingDirectory
        })
        [pscustomobject]@{ exitCode = 0; output = 'started' }
    } `
    -SkipDockerDiscovery

Assert-Equal $startResult.status 'ready' 'Successful Start should be ready.'
Assert-True $startResult.changed 'Successful Start should report a change.'
Assert-Equal $startDoctorCalls 2 'Start should read the doctor before and after the action.'
Assert-Equal $startCalls.Count 1 'Start should invoke Docker once.'
Assert-Equal $startCalls[0].filePath $docker.Source 'Start should use the resolved Docker command.'
Assert-Equal ($startCalls[0].arguments -join '|') 'compose|-f|docker-compose.release.yml|up|-d|--build' 'Start should pass the exact release compose arguments.'
Assert-Equal $startCalls[0].workingDirectory $repoRoot 'Start should run from the repository root.'

$restartCalls = [System.Collections.ArrayList]::new()
$restartResult = Invoke-MobileEditionServerAction `
    -RepositoryRoot $repoRoot `
    -Action Restart `
    -DockerCommand $docker `
    -DoctorRunner {
        param($RepositoryRoot)
        New-TestReport -ServerStatus 'ready'
    } `
    -CommandRunner {
        param($FilePath, $Arguments, $WorkingDirectory)
        [void]$restartCalls.Add([pscustomobject]@{
            filePath = $FilePath
            arguments = @($Arguments)
            workingDirectory = $WorkingDirectory
        })
        [pscustomobject]@{ exitCode = 0; output = 'restarted' }
    } `
    -SkipDockerDiscovery

Assert-Equal $restartResult.status 'ready' 'Successful Restart should be ready.'
Assert-Equal ($restartCalls[0].arguments -join '|') 'compose|-f|docker-compose.release.yml|restart|web' 'Restart should pass the exact release web-service arguments.'

$delayedDoctorCalls = 0
$delayedSleepCalls = [System.Collections.ArrayList]::new()
$delayed = Invoke-MobileEditionServerAction `
    -RepositoryRoot $repoRoot `
    -Action Start `
    -DockerCommand $docker `
    -MaxReadinessAttempts 3 `
    -ReadinessDelaySeconds 2 `
    -DoctorRunner {
        param($RepositoryRoot)
        $script:delayedDoctorCalls += 1
        if ($script:delayedDoctorCalls -lt 3) {
            return New-TestReport -ServerStatus 'needs_action'
        }
        New-TestReport -ServerStatus 'ready'
    } `
    -SleepHandler {
        param($Seconds, $Attempt)
        [void]$delayedSleepCalls.Add([pscustomobject]@{
            seconds = $Seconds
            attempt = $Attempt
        })
    } `
    -CommandRunner {
        param($FilePath, $Arguments, $WorkingDirectory)
        [pscustomobject]@{ exitCode = 0; output = 'started' }
    } `
    -SkipDockerDiscovery

Assert-Equal $delayed.status 'ready' 'Delayed readiness should return ready once the doctor confirms the server.'
Assert-True $delayed.changed 'Delayed readiness should preserve the mutation marker.'
Assert-Equal $delayedDoctorCalls 3 'Delayed readiness should poll until the server is ready.'
Assert-Equal $delayedSleepCalls.Count 1 'Delayed readiness should sleep between unsuccessful polls only.'
Assert-Equal $delayedSleepCalls[0].seconds 2 'Delayed readiness should pass the configured sleep duration.'
Assert-True $delayed.reason.Contains('server is ready') 'Delayed readiness should explain doctor-confirmed readiness.'

$timeoutDoctorCalls = 0
$timeoutSleepCalls = [System.Collections.ArrayList]::new()
$timeout = Invoke-MobileEditionServerAction `
    -RepositoryRoot $repoRoot `
    -Action Restart `
    -DockerCommand $docker `
    -MaxReadinessAttempts 3 `
    -ReadinessDelaySeconds 4 `
    -DoctorRunner {
        param($RepositoryRoot)
        $script:timeoutDoctorCalls += 1
        New-TestReport -ServerStatus 'needs_action'
    } `
    -SleepHandler {
        param($Seconds, $Attempt)
        [void]$timeoutSleepCalls.Add([pscustomobject]@{
            seconds = $Seconds
            attempt = $Attempt
        })
    } `
    -CommandRunner {
        param($FilePath, $Arguments, $WorkingDirectory)
        [pscustomobject]@{ exitCode = 0; output = 'restarted' }
    } `
    -SkipDockerDiscovery

Assert-Equal $timeout.status 'needs_action' 'Timeout should not report ready before the doctor confirms server readiness.'
Assert-True $timeout.changed 'Timeout after a successful Docker command should keep changed true.'
Assert-Equal $timeoutDoctorCalls 4 'Timeout should include the initial preflight doctor plus bounded readiness polls.'
Assert-Equal $timeoutSleepCalls.Count 2 'Timeout should not sleep after the final poll.'
Assert-True $timeout.reason.Contains('server needs_action') 'Timeout should include the final server reason.'
Assert-Equal $timeout.report.checks.server.status 'needs_action' 'Timeout should preserve the final report for the UI.'

$refused = Invoke-MobileEditionServerAction `
    -RepositoryRoot $repoRoot `
    -Action Start `
    -DoctorRunner {
        param($RepositoryRoot)
        New-TestReport -RepositoryStatus 'needs_action'
    } `
    -CommandRunner {
        throw 'Command runner must not be called when repository configuration is not ready.'
    } `
    -SkipDockerDiscovery

Assert-Equal $refused.status 'needs_action' 'Repository configuration should block server actions.'
Assert-True (-not $refused.changed) 'Refused actions must not report mutation.'
Assert-True $refused.reason.Contains('Repository configuration') 'Refusal should explain the repository prerequisite.'

$dockerUnavailable = Invoke-MobileEditionServerAction `
    -RepositoryRoot $repoRoot `
    -Action Start `
    -DoctorRunner {
        param($RepositoryRoot)
        New-TestReport
    } `
    -CommandRunner {
        throw 'Command runner must not be called when Docker is unavailable.'
    } `
    -SkipDockerDiscovery

Assert-Equal $dockerUnavailable.status 'unavailable' 'Missing Docker should be unavailable.'
Assert-True (-not $dockerUnavailable.changed) 'Unavailable Docker must not report mutation.'

$failed = Invoke-MobileEditionServerAction `
    -RepositoryRoot $repoRoot `
    -Action Restart `
    -DockerCommand $docker `
    -DoctorRunner {
        param($RepositoryRoot)
        New-TestReport -ServerStatus 'needs_action'
    } `
    -CommandRunner {
        param($FilePath, $Arguments, $WorkingDirectory)
        [pscustomobject]@{
            exitCode = 17
            output = "line one`nline two`nline three`nline four"
        }
    } `
    -SkipDockerDiscovery

Assert-Equal $failed.status 'failed' 'Nonzero Docker exit should be shaped as failed.'
Assert-True (-not $failed.changed) 'Failed actions must not report mutation.'
Assert-True $failed.reason.Contains('line one line two line three') 'Failure reason should include a short command summary.'
Assert-True (-not $failed.reason.Contains('line four')) 'Failure reason should trim long command output.'

$allowlistRejected = $false
try {
    Invoke-MobileEditionServerAction -RepositoryRoot $repoRoot -Action Stop -SkipDockerDiscovery | Out-Null
} catch {
    $allowlistRejected = $true
}
Assert-True $allowlistRejected 'The action allowlist should reject unsupported actions.'

$json = $startResult | ConvertTo-Json -Depth 10
$parsed = $json | ConvertFrom-Json
Assert-Equal $parsed.action 'Start' 'JSON output should include the action.'
Assert-Equal $parsed.status 'ready' 'JSON output should include the action status.'
Assert-True ($parsed.report.schema -eq 'feedback.mobile-edition.setup-doctor.v1') 'JSON output should include the refreshed doctor report.'

Write-Output 'Invoke-MobileEditionServerAction tests passed.'
