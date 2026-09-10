param(
    [string]$Version,
    [string]$RepositoryRoot,
    [string]$OutputDirectory,
    [switch]$Force
)

Set-StrictMode -Version 2.0
Add-Type -AssemblyName System.IO.Compression.FileSystem

$script:MobileEditionWindowsInstallerInvocation = @{
    Version = $Version
    RepositoryRoot = $RepositoryRoot
    OutputDirectory = $OutputDirectory
    Force = $Force
}
. (Join-Path -Path $PSScriptRoot -ChildPath 'Build-MobileEditionSetupBundle.ps1')
$Version = $script:MobileEditionWindowsInstallerInvocation.Version
$RepositoryRoot = $script:MobileEditionWindowsInstallerInvocation.RepositoryRoot
$OutputDirectory = $script:MobileEditionWindowsInstallerInvocation.OutputDirectory
$Force = $script:MobileEditionWindowsInstallerInvocation.Force

function ConvertTo-MobileEditionInstallerVersion {
    param([string]$Version)

    Assert-MobileEditionBundleVersion -Version $Version
    $normalized = $Version.Trim()
    if ($normalized.StartsWith('v')) {
        $normalized = $normalized.Substring(1)
    }
    if ($normalized -notmatch '^\d+\.\d+\.\d+([\-+][0-9A-Za-z.-]+)?$') {
        throw 'Installer version must be a semantic version, optionally prefixed with v.'
    }
    return $normalized
}

function Resolve-MobileEditionInstallerOutputDirectory {
    param(
        [string]$RepositoryRoot,
        [string]$OutputDirectory
    )

    $resolvedOutputDirectory = if ($OutputDirectory) {
        [System.IO.Path]::GetFullPath($OutputDirectory)
    } else {
        [System.IO.Path]::GetFullPath((Join-Path -Path $RepositoryRoot -ChildPath 'artifacts\windows-installer'))
    }
    $artifactRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $RepositoryRoot -ChildPath 'artifacts'))
    if ($resolvedOutputDirectory -ne $artifactRoot -and -not (Test-MobileEditionBundleChildPath -Parent $artifactRoot -Child $resolvedOutputDirectory)) {
        throw 'Output directory must stay inside the repository artifact area.'
    }
    return $resolvedOutputDirectory
}

function Assert-MobileEditionInstallerPayloadRequiredFiles {
    param([string]$EditionDirectory)

    foreach ($requiredPath in @(
            'Setup-MobileEdition.cmd',
            '.env.example',
            'docker-compose.release.yml',
            'LICENSE',
            'ATTRIBUTIONS.md',
            'RELEASE-MANIFEST.md',
            'scripts\Setup-MobileEdition.ps1',
            'scripts\Start-MobileEditionSetup.ps1',
            'scripts\Test-MobileEditionSetup.ps1'
        )) {
        $candidate = Join-Path -Path $EditionDirectory -ChildPath $requiredPath
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            throw "Staged installer payload is missing required file: $requiredPath"
        }
    }
}

function New-MobileEditionInstallerStagingPayload {
    param(
        [string]$RepositoryRoot,
        [string]$Version
    )

    Assert-MobileEditionBundleCleanTrackedTree -RepositoryRoot $RepositoryRoot
    Assert-MobileEditionBundleTrackedExclusions -RepositoryRoot $RepositoryRoot

    $head = (Invoke-MobileEditionBundleGit -RepositoryRoot $RepositoryRoot -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1)
    $stagingRoot = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("feedback-mobile-edition-installer-" + [guid]::NewGuid().ToString('N'))
    $resourcesRoot = Join-Path -Path $stagingRoot -ChildPath 'resources'
    $editionDirectory = Join-Path -Path $resourcesRoot -ChildPath 'edition'
    $archivePath = Join-Path -Path $stagingRoot -ChildPath 'edition-source.zip'

    New-Item -ItemType Directory -Path $resourcesRoot -Force | Out-Null
    Invoke-MobileEditionBundleGit -RepositoryRoot $RepositoryRoot -Arguments @('archive', '--format=zip', "--output=$archivePath", '--prefix=edition/', $head) | Out-Null
    [System.IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $resourcesRoot)
    Remove-Item -LiteralPath $archivePath -Force
    Assert-MobileEditionInstallerPayloadRequiredFiles -EditionDirectory $editionDirectory

    [pscustomobject]@{
        head = $head
        stagingRoot = $stagingRoot
        resourcesRoot = $resourcesRoot
        editionDirectory = $editionDirectory
    }
}

function New-MobileEditionInstallerTauriConfig {
    param(
        [string]$RepositoryRoot,
        [string]$StagingRoot,
        [string]$EditionDirectory,
        [string]$Version
    )

    $configPath = Join-Path -Path $RepositoryRoot -ChildPath 'setup-companion\src-tauri\tauri.conf.json'
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $config.productName = 'fee[dB]ack Mobile Edition'
    $config.version = ConvertTo-MobileEditionInstallerVersion -Version $Version
    $config.identifier = 'com.saleemk.feedbackmobileedition'
    $config.bundle.active = $true
    $config.bundle.targets = @('nsis')
    $config.bundle | Add-Member -MemberType NoteProperty -Name resources -Value ([ordered]@{
            $EditionDirectory = 'edition'
        }) -Force
    $config.bundle | Add-Member -MemberType NoteProperty -Name windows -Value ([ordered]@{
            nsis = [ordered]@{
                installMode = 'currentUser'
                languages = @('English')
            }
        }) -Force

    $installerConfigPath = Join-Path -Path $StagingRoot -ChildPath 'tauri.windows-installer.conf.json'
    $configJson = $config | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($installerConfigPath, $configJson, [System.Text.UTF8Encoding]::new($false))
    return $installerConfigPath
}

function Get-MobileEditionNsisInstallerDirectory {
    param([string]$CompanionRoot)

    Join-Path -Path $CompanionRoot -ChildPath 'src-tauri\target\release\bundle\nsis'
}

function Get-MobileEditionInstallerExecutableSnapshot {
    param([string]$NsisDirectory)

    $snapshot = @{}
    foreach ($candidate in @(Get-ChildItem -LiteralPath $NsisDirectory -Filter '*.exe' -File -ErrorAction SilentlyContinue)) {
        $snapshot[$candidate.FullName] = [pscustomobject]@{
            lastWriteTimeUtc = $candidate.LastWriteTimeUtc
            length = $candidate.Length
        }
    }
    return $snapshot
}

function Resolve-MobileEditionFreshInstallerExecutable {
    param(
        [string]$NsisDirectory,
        [hashtable]$BeforeSnapshot
    )

    $freshCandidates = @(Get-ChildItem -LiteralPath $NsisDirectory -Filter '*.exe' -File -ErrorAction SilentlyContinue | Where-Object {
            -not $BeforeSnapshot.ContainsKey($_.FullName) `
                -or $_.LastWriteTimeUtc -gt $BeforeSnapshot[$_.FullName].lastWriteTimeUtc `
                -or $_.Length -ne $BeforeSnapshot[$_.FullName].length
        } | Sort-Object -Property LastWriteTimeUtc -Descending)
    if ($freshCandidates.Count -eq 0) {
        throw "Tauri NSIS build did not produce a new or changed installer executable under $NsisDirectory."
    }
    return $freshCandidates[0].FullName
}

function Invoke-MobileEditionWindowsInstallerTauriBuild {
    param(
        [string]$RepositoryRoot,
        [string]$CompanionRoot,
        [string]$ConfigPath,
        [string]$StagedEditionDirectory,
        [string]$Version
    )

    $packageLock = Join-Path -Path $CompanionRoot -ChildPath 'package-lock.json'
    if (-not (Test-Path -LiteralPath $packageLock -PathType Leaf)) {
        throw "Setup Companion package-lock.json not found at $packageLock. Cannot perform locked dependency install."
    }
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCommand) {
        $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
    }
    if (-not $npmCommand) {
        throw 'npm is required to install locked Setup Companion dependencies before building the installer.'
    }

    Invoke-MobileEditionBundleCommand -FilePath $npmCommand.Source -Arguments @('ci') -WorkingDirectory $CompanionRoot -Description 'Setup Companion npm ci' | Out-Null
    $tauriCommand = Join-Path -Path $CompanionRoot -ChildPath 'node_modules\.bin\tauri.cmd'
    if (-not (Test-Path -LiteralPath $tauriCommand -PathType Leaf)) {
        throw "Tauri CLI was not installed at $tauriCommand after npm ci."
    }

    $nsisDirectory = Get-MobileEditionNsisInstallerDirectory -CompanionRoot $CompanionRoot
    $beforeSnapshot = Get-MobileEditionInstallerExecutableSnapshot -NsisDirectory $nsisDirectory
    Invoke-MobileEditionBundleCommand -FilePath $tauriCommand -Arguments @('build', '--config', $ConfigPath, '--bundles', 'nsis') -WorkingDirectory $CompanionRoot -Description 'Setup Companion NSIS installer build' | Out-Null
    Resolve-MobileEditionFreshInstallerExecutable -NsisDirectory $nsisDirectory -BeforeSnapshot $beforeSnapshot
}

function New-MobileEditionWindowsInstaller {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Version,
        [string]$RepositoryRoot,
        [string]$OutputDirectory,
        [switch]$Force,
        [scriptblock]$TauriBuilder = ${function:Invoke-MobileEditionWindowsInstallerTauriBuild}
    )

    $installerVersion = ConvertTo-MobileEditionInstallerVersion -Version $Version
    $resolvedRepositoryRoot = Resolve-MobileEditionBundleRepositoryRoot -RepositoryRoot $RepositoryRoot
    if (-not (Test-Path -LiteralPath (Join-Path -Path $resolvedRepositoryRoot -ChildPath '.git') -PathType Container)) {
        throw "Repository root is not a Git checkout: $resolvedRepositoryRoot"
    }
    $resolvedOutputDirectory = Resolve-MobileEditionInstallerOutputDirectory -RepositoryRoot $resolvedRepositoryRoot -OutputDirectory $OutputDirectory
    $installerName = "feedback-mobile-edition-$Version-windows-setup.exe"
    $installerPath = Join-Path -Path $resolvedOutputDirectory -ChildPath $installerName
    $checksumPath = "$installerPath.sha256"
    if ((Test-Path -LiteralPath $installerPath -PathType Leaf) -and -not $Force) {
        throw "Refusing to overwrite existing Windows installer: $installerPath"
    }
    if ((Test-Path -LiteralPath $checksumPath -PathType Leaf) -and -not $Force) {
        throw "Refusing to overwrite existing Windows installer checksum: $checksumPath"
    }

    $staging = $null
    try {
        $staging = New-MobileEditionInstallerStagingPayload -RepositoryRoot $resolvedRepositoryRoot -Version $Version
        $companionRoot = Join-Path -Path $resolvedRepositoryRoot -ChildPath 'setup-companion'
        $configPath = New-MobileEditionInstallerTauriConfig `
            -RepositoryRoot $resolvedRepositoryRoot `
            -StagingRoot $staging.stagingRoot `
            -EditionDirectory $staging.editionDirectory `
            -Version $Version

        Assert-MobileEditionBundleCleanTrackedTree -RepositoryRoot $resolvedRepositoryRoot
        Assert-MobileEditionBundleUnchangedHead -RepositoryRoot $resolvedRepositoryRoot -ExpectedHead $staging.head

        $builtInstaller = & $TauriBuilder `
            -RepositoryRoot $resolvedRepositoryRoot `
            -CompanionRoot $companionRoot `
            -ConfigPath $configPath `
            -StagedEditionDirectory $staging.editionDirectory `
            -Version $Version
        if (-not (Test-Path -LiteralPath $builtInstaller -PathType Leaf)) {
            throw "Tauri builder did not return an installer executable: $builtInstaller"
        }

        Assert-MobileEditionBundleCleanTrackedTree -RepositoryRoot $resolvedRepositoryRoot
        Assert-MobileEditionBundleUnchangedHead -RepositoryRoot $resolvedRepositoryRoot -ExpectedHead $staging.head

        New-Item -ItemType Directory -Path $resolvedOutputDirectory -Force | Out-Null
        if ($Force) {
            Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $checksumPath -Force -ErrorAction SilentlyContinue
        }
        Copy-Item -LiteralPath $builtInstaller -Destination $installerPath -Force
        $installerSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $installerPath).Hash.ToLowerInvariant()
        "$installerSha256  $installerName" | Set-Content -LiteralPath $checksumPath -Encoding ASCII

        [pscustomobject]@{
            version = $Version
            installerVersion = $installerVersion
            editionCommit = $staging.head
            installerPath = $installerPath
            installerSha256 = $installerSha256
            checksumPath = $checksumPath
        }
    } finally {
        if ($null -ne $staging) {
            $fullStagingRoot = [System.IO.Path]::GetFullPath($staging.stagingRoot)
            $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
            if ($fullStagingRoot.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $fullStagingRoot).StartsWith('feedback-mobile-edition-installer-', [System.StringComparison]::OrdinalIgnoreCase)) {
                Remove-Item -LiteralPath $fullStagingRoot -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    if (-not $Version) {
        throw 'Version is required. Pass -Version <edition-version>.'
    }
    $result = New-MobileEditionWindowsInstaller -Version $Version -RepositoryRoot $RepositoryRoot -OutputDirectory $OutputDirectory -Force:$Force
    Write-Output "Windows installer: $($result.installerPath)"
    Write-Output "Windows installer SHA-256: $($result.installerSha256)"
    Write-Output "Checksum file: $($result.checksumPath)"
    Write-Output "Edition commit: $($result.editionCommit)"
}
