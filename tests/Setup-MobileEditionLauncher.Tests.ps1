$ErrorActionPreference = 'Stop'

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
    Set-Content -LiteralPath (Join-Path -Path $scripts -ChildPath 'Setup-MobileEdition.ps1') -Value @'
param(
    [switch]$WhatIf,
    [string]$LibraryPath,
    [switch]$Fail,
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
exit 0
'@ -Encoding UTF8

    [pscustomobject]@{
        root = $root
        launcher = Join-Path -Path $root -ChildPath 'Setup-MobileEdition.cmd'
        setupScript = Join-Path -Path $scripts -ChildPath 'Setup-MobileEdition.ps1'
        capture = Join-Path -Path $root -ChildPath 'capture.txt'
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

$launcherSource = Get-Content -LiteralPath (Join-Path -Path (Split-Path -Parent $PSScriptRoot) -ChildPath 'Setup-MobileEdition.cmd') -Raw
Assert-True $launcherSource.Contains('set "SETUP_SCRIPT=%~dp0scripts\Setup-MobileEdition.ps1"') 'Launcher should resolve the setup script relative to itself.'
Assert-True $launcherSource.Contains('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SETUP_SCRIPT%" %*') 'Launcher should invoke Windows PowerShell with the documented flags and forward arguments.'
Assert-True $launcherSource.Contains('exit /b %SETUP_EXIT%') 'Launcher should return the setup script exit code.'
Assert-True $launcherSource.Contains('if not "%SETUP_EXIT%"=="0"') 'Launcher should branch on setup failure.'
Assert-True $launcherSource.Contains('pause') 'Launcher should keep the console open on failure.'

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

$repoRoot = Split-Path -Parent $PSScriptRoot
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
