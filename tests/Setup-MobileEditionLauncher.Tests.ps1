$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$routerPath = Join-Path -Path $repoRoot -ChildPath 'scripts\Start-MobileEditionSetup.ps1'
. $routerPath

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

function New-LauncherFixture {
    $root = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("mobile edition launcher test " + [guid]::NewGuid().ToString('N'))
    $scripts = Join-Path -Path $root -ChildPath 'scripts'
    New-Item -ItemType Directory -Path $scripts | Out-Null
    Copy-Item -LiteralPath (Join-Path -Path (Split-Path -Parent $PSScriptRoot) -ChildPath 'Setup-MobileEdition.cmd') -Destination (Join-Path -Path $root -ChildPath 'Setup-MobileEdition.cmd')
    Copy-Item -LiteralPath (Join-Path -Path (Split-Path -Parent $PSScriptRoot) -ChildPath 'scripts\Start-MobileEditionSetup.ps1') -Destination (Join-Path -Path $scripts -ChildPath 'Start-MobileEditionSetup.ps1')
    Set-Content -LiteralPath (Join-Path -Path $scripts -ChildPath 'Setup-MobileEdition.ps1') -Value @'
param(
    [switch]$WhatIf,
    [string]$LibraryPath,
    [switch]$Fail,
    [switch]$StreamProbe,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Remaining
)

$capture = $env:FEEDBACK_MOBILE_EDITION_LAUNCHER_CAPTURE
if ($capture) {
    Set-Content -LiteralPath $capture -Value @(
        "script=$PSCommandPath",
        "pshome=$PSHOME",
        "whatif=$WhatIf",
        "library=$LibraryPath",
        "remaining=$($Remaining -join '|')"
    ) -Encoding UTF8
}

if ($Fail) {
    exit 23
}
if ($StreamProbe) {
    Write-Output 'stream-probe-ready'
    Start-Sleep -Seconds 2
    exit 17
}
exit 0
'@ -Encoding UTF8

    [pscustomobject]@{
        root = $root
        launcher = Join-Path -Path $root -ChildPath 'Setup-MobileEdition.cmd'
        router = Join-Path -Path $scripts -ChildPath 'Start-MobileEditionSetup.ps1'
        setupScript = Join-Path -Path $scripts -ChildPath 'Setup-MobileEdition.ps1'
        capture = Join-Path -Path $root -ChildPath 'capture.txt'
    }
}

function New-RouterFixture {
    $root = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("mobile edition router test " + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $root | Out-Null
    [pscustomobject]@{
        root = $root
        setupScript = Join-Path -Path $root -ChildPath 'scripts\Setup-MobileEdition.ps1'
        candidates = Get-MobileEditionSetupCompanionCandidates -RepositoryRoot $root
    }
}

function Add-TestFile {
    param([string]$Path)

    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Set-Content -LiteralPath $Path -Value 'test executable placeholder' -Encoding UTF8
}

function Set-TestBinaryFile {
    param(
        [string]$Path,
        [string]$Content
    )

    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    [System.IO.File]::WriteAllBytes($Path, [System.Text.Encoding]::UTF8.GetBytes($Content))
}

function Get-TestFileSha256 {
    param([string]$Path)

    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function New-TestSha256 {
    param([string]$Content)

    $temporaryPath = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("mobile-edition-hash-" + [guid]::NewGuid().ToString('N'))
    try {
        Set-TestBinaryFile -Path $temporaryPath -Content $Content
        return Get-TestFileSha256 -Path $temporaryPath
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Set-BootstrapManifest {
    param(
        [string]$RepositoryRoot,
        [string]$Version,
        [string]$AssetUrl,
        [string]$Sha256
    )

    Set-Content -LiteralPath (Join-Path -Path $RepositoryRoot -ChildPath 'SETUP-COMPANION-BOOTSTRAP.json') -Value @"
{
  "schema": "feedback-mobile-edition.setup-companion-bootstrap.v1",
  "version": "$Version",
  "assetUrl": "$AssetUrl",
  "sha256": "$Sha256"
}
"@ -Encoding UTF8
}

function Set-BootstrapManifestRaw {
    param(
        [string]$RepositoryRoot,
        [string]$Content
    )

    Set-Content -LiteralPath (Join-Path -Path $RepositoryRoot -ChildPath 'SETUP-COMPANION-BOOTSTRAP.json') -Value $Content -Encoding UTF8
}

function Get-BootstrapTempFiles {
    param([string]$RepositoryRoot)

    $cacheDirectory = Join-Path -Path $RepositoryRoot -ChildPath '.setup-companion-bootstrap'
    if (-not (Test-Path -LiteralPath $cacheDirectory -PathType Container)) {
        return @()
    }

    return @(Get-ChildItem -LiteralPath $cacheDirectory -Filter '*.tmp' -File)
}

function Invoke-WithCapturedConsoleError {
    param([scriptblock]$Script)

    $originalError = [Console]::Error
    $writer = [System.IO.StringWriter]::new()
    try {
        [Console]::SetError($writer)
        $result = @(& $Script)
        [pscustomobject]@{
            result = $result
            error = $writer.ToString()
        }
    } finally {
        [Console]::SetError($originalError)
        $writer.Dispose()
    }
}

function Remove-LauncherFixture {
    param([string]$Root)

    $full = [System.IO.Path]::GetFullPath($Root)
    $temp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if (-not $full.StartsWith($temp, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove non-temp path $full"
    }
    if (Test-Path -LiteralPath $full) {
        Remove-Item -LiteralPath $full -Recurse -Force
    }
}

function Invoke-Launcher {
    param(
        [string]$Launcher,
        [string[]]$Arguments,
        [string]$CapturePath,
        [switch]$DisablePause
    )

    $oldCapture = $env:FEEDBACK_MOBILE_EDITION_LAUNCHER_CAPTURE
    $oldNoPause = $env:FEEDBACK_MOBILE_EDITION_NO_PAUSE
    $env:FEEDBACK_MOBILE_EDITION_LAUNCHER_CAPTURE = $CapturePath
    if ($DisablePause) {
        $env:FEEDBACK_MOBILE_EDITION_NO_PAUSE = '1'
    } else {
        Remove-Item Env:\FEEDBACK_MOBILE_EDITION_NO_PAUSE -ErrorAction SilentlyContinue
    }
    try {
        $output = @(& cmd.exe /d /c "`"$Launcher`" $($Arguments -join ' ')" 2>&1 | ForEach-Object { $_.ToString() })
        [pscustomobject]@{
            exitCode = $LASTEXITCODE
            output = ($output -join "`n")
        }
    } finally {
        if ($null -eq $oldCapture) {
            Remove-Item Env:\FEEDBACK_MOBILE_EDITION_LAUNCHER_CAPTURE -ErrorAction SilentlyContinue
        } else {
            $env:FEEDBACK_MOBILE_EDITION_LAUNCHER_CAPTURE = $oldCapture
        }
        if ($null -eq $oldNoPause) {
            Remove-Item Env:\FEEDBACK_MOBILE_EDITION_NO_PAUSE -ErrorAction SilentlyContinue
        } else {
            $env:FEEDBACK_MOBILE_EDITION_NO_PAUSE = $oldNoPause
        }
    }
}

$launcherSource = Get-Content -LiteralPath (Join-Path -Path $repoRoot -ChildPath 'Setup-MobileEdition.cmd') -Raw
Assert-True $launcherSource.Contains('set "SETUP_ROUTER=%~dp0scripts\Start-MobileEditionSetup.ps1"') 'Launcher should resolve the setup router relative to itself.'
Assert-True $launcherSource.Contains('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SETUP_ROUTER%" %*') 'Launcher should invoke Windows PowerShell with the documented flags and forward arguments.'
Assert-True $launcherSource.Contains('exit /b %SETUP_EXIT%') 'Launcher should return the setup script exit code.'
Assert-True $launcherSource.Contains('if not "%SETUP_EXIT%"=="0"') 'Launcher should branch on setup failure.'
Assert-True $launcherSource.Contains('pause') 'Launcher should keep the console open on failure.'

$precedenceFixture = New-RouterFixture
try {
    foreach ($candidate in $precedenceFixture.candidates) {
        Add-TestFile -Path $candidate
    }
    Set-BootstrapManifestRaw -RepositoryRoot $precedenceFixture.root -Content '{ invalid'

    $script:processCall = $null
    $script:downloadCalls = 0
    $exitCode = Invoke-MobileEditionSetupLauncher `
        -RepositoryRoot $precedenceFixture.root `
        -Arguments @() `
        -ProcessLauncher {
            param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
            $script:processCall = [pscustomobject]@{
                filePath = $FilePath
                arguments = @($Arguments)
                workingDirectory = $WorkingDirectory
            }
        } `
        -TerminalLauncher { throw 'Terminal setup should not run when the first companion candidate exists.' } `
        -BootstrapDownloader {
            $script:downloadCalls += 1
            throw 'Bootstrap downloader should not run when a local companion candidate exists.'
        }

    Assert-Equal $exitCode 0 'Visual launch should return success when a companion exists.'
    Assert-Equal $script:downloadCalls 0 'Root bundle executable should cause zero bootstrap download calls.'
    Assert-Equal $script:processCall.filePath $precedenceFixture.candidates[0] 'Router should prefer the root bundle executable first.'
    Assert-Equal $script:processCall.arguments.Count 2 'Router should pass exactly two companion arguments.'
    Assert-Equal $script:processCall.arguments[0] '--checkout' 'Router should pass the checkout flag first.'
    Assert-Equal $script:processCall.arguments[1] ([System.IO.Path]::GetFullPath($precedenceFixture.root)) 'Router should pass the repository root as one argument.'
    Assert-Equal $script:processCall.workingDirectory ([System.IO.Path]::GetFullPath($precedenceFixture.root)) 'Router should launch from the repository root.'
} finally {
    Remove-LauncherFixture -Root $precedenceFixture.root
}

$releaseFixture = New-RouterFixture
try {
    Add-TestFile -Path $releaseFixture.candidates[2]
    Add-TestFile -Path $releaseFixture.candidates[3]

    $script:releaseCall = $null
    $exitCode = Invoke-MobileEditionSetupLauncher `
        -RepositoryRoot $releaseFixture.root `
        -Arguments @() `
        -ProcessLauncher {
            param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
            $script:releaseCall = [pscustomobject]@{ filePath = $FilePath }
        } `
        -TerminalLauncher { throw 'Terminal setup should not run when a later companion candidate exists.' }

    Assert-Equal $exitCode 0 'Visual launch should return success for a later companion candidate.'
    Assert-Equal $script:releaseCall.filePath $releaseFixture.candidates[2] 'Router should prefer the release Tauri output before debug.'
} finally {
    Remove-LauncherFixture -Root $releaseFixture.root
}

$argumentFixture = New-RouterFixture
try {
    Add-TestFile -Path $argumentFixture.candidates[0]
    Set-BootstrapManifestRaw -RepositoryRoot $argumentFixture.root -Content '{ invalid'
    $script:terminalCall = $null
    $script:argumentDownloadCalls = 0
    $arguments = @('-WhatIf', '-LibraryPath', 'C:\Songs With Spaces', '-Extra', 'value with spaces')
    $exitCode = Invoke-MobileEditionSetupLauncher `
        -RepositoryRoot $argumentFixture.root `
        -Arguments $arguments `
        -ProcessLauncher { throw 'Visual companion should not run when arguments are supplied.' } `
        -TerminalLauncher {
            param([string]$SetupScript, [string[]]$Arguments)
            $script:terminalCall = [pscustomobject]@{
                setupScript = $SetupScript
                arguments = @($Arguments)
            }
            return 7
        } `
        -BootstrapDownloader {
            $script:argumentDownloadCalls += 1
            throw 'Bootstrap downloader should not run when arguments are supplied.'
        }

    Assert-Equal $exitCode 7 'Argument-bearing terminal fallback should preserve the terminal exit code.'
    Assert-Equal $script:argumentDownloadCalls 0 'Explicit arguments should cause zero bootstrap download calls.'
    Assert-Equal $script:terminalCall.setupScript $argumentFixture.setupScript 'Terminal fallback should target the setup script in the checkout.'
    Assert-Equal ($script:terminalCall.arguments -join '|') ($arguments -join '|') 'Terminal fallback should forward arguments exactly.'
} finally {
    Remove-LauncherFixture -Root $argumentFixture.root
}

$fallbackFixture = New-RouterFixture
try {
    $script:fallbackCall = $null
    $exitCode = Invoke-MobileEditionSetupLauncher `
        -RepositoryRoot $fallbackFixture.root `
        -Arguments @() `
        -ProcessLauncher { throw 'Visual companion should not run when no candidate exists.' } `
        -TerminalLauncher {
            param([string]$SetupScript, [string[]]$Arguments)
            $script:fallbackCall = [pscustomobject]@{
                setupScript = $SetupScript
                arguments = @($Arguments)
            }
            return 0
        }

    Assert-Equal $exitCode 0 'Missing companions should use the terminal setup fallback.'
    Assert-Equal $script:fallbackCall.setupScript $fallbackFixture.setupScript 'Missing companion fallback should target the setup script in the checkout.'
    Assert-Equal $script:fallbackCall.arguments.Count 0 'Missing companion fallback should not invent terminal arguments.'
} finally {
    Remove-LauncherFixture -Root $fallbackFixture.root
}

$strictManifestCases = @(
    [pscustomobject]@{ name = 'malformed JSON'; content = '{ invalid' },
    [pscustomobject]@{ name = 'duplicate property'; content = '{ "schema": "feedback-mobile-edition.setup-companion-bootstrap.v1", "schema": "feedback-mobile-edition.setup-companion-bootstrap.v1", "version": "1.2.3", "assetUrl": "https://example.com/releases/v1.2.3/Setup-MobileEdition.exe", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }' },
    [pscustomobject]@{ name = 'additional field'; content = '{ "schema": "feedback-mobile-edition.setup-companion-bootstrap.v1", "version": "1.2.3", "assetUrl": "https://example.com/releases/v1.2.3/Setup-MobileEdition.exe", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "extra": "nope" }' },
    [pscustomobject]@{ name = 'missing field'; content = '{ "schema": "feedback-mobile-edition.setup-companion-bootstrap.v1", "version": "1.2.3", "assetUrl": "https://example.com/releases/v1.2.3/Setup-MobileEdition.exe" }' },
    [pscustomobject]@{ name = 'wrong type'; content = '{ "schema": "feedback-mobile-edition.setup-companion-bootstrap.v1", "version": 123, "assetUrl": "https://example.com/releases/v1.2.3/Setup-MobileEdition.exe", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }' },
    [pscustomobject]@{ name = 'wrong schema'; content = '{ "schema": "feedback-mobile-edition.setup-companion-bootstrap.v2", "version": "1.2.3", "assetUrl": "https://example.com/releases/v1.2.3/Setup-MobileEdition.exe", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }' },
    [pscustomobject]@{ name = 'invalid version'; content = '{ "schema": "feedback-mobile-edition.setup-companion-bootstrap.v1", "version": "1.2 beta", "assetUrl": "https://example.com/releases/v1.2.3/Setup-MobileEdition.exe", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }' },
    [pscustomobject]@{ name = 'latest version'; content = '{ "schema": "feedback-mobile-edition.setup-companion-bootstrap.v1", "version": "latest", "assetUrl": "https://example.com/releases/v1.2.3/Setup-MobileEdition.exe", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }' },
    [pscustomobject]@{ name = 'HTTP URL'; content = '{ "schema": "feedback-mobile-edition.setup-companion-bootstrap.v1", "version": "1.2.3", "assetUrl": "http://example.com/releases/v1.2.3/Setup-MobileEdition.exe", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }' },
    [pscustomobject]@{ name = 'local URL'; content = '{ "schema": "feedback-mobile-edition.setup-companion-bootstrap.v1", "version": "1.2.3", "assetUrl": "file:///C:/Temp/Setup-MobileEdition.exe", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }' },
    [pscustomobject]@{ name = 'moving latest URL'; content = '{ "schema": "feedback-mobile-edition.setup-companion-bootstrap.v1", "version": "1.2.3", "assetUrl": "https://example.com/releases/latest/download/Setup-MobileEdition.exe", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }' },
    [pscustomobject]@{ name = 'invalid checksum'; content = '{ "schema": "feedback-mobile-edition.setup-companion-bootstrap.v1", "version": "1.2.3", "assetUrl": "https://example.com/releases/v1.2.3/Setup-MobileEdition.exe", "sha256": "not-a-sha" }' }
)

foreach ($case in $strictManifestCases) {
    $manifestFixture = New-RouterFixture
    try {
        Set-BootstrapManifestRaw -RepositoryRoot $manifestFixture.root -Content $case.content
        $script:manifestDownloadCalls = 0
        $script:manifestTerminalCalls = 0
        $capture = Invoke-WithCapturedConsoleError -Script {
            Invoke-MobileEditionSetupLauncher `
                -RepositoryRoot $manifestFixture.root `
                -Arguments @() `
                -ProcessLauncher { throw "Visual companion should not run for invalid manifest case $($case.name)." } `
                -TerminalLauncher {
                    $script:manifestTerminalCalls += 1
                    return 0
                } `
                -BootstrapDownloader {
                    $script:manifestDownloadCalls += 1
                    throw "Downloader should not run for invalid manifest case $($case.name)."
                }
        }

        Assert-Equal $capture.result[-1] 0 "Invalid manifest case '$($case.name)' should fall back successfully."
        Assert-Equal $script:manifestTerminalCalls 1 "Invalid manifest case '$($case.name)' should reach terminal fallback."
        Assert-Equal $script:manifestDownloadCalls 0 "Invalid manifest case '$($case.name)' should not download."
        Assert-True $capture.error.Contains('Falling back to terminal Guided Setup.') "Invalid manifest case '$($case.name)' should print a diagnostic."
    } finally {
        Remove-LauncherFixture -Root $manifestFixture.root
    }
}

$cachePreparationFixture = New-RouterFixture
try {
    $cachePreparationSha256 = New-TestSha256 -Content 'expected cache preparation bytes'
    Set-BootstrapManifest -RepositoryRoot $cachePreparationFixture.root -Version '1.2.2' -AssetUrl 'https://example.com/releases/v1.2.2/Setup-MobileEdition.exe' -Sha256 $cachePreparationSha256
    Set-TestBinaryFile -Path (Join-Path -Path $cachePreparationFixture.root -ChildPath '.setup-companion-bootstrap') -Content 'file occupying managed cache directory path'

    $script:cachePreparationDownloadCalls = 0
    $script:cachePreparationTerminalCalls = 0
    $capture = Invoke-WithCapturedConsoleError -Script {
        Invoke-MobileEditionSetupLauncher `
            -RepositoryRoot $cachePreparationFixture.root `
            -Arguments @() `
            -ProcessLauncher { throw 'Visual companion should not run when managed cache path cannot be prepared.' } `
            -TerminalLauncher {
                $script:cachePreparationTerminalCalls += 1
                return 0
            } `
            -BootstrapDownloader {
                $script:cachePreparationDownloadCalls += 1
                throw 'Downloader should not run when managed cache path cannot be prepared.'
            }
    }

    Assert-Equal $capture.result[-1] 0 'Cache path preparation failure should fall back successfully.'
    Assert-Equal $script:cachePreparationTerminalCalls 1 'Cache path preparation failure should reach terminal fallback.'
    Assert-Equal $script:cachePreparationDownloadCalls 0 'Cache path preparation failure should not download.'
    Assert-True $capture.error.Contains('Setup Companion bootstrap unavailable:') 'Cache path preparation failure should print a bootstrap diagnostic.'
    Assert-True $capture.error.Contains('Falling back to terminal Guided Setup.') 'Cache path preparation failure should report terminal fallback.'
} finally {
    Remove-LauncherFixture -Root $cachePreparationFixture.root
}

$cacheFixture = New-RouterFixture
try {
    $cachedContent = 'pre-populated managed cache bytes'
    $cachedSha256 = New-TestSha256 -Content $cachedContent
    Set-BootstrapManifest -RepositoryRoot $cacheFixture.root -Version '1.2.3' -AssetUrl 'https://example.com/releases/v1.2.3/Setup-MobileEdition.exe' -Sha256 $cachedSha256
    $cachePath = Get-MobileEditionSetupCompanionBootstrapCachePath -RepositoryRoot ([System.IO.Path]::GetFullPath($cacheFixture.root)) -Version '1.2.3' -Sha256 $cachedSha256
    Set-TestBinaryFile -Path $cachePath -Content $cachedContent

    $script:cacheDownloadCalls = 0
    $script:cacheProcessCall = $null
    $exitCode = Invoke-MobileEditionSetupLauncher `
        -RepositoryRoot $cacheFixture.root `
        -Arguments @() `
        -ProcessLauncher {
            param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
            $script:cacheProcessCall = [pscustomobject]@{
                filePath = $FilePath
                arguments = @($Arguments)
                workingDirectory = $WorkingDirectory
            }
        } `
        -TerminalLauncher { throw 'Terminal setup should not run when managed cache is valid.' } `
        -BootstrapDownloader {
            $script:cacheDownloadCalls += 1
            throw 'Downloader should not run when managed cache is valid.'
        }

    Assert-Equal $exitCode 0 'Valid managed cache should launch successfully.'
    Assert-Equal $script:cacheDownloadCalls 0 'Valid managed cache should not download.'
    Assert-Equal $script:cacheProcessCall.filePath $cachePath 'Valid managed cache should launch the cache path.'
    Assert-Equal $script:cacheProcessCall.arguments[0] '--checkout' 'Managed cache launch should pass checkout flag.'
    Assert-Equal $script:cacheProcessCall.arguments[1] ([System.IO.Path]::GetFullPath($cacheFixture.root)) 'Managed cache launch should pass checkout root.'
} finally {
    Remove-LauncherFixture -Root $cacheFixture.root
}

$corruptCacheFixture = New-RouterFixture
try {
    $replacementContent = 'replacement verified companion bytes'
    $replacementSha256 = New-TestSha256 -Content $replacementContent
    Set-BootstrapManifest -RepositoryRoot $corruptCacheFixture.root -Version '1.2.4' -AssetUrl 'https://example.com/releases/v1.2.4/Setup-MobileEdition.exe' -Sha256 $replacementSha256
    $corruptCachePath = Get-MobileEditionSetupCompanionBootstrapCachePath -RepositoryRoot ([System.IO.Path]::GetFullPath($corruptCacheFixture.root)) -Version '1.2.4' -Sha256 $replacementSha256
    Set-TestBinaryFile -Path $corruptCachePath -Content 'corrupt managed cache bytes'

    $script:corruptEvents = @()
    $exitCode = Invoke-MobileEditionSetupLauncher `
        -RepositoryRoot $corruptCacheFixture.root `
        -Arguments @() `
        -ProcessLauncher {
            param([string]$FilePath)
            $script:corruptEvents += ('launch:' + (Get-TestFileSha256 -Path $FilePath))
        } `
        -TerminalLauncher { throw 'Terminal setup should not run after corrupt cache is replaced.' } `
        -BootstrapDownloader {
            param([string]$AssetUrl, [string]$DestinationPath)
            $script:corruptEvents += 'download'
            Set-TestBinaryFile -Path $DestinationPath -Content $replacementContent
        }

    Assert-Equal $exitCode 0 'Corrupt managed cache should be replaced and launched.'
    Assert-Equal ($script:corruptEvents -join '|') ('download|launch:' + $replacementSha256) 'Corrupt cache should not be launched before a verified replacement.'
    Assert-Equal (Get-TestFileSha256 -Path $corruptCachePath) $replacementSha256 'Corrupt cache should be replaced by verified bytes.'
    Assert-Equal @(Get-BootstrapTempFiles -RepositoryRoot $corruptCacheFixture.root).Count 0 'Corrupt cache replacement should clean temporary files.'
} finally {
    Remove-LauncherFixture -Root $corruptCacheFixture.root
}

$freshDownloadFixture = New-RouterFixture
try {
    $downloadContent = 'fresh verified companion bytes'
    $downloadSha256 = New-TestSha256 -Content $downloadContent
    Set-BootstrapManifest -RepositoryRoot $freshDownloadFixture.root -Version '1.2.5' -AssetUrl 'https://example.com/releases/v1.2.5/Setup-MobileEdition.exe' -Sha256 $downloadSha256
    $freshCachePath = Get-MobileEditionSetupCompanionBootstrapCachePath -RepositoryRoot ([System.IO.Path]::GetFullPath($freshDownloadFixture.root)) -Version '1.2.5' -Sha256 $downloadSha256

    $script:freshDownloadCalls = 0
    $script:freshProcessCall = $null
    $exitCode = Invoke-MobileEditionSetupLauncher `
        -RepositoryRoot $freshDownloadFixture.root `
        -Arguments @() `
        -ProcessLauncher {
            param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
            $script:freshProcessCall = [pscustomobject]@{
                filePath = $FilePath
                arguments = @($Arguments)
                workingDirectory = $WorkingDirectory
            }
        } `
        -TerminalLauncher { throw 'Terminal setup should not run after a verified fresh download.' } `
        -BootstrapDownloader {
            param([string]$AssetUrl, [string]$DestinationPath)
            $script:freshDownloadCalls += 1
            Set-TestBinaryFile -Path $DestinationPath -Content $downloadContent
        }

    Assert-Equal $exitCode 0 'Fresh verified download should launch successfully.'
    Assert-Equal $script:freshDownloadCalls 1 'Fresh bootstrap should download once.'
    Assert-Equal $script:freshProcessCall.filePath $freshCachePath 'Fresh bootstrap should launch promoted cache path.'
    Assert-Equal $script:freshProcessCall.arguments[1] ([System.IO.Path]::GetFullPath($freshDownloadFixture.root)) 'Fresh bootstrap should pass checkout root.'
    Assert-True (Test-Path -LiteralPath $freshCachePath -PathType Leaf) 'Fresh bootstrap should promote verified bytes to the cache.'
    Assert-Equal (Get-TestFileSha256 -Path $freshCachePath) $downloadSha256 'Fresh bootstrap cache should match manifest checksum.'
    Assert-Equal @(Get-BootstrapTempFiles -RepositoryRoot $freshDownloadFixture.root).Count 0 'Fresh bootstrap should clean temporary files.'
} finally {
    Remove-LauncherFixture -Root $freshDownloadFixture.root
}

$hashMismatchFixture = New-RouterFixture
try {
    $expectedSha256 = New-TestSha256 -Content 'expected companion bytes'
    Set-BootstrapManifest -RepositoryRoot $hashMismatchFixture.root -Version '1.2.6' -AssetUrl 'https://example.com/releases/v1.2.6/Setup-MobileEdition.exe' -Sha256 $expectedSha256
    $hashMismatchCachePath = Get-MobileEditionSetupCompanionBootstrapCachePath -RepositoryRoot ([System.IO.Path]::GetFullPath($hashMismatchFixture.root)) -Version '1.2.6' -Sha256 $expectedSha256

    $script:hashMismatchTerminalCalls = 0
    $capture = Invoke-WithCapturedConsoleError -Script {
        Invoke-MobileEditionSetupLauncher `
            -RepositoryRoot $hashMismatchFixture.root `
            -Arguments @() `
            -ProcessLauncher { throw 'Visual companion should not run after checksum mismatch.' } `
            -TerminalLauncher {
                $script:hashMismatchTerminalCalls += 1
                return 0
            } `
            -BootstrapDownloader {
                param([string]$AssetUrl, [string]$DestinationPath)
                Set-TestBinaryFile -Path $DestinationPath -Content 'downloaded but wrong companion bytes'
            }
    }

    Assert-Equal $capture.result[-1] 0 'Checksum mismatch should fall back successfully.'
    Assert-Equal $script:hashMismatchTerminalCalls 1 'Checksum mismatch should reach terminal fallback.'
    Assert-True (-not (Test-Path -LiteralPath $hashMismatchCachePath -PathType Leaf)) 'Checksum mismatch should not promote downloaded bytes.'
    Assert-Equal @(Get-BootstrapTempFiles -RepositoryRoot $hashMismatchFixture.root).Count 0 'Checksum mismatch should clean temporary files.'
    Assert-True $capture.error.Contains('checksum') 'Checksum mismatch should print a checksum diagnostic.'
} finally {
    Remove-LauncherFixture -Root $hashMismatchFixture.root
}

$networkFailureFixture = New-RouterFixture
try {
    $networkExpectedSha256 = New-TestSha256 -Content 'expected network companion bytes'
    Set-BootstrapManifest -RepositoryRoot $networkFailureFixture.root -Version '1.2.7' -AssetUrl 'https://example.com/releases/v1.2.7/Setup-MobileEdition.exe' -Sha256 $networkExpectedSha256
    $networkFailureCachePath = Get-MobileEditionSetupCompanionBootstrapCachePath -RepositoryRoot ([System.IO.Path]::GetFullPath($networkFailureFixture.root)) -Version '1.2.7' -Sha256 $networkExpectedSha256

    $script:networkFailureTerminalCalls = 0
    $capture = Invoke-WithCapturedConsoleError -Script {
        Invoke-MobileEditionSetupLauncher `
            -RepositoryRoot $networkFailureFixture.root `
            -Arguments @() `
            -ProcessLauncher { throw 'Visual companion should not run after download failure.' } `
            -TerminalLauncher {
                $script:networkFailureTerminalCalls += 1
                return 0
            } `
            -BootstrapDownloader {
                param([string]$AssetUrl, [string]$DestinationPath)
                Set-TestBinaryFile -Path $DestinationPath -Content 'partial unverified companion bytes'
                throw 'simulated network failure'
            }
    }

    Assert-Equal $capture.result[-1] 0 'Download failure should fall back successfully.'
    Assert-Equal $script:networkFailureTerminalCalls 1 'Download failure should reach terminal fallback.'
    Assert-True (-not (Test-Path -LiteralPath $networkFailureCachePath -PathType Leaf)) 'Download failure should not promote partial bytes.'
    Assert-Equal @(Get-BootstrapTempFiles -RepositoryRoot $networkFailureFixture.root).Count 0 'Download failure should clean temporary files.'
    Assert-True $capture.error.Contains('simulated network failure') 'Download failure should print a diagnostic.'
} finally {
    Remove-LauncherFixture -Root $networkFailureFixture.root
}

$outsideBootstrapFixture = New-RouterFixture
try {
    $outsideDownloadContent = 'outside cwd verified companion bytes'
    $outsideDownloadSha256 = New-TestSha256 -Content $outsideDownloadContent
    Set-BootstrapManifest -RepositoryRoot $outsideBootstrapFixture.root -Version '1.2.8' -AssetUrl 'https://example.com/releases/v1.2.8/Setup-MobileEdition.exe' -Sha256 $outsideDownloadSha256

    $script:outsideBootstrapCall = $null
    Push-Location -LiteralPath ([System.IO.Path]::GetTempPath())
    try {
        $exitCode = Invoke-MobileEditionSetupLauncher `
            -RepositoryRoot $outsideBootstrapFixture.root `
            -Arguments @() `
            -ProcessLauncher {
                param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
                $script:outsideBootstrapCall = [pscustomobject]@{
                    filePath = $FilePath
                    checkout = $Arguments[1]
                    workingDirectory = $WorkingDirectory
                }
            } `
            -TerminalLauncher { throw 'Terminal setup should not run for bootstrapped companion from another cwd.' } `
            -BootstrapDownloader {
                param([string]$AssetUrl, [string]$DestinationPath)
                Set-TestBinaryFile -Path $DestinationPath -Content $outsideDownloadContent
            }
    } finally {
        Pop-Location
    }

    Assert-Equal $exitCode 0 'Bootstrap launch should work when invoked from outside the checkout.'
    Assert-Equal $script:outsideBootstrapCall.checkout ([System.IO.Path]::GetFullPath($outsideBootstrapFixture.root)) 'Bootstrap should pass the repository root from outside cwd.'
    Assert-Equal $script:outsideBootstrapCall.workingDirectory ([System.IO.Path]::GetFullPath($outsideBootstrapFixture.root)) 'Bootstrap should use the repository root working directory from outside cwd.'
    Assert-True $script:outsideBootstrapCall.filePath.StartsWith((Join-Path -Path ([System.IO.Path]::GetFullPath($outsideBootstrapFixture.root)) -ChildPath '.setup-companion-bootstrap'), [System.StringComparison]::OrdinalIgnoreCase) 'Bootstrap should launch from the checkout-relative managed cache.'
} finally {
    Remove-LauncherFixture -Root $outsideBootstrapFixture.root
}

$failureFixture = New-RouterFixture
try {
    Add-TestFile -Path $failureFixture.candidates[0]
    $script:failureFallbackCalled = $false
    $exitCode = Invoke-MobileEditionSetupLauncher `
        -RepositoryRoot $failureFixture.root `
        -Arguments @() `
        -ProcessLauncher { throw 'simulated launch failure' } `
        -TerminalLauncher {
            $script:failureFallbackCalled = $true
            return 0
        }

    Assert-Equal $exitCode 1 'GUI launch failure should return a nonzero exit code.'
    Assert-True (-not $script:failureFallbackCalled) 'GUI launch failure should not fall through to terminal setup.'
} finally {
    Remove-LauncherFixture -Root $failureFixture.root
}

$outsideFixture = New-RouterFixture
try {
    Add-TestFile -Path $outsideFixture.candidates[1]
    $script:outsideCall = $null
    Push-Location -LiteralPath ([System.IO.Path]::GetTempPath())
    try {
        $exitCode = Invoke-MobileEditionSetupLauncher `
            -RepositoryRoot $outsideFixture.root `
            -Arguments @() `
            -ProcessLauncher {
                param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
                $script:outsideCall = [pscustomobject]@{
                    filePath = $FilePath
                    checkout = $Arguments[1]
                    workingDirectory = $WorkingDirectory
                }
            } `
            -TerminalLauncher { throw 'Terminal setup should not run for a checkout-relative companion from another cwd.' }
    } finally {
        Pop-Location
    }

    Assert-Equal $exitCode 0 'Visual launch should work when invoked from outside the checkout.'
    Assert-Equal $script:outsideCall.filePath $outsideFixture.candidates[1] 'Router should resolve candidates relative to the repository root, not cwd.'
    Assert-Equal $script:outsideCall.checkout ([System.IO.Path]::GetFullPath($outsideFixture.root)) 'Router should pass the repository root from outside cwd.'
    Assert-Equal $script:outsideCall.workingDirectory ([System.IO.Path]::GetFullPath($outsideFixture.root)) 'Router should use the repository root working directory from outside cwd.'
} finally {
    Remove-LauncherFixture -Root $outsideFixture.root
}

$fixture = New-LauncherFixture
try {
    Push-Location -LiteralPath ([System.IO.Path]::GetTempPath())
    try {
        $success = Invoke-Launcher -Launcher $fixture.launcher -Arguments @('-WhatIf', '-LibraryPath', '"C:\Songs With Spaces"', '-Extra', '"value with spaces"') -CapturePath $fixture.capture
    } finally {
        Pop-Location
    }

    Assert-Equal $success.exitCode 0 'Launcher should preserve a successful setup exit code.'
    Assert-True (-not $success.output.Contains('Press any key')) 'Launcher should not pause after success.'
    $capture = Get-Content -LiteralPath $fixture.capture
    Assert-Equal $capture[0] "script=$($fixture.setupScript)" 'Launcher should target the setup script beside itself, not the caller directory.'
    Assert-True ($capture[1] -match 'WindowsPowerShell') 'Launcher should invoke Windows PowerShell.'
    Assert-Equal $capture[2] 'whatif=True' 'Launcher should forward -WhatIf.'
    Assert-Equal $capture[3] 'library=C:\Songs With Spaces' 'Launcher should forward quoted argument values.'
    Assert-Equal $capture[4] 'remaining=-Extra|value with spaces' 'Launcher should forward remaining arguments.'
} finally {
    Remove-LauncherFixture -Root $fixture.root
}

$failureFixture = New-LauncherFixture
try {
    $failure = Invoke-Launcher -Launcher $failureFixture.launcher -Arguments @('-Fail') -CapturePath $failureFixture.capture -DisablePause
    Assert-Equal $failure.exitCode 23 'Launcher should preserve a failing setup exit code.'
    Assert-True $failure.output.Contains('Setup failed with exit code 23.') 'Launcher should print the failing exit code.'
} finally {
    Remove-LauncherFixture -Root $failureFixture.root
}

$streamFixture = New-LauncherFixture
try {
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = 'cmd.exe'
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    $startInfo.Arguments = "/d /c `"`"$($streamFixture.launcher)`" -StreamProbe`""
    $startInfo.EnvironmentVariables['FEEDBACK_MOBILE_EDITION_NO_PAUSE'] = '1'

    $process = [System.Diagnostics.Process]::Start($startInfo)
    Assert-True ($null -ne $process) 'Streaming regression test should start the launcher process.'
    $firstLine = $process.StandardOutput.ReadLineAsync()
    Assert-True $firstLine.Wait(1500) 'Terminal fallback should stream setup output before the child exits.'
    Assert-Equal $firstLine.Result 'stream-probe-ready' 'Terminal fallback should expose the setup output line directly.'
    Assert-True (-not $process.HasExited) 'Terminal fallback should not wait for child exit before exposing setup output.'
    Assert-True $process.WaitForExit(5000) 'Streaming regression test launcher process should exit.'
    $remainingOutput = $process.StandardOutput.ReadToEnd()
    $remainingError = $process.StandardError.ReadToEnd()
    Assert-Equal $process.ExitCode 17 'Terminal fallback should preserve the child setup exit code.'
    Assert-True $remainingOutput.Contains('Setup failed with exit code 17.') 'Launcher should still print the failing terminal exit code.'
    Assert-Equal $remainingError '' 'Streaming regression test should not emit stderr.'
} finally {
    Remove-LauncherFixture -Root $streamFixture.root
}

$realLauncher = Join-Path -Path $repoRoot -ChildPath 'Setup-MobileEdition.cmd'
$missingLibrary = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("missing-mobile-edition-library-" + [guid]::NewGuid().ToString('N'))
Push-Location -LiteralPath ([System.IO.Path]::GetTempPath())
try {
    $whatIfOutput = @(& cmd.exe /d /c "`"$realLauncher`" -WhatIf -LibraryPath `"$missingLibrary`"" 2>&1 | ForEach-Object { $_.ToString() })
    Assert-Equal $LASTEXITCODE 0 'Launcher -WhatIf should exit successfully for preview output.'
    $whatIfText = $whatIfOutput -join "`n"
    Assert-True $whatIfText.Contains('Mobile Edition Guided Setup') 'Launcher -WhatIf should reach Guided Setup.'
    Assert-True $whatIfText.Contains('What if: would stop before changing .env') 'Launcher -WhatIf should preview without mutating host state.'
} finally {
    Pop-Location
}

Write-Output 'Setup-MobileEditionLauncher.Tests.ps1 passed.'
