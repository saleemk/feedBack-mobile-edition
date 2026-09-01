[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$LibraryPath,
    [int]$Port
)

Set-StrictMode -Version 2.0

$doctorPath = Join-Path -Path $PSScriptRoot -ChildPath 'Test-MobileEditionSetup.ps1'
. $doctorPath

function Get-MobileEditionSetupPaths {
    param([string]$ScriptRoot)

    $repositoryRoot = Split-Path -Parent $ScriptRoot
    [pscustomobject]@{
        repositoryRoot = $repositoryRoot
        envPath = Join-Path -Path $repositoryRoot -ChildPath '.env'
        envExamplePath = Join-Path -Path $repositoryRoot -ChildPath '.env.example'
        composeFile = Join-Path -Path $repositoryRoot -ChildPath 'docker-compose.release.yml'
    }
}

function Test-MobileEditionValidPort {
    param([int]$Port)

    $Port -ge 1 -and $Port -le 65535
}

function Get-MobileEditionActionSummary {
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

function Confirm-MobileEditionSetupAction {
    param(
        [string]$Prompt,
        [scriptblock]$ConfirmHandler
    )

    if ($ConfirmHandler) {
        return [bool](& $ConfirmHandler -Prompt $Prompt)
    }

    $answer = Read-Host "$Prompt [y/N]"
    $answer -match '^(?i:y|yes)$'
}

function Read-MobileEditionSetupInput {
    param(
        [string]$Prompt,
        [scriptblock]$PromptHandler
    )

    if ($PromptHandler) {
        return [string](& $PromptHandler -Prompt $Prompt)
    }

    [string](Read-Host $Prompt)
}

function Resolve-MobileEditionLibraryChoice {
    param(
        [string]$RepositoryRoot,
        [string]$LibraryPath
    )

    if (-not $LibraryPath) {
        return [pscustomobject]@{
            valid = $false
            reason = 'No song-library folder was supplied.'
            originalPath = $LibraryPath
            resolvedPath = $null
        }
    }

    try {
        $resolved = Resolve-MobileEditionPath -RepositoryRoot $RepositoryRoot -Path $LibraryPath
    } catch {
        return [pscustomobject]@{
            valid = $false
            reason = 'The song-library folder path could not be resolved.'
            originalPath = $LibraryPath
            resolvedPath = $null
        }
    }

    [pscustomobject]@{
        valid = (Test-Path -LiteralPath $resolved -PathType Container)
        reason = 'The song-library folder does not exist.'
        originalPath = $LibraryPath
        resolvedPath = $resolved
    }
}

function Get-MobileEditionPortChoice {
    param(
        [Nullable[int]]$RequestedPort,
        [Nullable[int]]$CurrentPort
    )

    if ($null -ne $RequestedPort) {
        if (Test-MobileEditionValidPort -Port $RequestedPort) {
            return [pscustomobject]@{
                valid = $true
                port = $RequestedPort
                reason = ''
            }
        }
        return [pscustomobject]@{
            valid = $false
            port = 0
            reason = 'The supplied port must be from 1 to 65535.'
        }
    }

    if ($null -ne $CurrentPort -and (Test-MobileEditionValidPort -Port $CurrentPort)) {
        return [pscustomobject]@{
            valid = $true
            port = $CurrentPort
            reason = ''
        }
    }

    [pscustomobject]@{
        valid = $true
        port = 8000
        reason = ''
    }
}

function Set-MobileEditionEnvLine {
    param(
        [string[]]$Lines,
        [string]$Key,
        [string]$Value
    )

    $updated = @()
    $replaced = $false
    foreach ($line in $Lines) {
        if (-not $replaced -and $line -match "^\s*$([regex]::Escape($Key))\s*=") {
            $updated += "$Key=$Value"
            $replaced = $true
        } else {
            $updated += $line
        }
    }

    if (-not $replaced) {
        if ($updated.Count -gt 0 -and $updated[$updated.Count - 1].Trim()) {
            $updated += ''
        }
        $updated += "$Key=$Value"
    }

    $updated
}

function Set-MobileEditionEnvFile {
    param(
        [string]$EnvPath,
        [string]$EnvExamplePath,
        [string]$LibraryPath,
        [int]$Port,
        [switch]$DryRun
    )

    if (-not (Test-MobileEditionValidPort -Port $Port)) {
        return [pscustomobject]@{
            changed = $false
            status = 'failed'
            reason = 'FEEDBACK_PORT must be from 1 to 65535.'
        }
    }

    if (Test-Path -LiteralPath $EnvPath -PathType Leaf) {
        $lines = @(Get-Content -LiteralPath $EnvPath)
    } elseif (Test-Path -LiteralPath $EnvExamplePath -PathType Leaf) {
        $lines = @(Get-Content -LiteralPath $EnvExamplePath)
    } else {
        return [pscustomobject]@{
            changed = $false
            status = 'failed'
            reason = '.env.example is missing.'
        }
    }

    $lines = @(Set-MobileEditionEnvLine -Lines $lines -Key 'LIBRARY_PATH' -Value $LibraryPath)
    $lines = @(Set-MobileEditionEnvLine -Lines $lines -Key 'FEEDBACK_PORT' -Value ([string]$Port))

    if (-not $DryRun) {
        Set-Content -LiteralPath $EnvPath -Value $lines -Encoding UTF8
    }

    [pscustomobject]@{
        changed = $true
        status = 'ready'
        reason = '.env is configured.'
    }
}

function Invoke-MobileEditionDockerStart {
    param(
        [string]$RepositoryRoot,
        [scriptblock]$CommandRunner,
        [scriptblock]$ConfirmHandler,
        [object]$DockerCommand,
        [switch]$DryRun
    )

    $commandText = 'docker compose -f docker-compose.release.yml up -d --build'
    if (-not (Confirm-MobileEditionSetupAction -Prompt "Start Mobile Edition with: $commandText" -ConfirmHandler $ConfirmHandler)) {
        return [pscustomobject]@{
            status = 'declined'
            reason = 'Docker start was declined.'
        }
    }

    if ($DryRun) {
        Write-Output "What if: would run $commandText"
        return [pscustomobject]@{
            status = 'whatif'
            reason = 'Docker start was not run because -WhatIf is active.'
        }
    }

    $docker = $DockerCommand
    if (-not $docker) {
        $docker = Get-Command docker -ErrorAction SilentlyContinue
    }
    if (-not $docker) {
        return [pscustomobject]@{
            status = 'failed'
            reason = 'Docker CLI is not available.'
        }
    }

    $result = Invoke-MobileEditionCommandWithRunner -CommandRunner $CommandRunner -FilePath $docker.Source -Arguments @('compose', '-f', 'docker-compose.release.yml', 'up', '-d', '--build') -WorkingDirectory $RepositoryRoot
    if ($result.exitCode -ne 0) {
        return [pscustomobject]@{
            status = 'failed'
            reason = "Docker start failed: $(Get-MobileEditionActionSummary -Output $result.output)"
        }
    }

    [pscustomobject]@{
        status = 'ready'
        reason = 'Docker start command completed.'
    }
}

function Get-MobileEditionServeDecision {
    param(
        [object]$ServeJson,
        [int]$Port
    )

    $rootState = Get-MobileEditionServeRootState -ServeJson $ServeJson -Port $Port
    switch ($rootState.status) {
        'matching' {
            [pscustomobject]@{
                status = 'ready'
                reason = 'Tailscale Serve already exposes this Edition port.'
                url = $rootState.url
                command = $null
            }
        }
        'conflict' {
            [pscustomobject]@{
                status = 'conflict'
                reason = 'Tailscale Serve already has a root HTTPS handler for another target.'
                url = $rootState.url
                command = $null
            }
        }
        default {
            [pscustomobject]@{
                status = 'absent'
                reason = 'No root Tailscale Serve handler exposes this Edition port.'
                url = $null
                command = "tailscale serve --bg $Port"
            }
        }
    }
}

function Invoke-MobileEditionServeSetup {
    param(
        [string]$RepositoryRoot,
        [int]$Port,
        [scriptblock]$CommandRunner,
        [scriptblock]$ConfirmHandler,
        [object]$TailscaleCommand,
        [switch]$DryRun
    )

    $tailscale = $TailscaleCommand
    if (-not $tailscale) {
        $tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
    }
    if (-not $tailscale) {
        return [pscustomobject]@{
            status = 'skipped'
            reason = 'Tailscale CLI is not available.'
        }
    }

    $statusResult = Invoke-MobileEditionCommandWithRunner -CommandRunner $CommandRunner -FilePath $tailscale.Source -Arguments @('serve', 'status', '--json') -WorkingDirectory $RepositoryRoot
    if ($statusResult.exitCode -ne 0) {
        return [pscustomobject]@{
            status = 'skipped'
            reason = "Tailscale Serve status could not be read: $(Get-MobileEditionActionSummary -Output $statusResult.output)"
        }
    }

    $serveJson = ConvertFrom-MobileEditionJson -Text $statusResult.output
    if (-not $serveJson) {
        return [pscustomobject]@{
            status = 'skipped'
            reason = 'Tailscale Serve returned malformed JSON.'
        }
    }

    $decision = Get-MobileEditionServeDecision -ServeJson $serveJson -Port $Port
    if ($decision.status -eq 'ready' -or $decision.status -eq 'conflict') {
        return $decision
    }

    if (-not (Confirm-MobileEditionSetupAction -Prompt "Enable private HTTPS with: $($decision.command)" -ConfirmHandler $ConfirmHandler)) {
        return [pscustomobject]@{
            status = 'declined'
            reason = 'Private HTTPS setup was declined.'
        }
    }

    if ($DryRun) {
        Write-Output "What if: would run $($decision.command)"
        return [pscustomobject]@{
            status = 'whatif'
            reason = 'Private HTTPS setup was not run because -WhatIf is active.'
        }
    }

    $serveResult = Invoke-MobileEditionCommandWithRunner -CommandRunner $CommandRunner -FilePath $tailscale.Source -Arguments @('serve', '--bg', ([string]$Port)) -WorkingDirectory $RepositoryRoot
    if ($serveResult.exitCode -ne 0) {
        return [pscustomobject]@{
            status = 'failed'
            reason = "Tailscale Serve setup failed: $(Get-MobileEditionActionSummary -Output $serveResult.output)"
        }
    }

    [pscustomobject]@{
        status = 'ready'
        reason = 'Tailscale Serve setup command completed.'
    }
}

function Invoke-MobileEditionGuidedSetup {
    param(
        [string]$RepositoryRoot,
        [string]$LibraryPath,
        [Nullable[int]]$Port,
        [scriptblock]$CommandRunner,
        [scriptblock]$PromptHandler,
        [scriptblock]$ConfirmHandler,
        [scriptblock]$DoctorRunner,
        [switch]$DryRun
    )

    Write-Output 'Mobile Edition Guided Setup'
    Write-Output ''

    $initialReport = if ($DoctorRunner) {
        & $DoctorRunner -RepositoryRoot $RepositoryRoot
    } else {
        Get-MobileEditionSetupReport -RepositoryRoot $RepositoryRoot
    }
    Write-MobileEditionHumanReport -Report $initialReport
    Write-Output ''

    $envPath = Join-Path -Path $RepositoryRoot -ChildPath '.env'
    $envExamplePath = Join-Path -Path $RepositoryRoot -ChildPath '.env.example'
    $envResult = Read-MobileEditionEnvFile -Path $envPath
    $settings = Resolve-MobileEditionSettings -RepositoryRoot $RepositoryRoot -EnvValues $envResult.values

    $needsRepositoryConfig = $initialReport.checks.repository.status -ne 'ready' -or [bool]$LibraryPath -or ($null -ne $Port)
    $selectedLibraryPath = $LibraryPath
    if ($needsRepositoryConfig -and -not $selectedLibraryPath) {
        if ($DryRun) {
            $selectedLibraryPath = $settings.libraryPath
        } else {
            $selectedLibraryPath = Read-MobileEditionSetupInput -Prompt 'Enter the full path to your song-library folder' -PromptHandler $PromptHandler
        }
    }
    if (-not $selectedLibraryPath -and $settings.libraryPath) {
        $selectedLibraryPath = $settings.libraryPath
    }

    $selectedPort = Get-MobileEditionPortChoice -RequestedPort $Port -CurrentPort $settings.feedbackPort
    if (-not $selectedPort.valid) {
        Write-Output $selectedPort.reason
        return [pscustomobject]@{
            status = 'partial'
            reason = $selectedPort.reason
            finalReport = $initialReport
        }
    }

    if ($DryRun) {
        Write-Output 'What if: would run the setup doctor and inspect the current state.'
        if ($needsRepositoryConfig) {
            if ($LibraryPath) {
                $libraryChoice = Resolve-MobileEditionLibraryChoice -RepositoryRoot $RepositoryRoot -LibraryPath $selectedLibraryPath
                if ($libraryChoice.valid) {
                    Write-Output "What if: would create or update .env with the supplied song-library folder and FEEDBACK_PORT=$($selectedPort.port)."
                } else {
                    Write-Output "What if: would stop before changing .env because the supplied song-library folder is not usable."
                    return [pscustomobject]@{
                        status = 'partial'
                        reason = $libraryChoice.reason
                        finalReport = $initialReport
                    }
                }
            } else {
                Write-Output "What if: would ask for an existing song-library folder, then create or update .env with FEEDBACK_PORT=$($selectedPort.port)."
            }
        } else {
            Write-Output 'What if: would leave .env unchanged.'
        }

        if ($initialReport.checks.server.status -ne 'ready') {
            Write-Output 'What if: would ask before running docker compose -f docker-compose.release.yml up -d --build.'
        } else {
            Write-Output 'What if: local Mobile Edition server is already ready; would not start Docker.'
        }

        Write-Output "What if: after the local server is confirmed ready, would inspect Tailscale Serve and ask before running tailscale serve --bg $($selectedPort.port) only if no root HTTPS handler exists."
        Write-Output 'What if: would not reset or replace a conflicting Tailscale Serve root handler.'

        return [pscustomobject]@{
            status = 'whatif'
            reason = 'Preview completed without prompts or mutations.'
            finalReport = $initialReport
        }
    }

    if ($needsRepositoryConfig) {
        $libraryChoice = Resolve-MobileEditionLibraryChoice -RepositoryRoot $RepositoryRoot -LibraryPath $selectedLibraryPath
        if (-not $libraryChoice.valid) {
            Write-Output $libraryChoice.reason
            return [pscustomobject]@{
                status = 'partial'
                reason = $libraryChoice.reason
                finalReport = $initialReport
            }
        }

        $envAction = "Configure .env with LIBRARY_PATH=$selectedLibraryPath and FEEDBACK_PORT=$($selectedPort.port)"
        if (Confirm-MobileEditionSetupAction -Prompt $envAction -ConfirmHandler $ConfirmHandler) {
            $envUpdate = Set-MobileEditionEnvFile -EnvPath $envPath -EnvExamplePath $envExamplePath -LibraryPath $selectedLibraryPath -Port $selectedPort.port
            Write-Output $envUpdate.reason
        } else {
            Write-Output 'Repository configuration was declined.'
            return [pscustomobject]@{
                status = 'partial'
                reason = 'Repository configuration was declined.'
                finalReport = $initialReport
            }
        }
    }

    $afterConfigReport = if ($DoctorRunner) {
        & $DoctorRunner -RepositoryRoot $RepositoryRoot
    } else {
        Get-MobileEditionSetupReport -RepositoryRoot $RepositoryRoot
    }

    if ($afterConfigReport.checks.repository.status -eq 'ready' -and $afterConfigReport.checks.server.status -ne 'ready') {
        $dockerStart = Invoke-MobileEditionDockerStart -RepositoryRoot $RepositoryRoot -CommandRunner $CommandRunner -ConfirmHandler $ConfirmHandler
        Write-Output $dockerStart.reason
    }

    $afterDockerReport = if ($DoctorRunner) {
        & $DoctorRunner -RepositoryRoot $RepositoryRoot
    } else {
        Get-MobileEditionSetupReport -RepositoryRoot $RepositoryRoot
    }

    if ($afterDockerReport.checks.server.status -eq 'ready' -and $afterDockerReport.checks.tailscale.status -eq 'ready' -and $afterDockerReport.checks.privateHttps.status -ne 'ready') {
        $serveSetup = Invoke-MobileEditionServeSetup -RepositoryRoot $RepositoryRoot -Port $selectedPort.port -CommandRunner $CommandRunner -ConfirmHandler $ConfirmHandler
        Write-Output $serveSetup.reason
    }

    $finalReport = if ($DoctorRunner) {
        & $DoctorRunner -RepositoryRoot $RepositoryRoot
    } else {
        Get-MobileEditionSetupReport -RepositoryRoot $RepositoryRoot
    }

    Write-Output ''
    Write-Output 'Final status:'
    Write-MobileEditionHumanReport -Report $finalReport
    if ($finalReport.checks.privateHttps.PSObject.Properties['url'] -and $finalReport.checks.privateHttps.url) {
        Write-Output ''
        Write-Output "Open: $($finalReport.checks.privateHttps.url)"
    }

    [pscustomobject]@{
        status = $finalReport.overall.status
        reason = $finalReport.overall.reason
        finalReport = $finalReport
    }
}

function Invoke-MobileEditionGuidedSetupMain {
    param(
        [string]$LibraryPath,
        [Nullable[int]]$Port
    )

    $paths = Get-MobileEditionSetupPaths -ScriptRoot $PSScriptRoot
    Invoke-MobileEditionGuidedSetup -RepositoryRoot $paths.repositoryRoot -LibraryPath $LibraryPath -Port $Port -DryRun:$WhatIfPreference | ForEach-Object {
        if ($_ -is [string]) {
            Write-Output $_
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    $requestedPort = $null
    if ($PSBoundParameters.ContainsKey('Port')) {
        $requestedPort = $Port
    }
    Invoke-MobileEditionGuidedSetupMain -LibraryPath $LibraryPath -Port $requestedPort
}
