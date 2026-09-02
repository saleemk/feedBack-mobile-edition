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

    $script:processCall = $null
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
        -TerminalLauncher { throw 'Terminal setup should not run when the first companion candidate exists.' }

    Assert-Equal $exitCode 0 'Visual launch should return success when a companion exists.'
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
    $script:terminalCall = $null
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
        }

    Assert-Equal $exitCode 7 'Argument-bearing terminal fallback should preserve the terminal exit code.'
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
