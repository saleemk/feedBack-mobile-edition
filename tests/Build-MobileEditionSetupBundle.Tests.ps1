$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path -Path $repoRoot -ChildPath 'scripts\Build-MobileEditionSetupBundle.ps1')

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

    $output = @(& git -C $RepositoryRoot @Arguments 2>&1 | ForEach-Object { $_.ToString() })
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed: $($output -join "`n")"
    }
    return $output
}

function New-TestBundleRepo {
    $root = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("mobile edition bundle repo " + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $root | Out-Null
    New-Item -ItemType Directory -Path (Join-Path -Path $root -ChildPath 'scripts') | Out-Null
    New-Item -ItemType Directory -Path (Join-Path -Path $root -ChildPath 'library') | Out-Null
    New-Item -ItemType Directory -Path (Join-Path -Path $root -ChildPath 'plugins\mobile_ui') | Out-Null

    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'Setup-MobileEdition.cmd') -Value '@echo off' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath '.env.example') -Value 'LIBRARY_PATH=./library' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'docker-compose.release.yml') -Value 'services: {}' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'LICENSE') -Value 'license placeholder' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'ATTRIBUTIONS.md') -Value '# Attributions' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'RELEASE-MANIFEST.md') -Value '# Manifest' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'scripts\Setup-MobileEdition.ps1') -Value 'Write-Output setup' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'scripts\Start-MobileEditionSetup.ps1') -Value 'Write-Output router' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'library\.gitkeep') -Value '' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'server.py') -Value 'print("fixture")' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath 'plugins\mobile_ui\plugin.json') -Value '{"id":"mobile_ui"}' -Encoding ASCII

    Invoke-TestGit -RepositoryRoot $root -Arguments @('init', '-q') | Out-Null
    Invoke-TestGit -RepositoryRoot $root -Arguments @('add', '.') | Out-Null
    Invoke-TestGit -RepositoryRoot $root -Arguments @('-c', 'user.name=Bundle Test', '-c', 'user.email=bundle@example.invalid', 'commit', '-q', '-m', 'fixture') | Out-Null

    $companionDirectory = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("mobile edition companion exe " + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $companionDirectory | Out-Null
    $companion = Join-Path -Path $companionDirectory -ChildPath 'feedback-mobile-edition-setup-companion.exe'
    Set-Content -LiteralPath $companion -Value 'fake companion bytes' -Encoding ASCII

    [pscustomobject]@{
        root = $root
        companionDirectory = $companionDirectory
        companion = $companion
        version = 'v9.8.7-test'
        topLevel = 'feedback-mobile-edition-v9.8.7-test'
        outputDirectory = Join-Path -Path $root -ChildPath 'artifacts\setup-bundles'
    }
}

function Remove-TestBundleRepo {
    param([object]$Fixture)

    foreach ($path in @($Fixture.root, $Fixture.companionDirectory)) {
        $full = [System.IO.Path]::GetFullPath($path)
        $temp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        if (-not $full.StartsWith($temp, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove non-temp path $full"
        }
        if (Test-Path -LiteralPath $full) {
            Remove-Item -LiteralPath $full -Recurse -Force
        }
    }
}

function Get-ZipEntries {
    param([string]$ZipPath)

    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        return @($zip.Entries | ForEach-Object { $_.FullName })
    } finally {
        $zip.Dispose()
    }
}

function Read-ZipEntryText {
    param(
        [string]$ZipPath,
        [string]$EntryName
    )

    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $entry = $zip.GetEntry($EntryName)
        if ($null -eq $entry) {
            throw "Zip entry not found: $EntryName"
        }
        $reader = [System.IO.StreamReader]::new($entry.Open())
        try {
            return $reader.ReadToEnd()
        } finally {
            $reader.Dispose()
        }
    } finally {
        $zip.Dispose()
    }
}

function New-TestDirectory {
    param([string]$Prefix)

    Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ($Prefix + [guid]::NewGuid().ToString('N'))
}

function Remove-TestDirectory {
    param([string]$Path)

    $full = [System.IO.Path]::GetFullPath($Path)
    $temp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if (-not $full.StartsWith($temp, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove non-temp path $full"
    }
    if (Test-Path -LiteralPath $full) {
        Remove-Item -LiteralPath $full -Recurse -Force
    }
}

Assert-Throws { New-MobileEditionSetupBundle -Version '../bad' -RepositoryRoot $repoRoot -PrebuiltCompanionPath $repoRoot } 'Version must be' 'Unsafe version strings should be rejected.'

$missingCommand = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("missing-mobile-edition-command-" + [guid]::NewGuid().ToString('N') + '.cmd')
Assert-Throws {
    Invoke-MobileEditionBundleCommand -FilePath $missingCommand -Arguments @('ci') -WorkingDirectory $repoRoot -Description 'Missing command probe'
} 'failed to start or complete' 'Missing external command launches should throw rather than relying on stale LASTEXITCODE.'

$buildFixtureRoot = New-TestDirectory -Prefix 'mobile edition default build '
$fakeBin = New-TestDirectory -Prefix 'mobile edition fake npm '
try {
    $companionRoot = Join-Path -Path $buildFixtureRoot -ChildPath 'setup-companion'
    New-Item -ItemType Directory -Path $companionRoot | Out-Null
    New-Item -ItemType Directory -Path $fakeBin | Out-Null
    Set-Content -LiteralPath (Join-Path -Path $companionRoot -ChildPath 'package-lock.json') -Value '{}' -Encoding ASCII
    $commandLog = Join-Path -Path $buildFixtureRoot -ChildPath 'commands.log'
    Set-Content -LiteralPath (Join-Path -Path $fakeBin -ChildPath 'npm.cmd') -Value @'
@echo off
echo npm %*>>"%MOBILE_EDITION_BUNDLE_COMMAND_LOG%"
mkdir node_modules\.bin >nul 2>nul
(
echo @echo off
echo echo tauri %%*^>^>"%%MOBILE_EDITION_BUNDLE_COMMAND_LOG%%"
echo mkdir src-tauri\target\release ^>nul 2^>nul
echo echo fake exe^>src-tauri\target\release\feedback-mobile-edition-setup-companion.exe
echo exit /b 0
) > node_modules\.bin\tauri.cmd
exit /b 0
'@ -Encoding ASCII

    $oldPath = $env:PATH
    $oldCommandLog = $env:MOBILE_EDITION_BUNDLE_COMMAND_LOG
    $env:PATH = "$fakeBin;$oldPath"
    $env:MOBILE_EDITION_BUNDLE_COMMAND_LOG = $commandLog
    try {
        $builtCompanion = Invoke-MobileEditionSetupCompanionReleaseBuild -RepositoryRoot $buildFixtureRoot
    } finally {
        $env:PATH = $oldPath
        if ($null -eq $oldCommandLog) {
            Remove-Item Env:\MOBILE_EDITION_BUNDLE_COMMAND_LOG -ErrorAction SilentlyContinue
        } else {
            $env:MOBILE_EDITION_BUNDLE_COMMAND_LOG = $oldCommandLog
        }
    }

    Assert-True (Test-Path -LiteralPath $builtCompanion -PathType Leaf) 'Default companion build should return the built executable path.'
    $commands = Get-Content -LiteralPath $commandLog
    Assert-Equal $commands[0] 'npm ci' 'Default companion build should install locked npm dependencies first.'
    Assert-Equal $commands[1] 'tauri build --no-bundle' 'Default companion build should run the release no-bundle Tauri build after npm ci.'
} finally {
    Remove-TestDirectory -Path $buildFixtureRoot
    Remove-TestDirectory -Path $fakeBin
}

$escapeFixture = New-TestBundleRepo
try {
    $outsideOutput = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("mobile edition outside output " + [guid]::NewGuid().ToString('N'))
    Assert-Throws {
        New-MobileEditionSetupBundle -Version $escapeFixture.version -RepositoryRoot $escapeFixture.root -OutputDirectory $outsideOutput -PrebuiltCompanionPath $escapeFixture.companion
    } 'Output directory must stay inside the repository artifact area' 'Output paths outside the artifact directory should be rejected.'
} finally {
    Remove-TestBundleRepo -Fixture $escapeFixture
}

$dirtyFixture = New-TestBundleRepo
try {
    Set-Content -LiteralPath (Join-Path -Path $dirtyFixture.root -ChildPath 'LICENSE') -Value 'dirty' -Encoding ASCII
    Assert-Throws {
        New-MobileEditionSetupBundle -Version $dirtyFixture.version -RepositoryRoot $dirtyFixture.root -PrebuiltCompanionPath $dirtyFixture.companion
    } 'tracked working tree is dirty' 'Dirty tracked trees should be rejected.'
} finally {
    Remove-TestBundleRepo -Fixture $dirtyFixture
}

$libraryFixture = New-TestBundleRepo
try {
    Set-Content -LiteralPath (Join-Path -Path $libraryFixture.root -ChildPath 'library\song.txt') -Value 'tracked song placeholder' -Encoding ASCII
    Invoke-TestGit -RepositoryRoot $libraryFixture.root -Arguments @('add', 'library/song.txt') | Out-Null
    Invoke-TestGit -RepositoryRoot $libraryFixture.root -Arguments @('-c', 'user.name=Bundle Test', '-c', 'user.email=bundle@example.invalid', 'commit', '-q', '-m', 'track library content') | Out-Null
    Assert-Throws {
        New-MobileEditionSetupBundle -Version $libraryFixture.version -RepositoryRoot $libraryFixture.root -PrebuiltCompanionPath $libraryFixture.companion
    } 'forbidden tracked paths' 'Tracked library content other than library/.gitkeep should be rejected.'
} finally {
    Remove-TestBundleRepo -Fixture $libraryFixture
}

$postBuildDirtyFixture = New-TestBundleRepo
try {
    Assert-Throws {
        New-MobileEditionSetupBundle `
            -Version $postBuildDirtyFixture.version `
            -RepositoryRoot $postBuildDirtyFixture.root `
            -CompanionBuilder {
                param([string]$RepositoryRoot)
                Set-Content -LiteralPath (Join-Path -Path $RepositoryRoot -ChildPath 'LICENSE') -Value 'dirty after build' -Encoding ASCII
                return $postBuildDirtyFixture.companion
            }
    } 'tracked working tree is dirty' 'Tracked tree drift after companion build should be rejected before archive.'
    Assert-True (-not (Test-Path -LiteralPath $postBuildDirtyFixture.outputDirectory)) 'Post-build dirty rejection should not create bundle artifacts.'
} finally {
    Remove-TestBundleRepo -Fixture $postBuildDirtyFixture
}

$postBuildHeadFixture = New-TestBundleRepo
try {
    $originalHead = (Invoke-TestGit -RepositoryRoot $postBuildHeadFixture.root -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1)
    Assert-Throws {
        New-MobileEditionSetupBundle `
            -Version $postBuildHeadFixture.version `
            -RepositoryRoot $postBuildHeadFixture.root `
            -CompanionBuilder {
                param([string]$RepositoryRoot)
                Set-Content -LiteralPath (Join-Path -Path $RepositoryRoot -ChildPath 'RELEASE-MANIFEST.md') -Value '# Manifest changed after build' -Encoding ASCII
                Invoke-TestGit -RepositoryRoot $RepositoryRoot -Arguments @('add', 'RELEASE-MANIFEST.md') | Out-Null
                Invoke-TestGit -RepositoryRoot $RepositoryRoot -Arguments @('-c', 'user.name=Bundle Test', '-c', 'user.email=bundle@example.invalid', 'commit', '-q', '-m', 'move head after build') | Out-Null
                return $postBuildHeadFixture.companion
            }
    } 'HEAD changed during companion build' 'Moved HEAD after companion build should be rejected before archive.'
    $currentHead = (Invoke-TestGit -RepositoryRoot $postBuildHeadFixture.root -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1)
    Assert-True ($currentHead -ne $originalHead) 'Moved HEAD test fixture should actually move HEAD.'
    Assert-True (-not (Test-Path -LiteralPath $postBuildHeadFixture.outputDirectory)) 'Post-build HEAD drift rejection should not create bundle artifacts.'
} finally {
    Remove-TestBundleRepo -Fixture $postBuildHeadFixture
}

$bundleFixture = New-TestBundleRepo
try {
    Set-Content -LiteralPath (Join-Path -Path $bundleFixture.root -ChildPath '.env') -Value 'secret=local' -Encoding ASCII
    New-Item -ItemType Directory -Path (Join-Path -Path $bundleFixture.root -ChildPath 'node_modules') | Out-Null
    Set-Content -LiteralPath (Join-Path -Path $bundleFixture.root -ChildPath 'node_modules\local.txt') -Value 'local' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $bundleFixture.root -ChildPath 'AI_HANDOFF.local.md') -Value 'local handoff' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path -Path $bundleFixture.root -ChildPath 'untracked-live-file.txt') -Value 'live only' -Encoding ASCII

    $script:builderCalled = $false
    Push-Location -LiteralPath ([System.IO.Path]::GetTempPath())
    try {
        $result = New-MobileEditionSetupBundle `
            -Version $bundleFixture.version `
            -RepositoryRoot $bundleFixture.root `
            -PrebuiltCompanionPath $bundleFixture.companion `
            -CompanionBuilder {
                $script:builderCalled = $true
                throw 'Real companion build should not run when a prebuilt companion path is supplied.'
            }
    } finally {
        Pop-Location
    }

    Assert-True (-not $script:builderCalled) 'Explicit prebuilt companion input should avoid the real Rust/Tauri build.'
    Assert-True (Test-Path -LiteralPath $result.zipPath -PathType Leaf) 'Bundle zip should be created.'
    Assert-True (Test-Path -LiteralPath $result.checksumPath -PathType Leaf) 'Bundle checksum file should be created.'
    Assert-True (-not (Test-Path -LiteralPath $result.stagingRoot)) 'Temporary staging root should be removed after packaging.'

    $entries = Get-ZipEntries -ZipPath $result.zipPath
    $topLevels = @($entries | ForEach-Object { ($_ -split '/')[0] } | Where-Object { $_ } | Sort-Object -Unique)
    Assert-Equal $topLevels.Count 1 'Bundle zip should contain exactly one top-level directory.'
    Assert-Equal $topLevels[0] $bundleFixture.topLevel 'Bundle top-level directory should be predictable from the version.'

    foreach ($required in @(
            'Setup-MobileEdition.cmd',
            'Setup-MobileEdition.exe',
            '.env.example',
            'docker-compose.release.yml',
            'LICENSE',
            'ATTRIBUTIONS.md',
            'RELEASE-MANIFEST.md',
            'scripts/Setup-MobileEdition.ps1',
            'scripts/Start-MobileEditionSetup.ps1',
            'library/.gitkeep',
            'plugins/mobile_ui/plugin.json',
            'SETUP-BUNDLE-MANIFEST.json'
        )) {
        Assert-True ($entries -contains "$($bundleFixture.topLevel)/$required") "Bundle should contain $required."
    }

    foreach ($forbidden in @(
            '.git/config',
            '.env',
            'AI_HANDOFF.local.md',
            'node_modules/local.txt',
            'untracked-live-file.txt'
        )) {
        Assert-True (-not ($entries -contains "$($bundleFixture.topLevel)/$forbidden")) "Bundle should not contain $forbidden."
    }

    $manifest = Read-ZipEntryText -ZipPath $result.zipPath -EntryName "$($bundleFixture.topLevel)/SETUP-BUNDLE-MANIFEST.json" | ConvertFrom-Json
    $expectedHead = (Invoke-TestGit -RepositoryRoot $bundleFixture.root -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1)
    $expectedCompanionHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $bundleFixture.companion).Hash.ToLowerInvariant()
    Assert-Equal $manifest.schema 'feedback-mobile-edition.setup-bundle.v1' 'Bundle manifest should record the schema identity.'
    Assert-Equal $manifest.bundleFormat 'zip' 'Bundle manifest should record the bundle format.'
    Assert-Equal $manifest.editionVersion $bundleFixture.version 'Bundle manifest should record the Edition version.'
    Assert-Equal $manifest.editionCommit $expectedHead 'Bundle manifest should record the exact Edition HEAD commit.'
    Assert-Equal $manifest.companionSha256 $expectedCompanionHash 'Bundle manifest should record the companion executable SHA-256.'
    Assert-Equal $result.companionSha256 $expectedCompanionHash 'Result should report the companion executable SHA-256.'

    $checksum = Get-Content -LiteralPath $result.checksumPath -Raw
    Assert-True $checksum.Contains($result.zipSha256) 'Checksum file should contain the zip SHA-256.'
    Assert-True $checksum.Contains((Split-Path -Leaf $result.zipPath)) 'Checksum file should name the zip.'

    Assert-Throws {
        New-MobileEditionSetupBundle -Version $bundleFixture.version -RepositoryRoot $bundleFixture.root -PrebuiltCompanionPath $bundleFixture.companion
    } 'Refusing to overwrite existing setup bundle' 'Existing artifacts should be refused without -Force.'

    $forced = New-MobileEditionSetupBundle -Version $bundleFixture.version -RepositoryRoot $bundleFixture.root -PrebuiltCompanionPath $bundleFixture.companion -Force
    Assert-True (Test-Path -LiteralPath $forced.zipPath -PathType Leaf) 'Explicit -Force should overwrite the existing bundle.'
} finally {
    Remove-TestBundleRepo -Fixture $bundleFixture
}

Write-Output 'Build-MobileEditionSetupBundle.Tests.ps1 passed.'
