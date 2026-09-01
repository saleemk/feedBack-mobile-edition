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

function Test-MobileEditionPrivateHttpsUrl {
    param([string]$Url)

    if (-not $Url) {
        return $false
    }

    try {
        $uri = [System.Uri]$Url
        return $uri.IsAbsoluteUri -and $uri.Scheme -eq 'https' -and [bool]$uri.Host
    } catch {
        return $false
    }
}

function Get-MobileEditionDeviceGuidePath {
    Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath 'feedback-mobile-edition-device-guide.html'
}

function ConvertFrom-MobileEditionQrPayload {
    param([string]$Payload)

    if (-not $Payload) {
        return [pscustomobject]@{
            valid = $false
            reason = 'QR helper returned no image data.'
            bytes = $null
        }
    }

    try {
        $bytes = [System.Convert]::FromBase64String($Payload.Trim())
    } catch {
        return [pscustomobject]@{
            valid = $false
            reason = 'QR helper returned image data that could not be decoded.'
            bytes = $null
        }
    }

    $pngSignature = [byte[]](0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    if ($bytes.Length -le 100) {
        return [pscustomobject]@{
            valid = $false
            reason = 'QR helper returned an unexpectedly small image.'
            bytes = $null
        }
    }

    for ($index = 0; $index -lt $pngSignature.Length; $index += 1) {
        if ($bytes[$index] -ne $pngSignature[$index]) {
            return [pscustomobject]@{
                valid = $false
                reason = 'QR helper returned data that is not a PNG image.'
                bytes = $null
            }
        }
    }

    [pscustomobject]@{
        valid = $true
        reason = ''
        bytes = $bytes
    }
}

function New-MobileEditionDeviceGuideHtml {
    param(
        [string]$Url,
        [byte[]]$QrPngBytes
    )

    $encodedUrl = [System.Net.WebUtility]::HtmlEncode($Url)
    $qrDataUrl = 'data:image/png;base64,' + [System.Convert]::ToBase64String($QrPngBytes)

@"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#0f172a">
    <title>Connect your device</title>
    <style>
        :root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #f8fafc; }
        * { box-sizing: border-box; }
        body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 2rem 1rem; background: #0f172a; }
        main { width: min(42rem, 100%); }
        h1 { margin: 0 0 0.75rem; font-size: 2rem; line-height: 1.15; }
        p, li { color: #cbd5e1; line-height: 1.55; }
        p { margin: 0.75rem 0 0; }
        .panel { border: 1px solid #334155; border-radius: 0.5rem; background: #111827; padding: 1.25rem; }
        .qr-wrap { display: grid; place-items: center; margin: 1.25rem 0; padding: 1rem; border-radius: 0.5rem; background: #f8fafc; }
        img { width: min(18rem, 100%); height: auto; display: block; }
        a { color: #38bdf8; overflow-wrap: anywhere; }
        ol { margin: 1rem 0 0; padding-left: 1.25rem; }
        li + li { margin-top: 0.55rem; }
        .muted { color: #94a3b8; font-size: 0.92rem; }
    </style>
</head>
<body>
    <main>
        <section class="panel" aria-labelledby="device-title">
            <h1 id="device-title">Connect your device</h1>
            <p>Scan the QR code or open the private Mobile Edition address on your phone or tablet.</p>
            <div class="qr-wrap">
                <img alt="QR code for the private Mobile Edition URL" src="$qrDataUrl">
            </div>
            <p><a href="$encodedUrl">$encodedUrl</a></p>
            <ol>
                <li>Install or open Tailscale on this device and sign in to the same tailnet as the computer running Mobile Edition.</li>
                <li>Scan the QR code, or open the private HTTPS address above.</li>
                <li>On iPhone or iPad, use Safari's Add to Home Screen action. On Android, use Chrome's Install app or Add to Home screen action.</li>
                <li>Open the installed app once while connected so its application files are cached.</li>
                <li>Download the songs you want available for offline practice on this device.</li>
            </ol>
            <p class="muted">Offline packages are stored per browser installation, so repeat the download step on each device you use.</p>
        </section>
    </main>
</body>
</html>
"@
}

function Invoke-MobileEditionQrHelper {
    param(
        [string]$RepositoryRoot,
        [string]$Url,
        [scriptblock]$CommandRunner,
        [object]$DockerCommand
    )

    if (-not (Test-MobileEditionPrivateHttpsUrl -Url $Url)) {
        return [pscustomobject]@{
            status = 'failed'
            reason = 'The private HTTPS URL is not valid for QR generation.'
            payload = $null
        }
    }

    $docker = $DockerCommand
    if (-not $docker) {
        $docker = Get-Command docker -ErrorAction SilentlyContinue
    }
    if (-not $docker) {
        return [pscustomobject]@{
            status = 'failed'
            reason = 'Docker CLI is not available for local QR generation.'
            payload = $null
        }
    }

    $result = Invoke-MobileEditionCommandWithRunner -CommandRunner $CommandRunner -FilePath $docker.Source -Arguments @('compose', '-f', 'docker-compose.release.yml', 'exec', '-T', 'web', 'python', '/app/scripts/Generate-MobileEditionQr.py', $Url) -WorkingDirectory $RepositoryRoot
    if ($result.exitCode -ne 0) {
        return [pscustomobject]@{
            status = 'failed'
            reason = "QR generation failed: $(Get-MobileEditionActionSummary -Output $result.output)"
            payload = $null
        }
    }
    if ($result.output -match [regex]::Escape($Url)) {
        return [pscustomobject]@{
            status = 'failed'
            reason = 'QR helper returned unexpected text.'
            payload = $null
        }
    }

    [pscustomobject]@{
        status = 'ready'
        reason = 'QR image generated.'
        payload = $result.output
    }
}

function Invoke-MobileEditionDeviceGuide {
    param(
        [string]$RepositoryRoot,
        [string]$Url,
        [scriptblock]$CommandRunner,
        [scriptblock]$ConfirmHandler,
        [scriptblock]$BrowserLauncher,
        [string]$GuidePath,
        [object]$DockerCommand
    )

    if (-not (Test-MobileEditionPrivateHttpsUrl -Url $Url)) {
        return [pscustomobject]@{
            status = 'skipped'
            reason = 'No validated private HTTPS URL is available for a device guide.'
            path = $null
        }
    }

    if (-not (Confirm-MobileEditionSetupAction -Prompt 'Create and open a local phone/tablet QR guide' -ConfirmHandler $ConfirmHandler)) {
        Write-Output 'Device guide was declined.'
        return [pscustomobject]@{
            status = 'declined'
            reason = 'Device guide was declined.'
            path = $null
        }
    }

    $qr = Invoke-MobileEditionQrHelper -RepositoryRoot $RepositoryRoot -Url $Url -CommandRunner $CommandRunner -DockerCommand $DockerCommand
    if ($qr.status -ne 'ready') {
        Write-Output $qr.reason
        return [pscustomobject]@{
            status = 'failed'
            reason = $qr.reason
            path = $null
        }
    }

    $decoded = ConvertFrom-MobileEditionQrPayload -Payload $qr.payload
    if (-not $decoded.valid) {
        Write-Output $decoded.reason
        return [pscustomobject]@{
            status = 'failed'
            reason = $decoded.reason
            path = $null
        }
    }

    $targetPath = $GuidePath
    if (-not $targetPath) {
        $targetPath = Get-MobileEditionDeviceGuidePath
    }

    try {
        $fullPath = [System.IO.Path]::GetFullPath($targetPath)
        $expectedPath = [System.IO.Path]::GetFullPath((Get-MobileEditionDeviceGuidePath))
        if ($fullPath -ne $expectedPath) {
            throw 'Device guide path is not the expected temporary file.'
        }

        $html = New-MobileEditionDeviceGuideHtml -Url $Url -QrPngBytes $decoded.bytes
        Set-Content -LiteralPath $fullPath -Value $html -Encoding UTF8
    } catch {
        $reason = "Device guide could not be written: $($_.Exception.Message)"
        Write-Output $reason
        return [pscustomobject]@{
            status = 'failed'
            reason = $reason
            path = $null
        }
    }

    try {
        if ($BrowserLauncher) {
            & $BrowserLauncher -Path $fullPath
        } else {
            Start-Process -FilePath $fullPath
        }
        Write-Output "Device guide opened: $fullPath"
        return [pscustomobject]@{
            status = 'ready'
            reason = 'Device guide created and opened.'
            path = $fullPath
        }
    } catch {
        $reason = "Device guide was created, but could not be opened: $($_.Exception.Message)"
        Write-Output $reason
        return [pscustomobject]@{
            status = 'failed'
            reason = $reason
            path = $fullPath
        }
    }
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
        [scriptblock]$BrowserLauncher,
        [string]$DeviceGuidePath,
        [object]$DockerCommand,
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
        if ($initialReport.checks.privateHttps.status -eq 'ready' -and $initialReport.checks.privateHttps.PSObject.Properties['url'] -and (Test-MobileEditionPrivateHttpsUrl -Url $initialReport.checks.privateHttps.url)) {
            Write-Output 'What if: would offer to generate and open a local phone/tablet QR guide after confirmation.'
        } else {
            Write-Output 'What if: would offer the local phone/tablet QR guide only after private HTTPS is ready.'
        }

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

    $deviceGuide = $null
    if ($finalReport.checks.privateHttps.status -eq 'ready' -and $finalReport.checks.privateHttps.PSObject.Properties['url'] -and (Test-MobileEditionPrivateHttpsUrl -Url $finalReport.checks.privateHttps.url)) {
        Write-Output ''
        $deviceGuideOutput = @(Invoke-MobileEditionDeviceGuide -RepositoryRoot $RepositoryRoot -Url $finalReport.checks.privateHttps.url -CommandRunner $CommandRunner -ConfirmHandler $ConfirmHandler -BrowserLauncher $BrowserLauncher -GuidePath $DeviceGuidePath -DockerCommand $DockerCommand)
        $deviceGuideOutput | Where-Object { $_ -is [string] } | ForEach-Object { Write-Output $_ }
        $deviceGuide = $deviceGuideOutput | Where-Object { $_ -isnot [string] } | Select-Object -Last 1
    }

    [pscustomobject]@{
        status = $finalReport.overall.status
        reason = $finalReport.overall.reason
        finalReport = $finalReport
        deviceGuide = $deviceGuide
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
