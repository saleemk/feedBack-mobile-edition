$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path -Path $repoRoot -ChildPath 'scripts\Build-MobileEditionWindowsInstaller.ps1')

function Assert-Equal {
    param(
        [object]$Actual,
        [object]$Expected,
        [string]$Message
    )
    if ($Actual -ne $Expected) {
        throw "$Message Expected '$Expected', got '$Actual'."
    }
}

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )
    if (-not $Condition) {
        throw $Message
    }
}

function Assert-Throws {
    param(
        [scriptblock]$Script,
        [string]$ExpectedText,
        [string]$Message
    )

    try {
        & $Script
    } catch {
        if ($_.Exception.Message.Contains($ExpectedText)) {
            return
        }
        throw "$Message Expected error containing '$ExpectedText', got '$($_.Exception.Message)'."
    }
    throw "$Message Expected an exception containing '$ExpectedText'."
}

function Invoke-TestGit {
    param(
        [string]$RepositoryRoot,
        [string[]]$Arguments
    )

    $oldErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& git -C $RepositoryRoot @Arguments 2>&1 | ForEach-Object { $_.ToString() })
        if ($LASTEXITCODE -ne 0) {
            throw "git $($Arguments -join ' ') failed: $($output -join "`n")"
        }
        return $output
    } finally {
        $ErrorActionPreference = $oldErrorActionPreference
    }
}

function New-TestInstallerRepo {
    $root = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("mobile edition installer repo " + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $root | Out-Null
    New-Item -ItemType Directory -Path (Join-Path -Path $root -ChildPath 'scripts') | Out-Null
    New-Item -ItemType Directory -Path (Join-Path -Path $root -ChildPath 'library') | Out-Null
    New-Item -ItemType Directory -Path (Join-Path -Path $root -ChildPath 'plugins\mobile_ui') | Out-Null
    New-Item -ItemType Directory -Path (Join-Path -Path $root -ChildPath 'setup-companion\src-tauri') | Out-Null

    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'Setup-MobileEdition.cmd') -Value '@echo off' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath '.env.example') -Value 'LIBRARY_PATH=./library' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'docker-compose.release.yml') -Value 'name: feedback-mobile-edition' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'LICENSE') -Value 'license placeholder' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'ATTRIBUTIONS.md') -Value '# Attributions' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'RELEASE-MANIFEST.md') -Value '# Manifest' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'scripts\Setup-MobileEdition.ps1') -Value 'Write-Output setup' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'scripts\Start-MobileEditionSetup.ps1') -Value 'Write-Output router' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'scripts\Test-MobileEditionSetup.ps1') -Value 'Write-Output doctor' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'library\.gitkeep') -Value '' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'plugins\mobile_ui\plugin.json') -Value '{"id":"mobile_ui"}' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'setup-companion\package-lock.json') -Value '{}' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'setup-companion\src-tauri\tauri.conf.json') -Value @'
{
  "$schema": "../node_modules/@tauri-apps/cli/config.schema.json",
  "productName": "fee[dB]ack Mobile Edition Setup Companion",
  "version": "0.1.0",
  "identifier": "com.saleemk.feedbackmobileedition.setupcompanion",
  "build": {
    "frontendDist": "../src",
    "beforeDevCommand": "",
    "beforeBuildCommand": ""
  },
  "app": {
    "withGlobalTauri": true,
    "windows": []
  },
  "bundle": {
    "active": true,
    "targets": "all"
  }
}
'@ -Encoding ASCII

    Invoke-TestGit -RepositoryRoot $root -Arguments @('init', '-q') | Out-Null
    Invoke-TestGit -RepositoryRoot $root -Arguments @('add', '.') | Out-Null
    Invoke-TestGit -RepositoryRoot $root -Arguments @('-c', 'user.name=Installer Test', '-c', 'user.email=installer@example.invalid', 'commit', '-q', '-m', 'fixture') | Out-Null

    [pscustomobject]@{
        root = $root
        version = 'v9.8.7-test'
        outputDirectory = Join-Path -Path $root -ChildPath 'artifacts\windows-installer'
    }
}

function Remove-TestInstallerRepo {
    param([object]$Fixture)

    $full = [System.IO.Path]::GetFullPath($Fixture.root)
    $temp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if (-not $full.StartsWith($temp, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove non-temp path $full"
    }
    if (Test-Path -LiteralPath $full) {
        Remove-Item -LiteralPath $full -Recurse -Force
    }
}

function New-FakeTauriBuilder {
    param([scriptblock]$Assertions)

    return {
        param(
            [string]$RepositoryRoot,
            [string]$CompanionRoot,
            [string]$ConfigPath,
            [string]$StagedEditionDirectory,
            [string]$Version
        )

        & $Assertions `
            -RepositoryRoot $RepositoryRoot `
            -CompanionRoot $CompanionRoot `
            -ConfigPath $ConfigPath `
            -StagedEditionDirectory $StagedEditionDirectory `
            -Version $Version

        $fakeOutput = Join-Path -Path $RepositoryRoot -ChildPath 'artifacts\fake-tauri-nsis-output.exe'
        New-Item -ItemType Directory -Path (Split-Path -Parent $fakeOutput) -Force | Out-Null
        Set-Content -LiteralPath $fakeOutput -Value 'fake nsis installer bytes' -Encoding ASCII
        return $fakeOutput
    }.GetNewClosure()
}

function Resolve-TestRelativePath {
    param(
        [string]$BaseDirectory,
        [string]$RelativePath
    )

    [System.IO.Path]::GetFullPath((Join-Path -Path $BaseDirectory -ChildPath $RelativePath))
}

Assert-Throws {
    ConvertTo-MobileEditionInstallerVersion -Version 'v9.8'
} 'semantic version' 'Installer versions should be semantic for Tauri metadata.'

$escapeFixture = New-TestInstallerRepo
try {
    $outsideOutput = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("mobile edition outside installer " + [guid]::NewGuid().ToString('N'))
    Assert-Throws {
        New-MobileEditionWindowsInstaller -Version $escapeFixture.version -RepositoryRoot $escapeFixture.root -OutputDirectory $outsideOutput -TauriBuilder (New-FakeTauriBuilder { })
    } 'Output directory must stay inside the repository artifact area' 'Installer output paths outside artifacts should be rejected.'
} finally {
    Remove-TestInstallerRepo -Fixture $escapeFixture
}

$dirtyFixture = New-TestInstallerRepo
try {
    Set-Content -LiteralPath (Join-Path -Path $dirtyFixture.root -ChildPath 'LICENSE') -Value 'dirty' -Encoding ASCII
    Assert-Throws {
        New-MobileEditionWindowsInstaller -Version $dirtyFixture.version -RepositoryRoot $dirtyFixture.root -TauriBuilder (New-FakeTauriBuilder { })
    } 'tracked working tree is dirty' 'Dirty tracked trees should be rejected before staging.'
} finally {
    Remove-TestInstallerRepo -Fixture $dirtyFixture
}

$privateFixture = New-TestInstallerRepo
try {
    Set-Content -LiteralPath (Join-Path -Path $privateFixture.root -ChildPath '.env') -Value 'secret=local' -Encoding ASCII
    New-Item -ItemType Directory -Path (Join-Path -Path $privateFixture.root -ChildPath 'node_modules') | Out-Null
    Set-Content -LiteralPath (Join-Path -Path $privateFixture.root -ChildPath 'node_modules\local.txt') -Value 'local dependency cache' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $privateFixture.root -ChildPath 'AI_HANDOFF.local.md') -Value 'local handoff' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $privateFixture.root -ChildPath 'library\song.mp3') -Value 'not really audio' -Encoding ASCII
    $script:capturedStaging = $null

    $result = New-MobileEditionWindowsInstaller `
        -Version $privateFixture.version `
        -RepositoryRoot $privateFixture.root `
        -TauriBuilder (New-FakeTauriBuilder {
            param(
                [string]$RepositoryRoot,
                [string]$CompanionRoot,
                [string]$ConfigPath,
                [string]$StagedEditionDirectory,
                [string]$Version
            )

            $script:capturedStaging = Split-Path -Parent (Split-Path -Parent $StagedEditionDirectory)
            Assert-True (Test-Path -LiteralPath (Join-Path -Path $StagedEditionDirectory -ChildPath 'scripts\Test-MobileEditionSetup.ps1') -PathType Leaf) 'Installer payload should include the setup doctor.'
            Assert-True (-not (Test-Path -LiteralPath (Join-Path -Path $StagedEditionDirectory -ChildPath '.env'))) 'Installer payload should not include untracked .env.'
            Assert-True (-not (Test-Path -LiteralPath (Join-Path -Path $StagedEditionDirectory -ChildPath 'AI_HANDOFF.local.md'))) 'Installer payload should not include local handoff files.'
            Assert-True (-not (Test-Path -LiteralPath (Join-Path -Path $StagedEditionDirectory -ChildPath 'node_modules\local.txt'))) 'Installer payload should not include untracked dependency caches.'
            Assert-True (-not (Test-Path -LiteralPath (Join-Path -Path $StagedEditionDirectory -ChildPath 'library\song.mp3'))) 'Installer payload should not include untracked library content.'

            $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
            Assert-Equal $config.productName 'fee[dB]ack Mobile Edition' 'Installed product name should be the Edition, not Setup Companion.'
            Assert-Equal $config.version '9.8.7-test' 'Build-only Tauri config should use semver without a leading v.'
            Assert-Equal $config.identifier 'com.saleemk.feedbackmobileedition' 'Installed bundle identifier should be stable for the Edition.'
            Assert-Equal $config.bundle.targets[0] 'nsis' 'Build-only Tauri config should target NSIS only.'
            $resource = @($config.bundle.resources.PSObject.Properties)[0]
            Assert-True (-not [System.IO.Path]::IsPathRooted($resource.Name)) 'Build-only Tauri config resource source should be relative.'
            Assert-True (-not ($resource.Name -match '^[A-Za-z]:')) 'Build-only Tauri config resource source should not include a drive letter.'
            $tauriBase = Join-Path -Path $RepositoryRoot -ChildPath 'setup-companion\src-tauri'
            Assert-Equal (Resolve-TestRelativePath -BaseDirectory $tauriBase -RelativePath $resource.Name) ([System.IO.Path]::GetFullPath($StagedEditionDirectory)) 'Build-only Tauri config resource source should resolve to the staged Edition directory from the Tauri base.'
            Assert-Equal $resource.Value 'edition' 'Build-only Tauri config should map resources under the stable edition directory.'
            Assert-Equal $config.bundle.windows.nsis.installMode 'currentUser' 'NSIS installer should install for the current user.'
            Assert-Equal $config.bundle.windows.nsis.languages[0] 'English' 'NSIS installer should use one English installer language.'
        })

    Assert-True (Test-Path -LiteralPath $result.installerPath -PathType Leaf) 'Versioned installer output should be copied to artifacts.'
    Assert-True (Test-Path -LiteralPath $result.checksumPath -PathType Leaf) 'Installer checksum sidecar should be written.'
    Assert-True $result.installerPath.EndsWith('feedback-mobile-edition-v9.8.7-test-windows-setup.exe') 'Installer filename should preserve the requested version and setup naming.'
    $expectedHead = (Invoke-TestGit -RepositoryRoot $privateFixture.root -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1)
    Assert-Equal $result.editionCommit $expectedHead 'Installer result should record the archived committed HEAD.'
    $checksum = Get-Content -LiteralPath $result.checksumPath -Raw
    Assert-True $checksum.Contains($result.installerSha256) 'Checksum sidecar should contain the installer SHA-256.'
    Assert-True $checksum.Contains((Split-Path -Leaf $result.installerPath)) 'Checksum sidecar should name the installer.'
    Assert-True (-not (Test-Path -LiteralPath $script:capturedStaging)) 'Temporary installer staging root should be removed after packaging.'
} finally {
    Remove-TestInstallerRepo -Fixture $privateFixture
}

$nsisSelectionFixture = New-TestInstallerRepo
try {
    $companionRoot = Join-Path -Path $nsisSelectionFixture.root -ChildPath 'setup-companion'
    $nsisDirectory = Get-MobileEditionNsisInstallerDirectory -CompanionRoot $companionRoot
    New-Item -ItemType Directory -Path $nsisDirectory -Force | Out-Null
    $staleOutput = Join-Path -Path $nsisDirectory -ChildPath 'stale-setup.exe'
    Set-Content -LiteralPath $staleOutput -Value 'stale installer bytes' -Encoding ASCII
    $beforeSnapshot = Get-MobileEditionInstallerExecutableSnapshot -NsisDirectory $nsisDirectory

    Assert-Throws {
        Resolve-MobileEditionFreshInstallerExecutable -NsisDirectory $nsisDirectory -BeforeSnapshot $beforeSnapshot
    } 'new or changed installer executable' 'NSIS output selection should reject an unchanged stale executable.'

    Start-Sleep -Milliseconds 1100
    Set-Content -LiteralPath $staleOutput -Value 'fresh installer bytes' -Encoding ASCII
    $changed = Resolve-MobileEditionFreshInstallerExecutable -NsisDirectory $nsisDirectory -BeforeSnapshot $beforeSnapshot
    Assert-Equal $changed $staleOutput 'NSIS output selection should accept a changed executable after the build.'

    $afterChangeSnapshot = Get-MobileEditionInstallerExecutableSnapshot -NsisDirectory $nsisDirectory
    Start-Sleep -Milliseconds 1100
    $newOutput = Join-Path -Path $nsisDirectory -ChildPath 'new-setup.exe'
    Set-Content -LiteralPath $newOutput -Value 'new installer bytes' -Encoding ASCII
    $new = Resolve-MobileEditionFreshInstallerExecutable -NsisDirectory $nsisDirectory -BeforeSnapshot $afterChangeSnapshot
    Assert-Equal $new $newOutput 'NSIS output selection should prefer a newly created executable.'
} finally {
    Remove-TestInstallerRepo -Fixture $nsisSelectionFixture
}

$trackedLibraryFixture = New-TestInstallerRepo
try {
    Set-Content -LiteralPath (Join-Path -Path $trackedLibraryFixture.root -ChildPath 'library\song.txt') -Value 'tracked song placeholder' -Encoding ASCII
    Invoke-TestGit -RepositoryRoot $trackedLibraryFixture.root -Arguments @('add', 'library/song.txt') | Out-Null
    Invoke-TestGit -RepositoryRoot $trackedLibraryFixture.root -Arguments @('-c', 'user.name=Installer Test', '-c', 'user.email=installer@example.invalid', 'commit', '-q', '-m', 'track library content') | Out-Null
    Assert-Throws {
        New-MobileEditionWindowsInstaller -Version $trackedLibraryFixture.version -RepositoryRoot $trackedLibraryFixture.root -TauriBuilder (New-FakeTauriBuilder { })
    } 'forbidden tracked paths' 'Tracked library content other than library/.gitkeep should be rejected.'
} finally {
    Remove-TestInstallerRepo -Fixture $trackedLibraryFixture
}

Write-Output 'Build-MobileEditionWindowsInstaller.Tests.ps1 passed.'
