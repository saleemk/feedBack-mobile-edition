param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$LauncherArguments
)

Set-StrictMode -Version 2.0

function ConvertTo-MobileEditionProcessArgument {
    param([string]$Argument)

    if ($null -eq $Argument) {
        return '""'
    }
    if ($Argument.Length -gt 0 -and $Argument -notmatch '[\s"]') {
        return $Argument
    }

    $result = '"'
    $backslashes = 0
    foreach ($character in $Argument.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes += 1
            continue
        }
        if ($character -eq '"') {
            $result += ('\' * ($backslashes * 2 + 1))
            $result += '"'
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) {
            $result += ('\' * $backslashes)
            $backslashes = 0
        }
        $result += $character
    }
    if ($backslashes -gt 0) {
        $result += ('\' * ($backslashes * 2))
    }
    $result += '"'
    return $result
}

function Join-MobileEditionProcessArguments {
    param([string[]]$Arguments)

    (@($Arguments) | ForEach-Object { ConvertTo-MobileEditionProcessArgument -Argument $_ }) -join ' '
}

function Get-MobileEditionSetupCompanionCandidates {
    param([string]$RepositoryRoot)

    @(
        (Join-Path -Path $RepositoryRoot -ChildPath 'Setup-MobileEdition.exe'),
        (Join-Path -Path $RepositoryRoot -ChildPath 'setup-companion\bin\feedback-mobile-edition-setup-companion.exe'),
        (Join-Path -Path $RepositoryRoot -ChildPath 'setup-companion\src-tauri\target\release\feedback-mobile-edition-setup-companion.exe'),
        (Join-Path -Path $RepositoryRoot -ChildPath 'setup-companion\src-tauri\target\debug\feedback-mobile-edition-setup-companion.exe')
    )
}

function Invoke-MobileEditionSetupCompanion {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.Arguments = Join-MobileEditionProcessArguments -Arguments $Arguments

    $process = [System.Diagnostics.Process]::Start($startInfo)
    if ($null -eq $process) {
        throw "Process launch returned no process for $FilePath"
    }
}

function Invoke-MobileEditionSetupScript {
    param(
        [string]$SetupScript,
        [string[]]$Arguments
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = 'powershell.exe'
    $startInfo.UseShellExecute = $false
    $startInfo.Arguments = Join-MobileEditionProcessArguments -Arguments (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $SetupScript) + @($Arguments))

    $process = [System.Diagnostics.Process]::Start($startInfo)
    if ($null -eq $process) {
        throw "Terminal setup launch returned no process for $SetupScript"
    }

    $process.WaitForExit()
    return $process.ExitCode
}

function Invoke-MobileEditionTerminalLauncher {
    param(
        [string]$SetupScript,
        [string[]]$Arguments,
        [scriptblock]$TerminalLauncher
    )

    $output = @(& $TerminalLauncher -SetupScript $SetupScript -Arguments $Arguments)
    if ($output.Count -eq 0) {
        return 0
    }

    $exitCode = $output[-1]
    if ($exitCode -is [int]) {
        return $exitCode
    }

    return 0
}

function Invoke-MobileEditionSetupLauncher {
    param(
        [string]$RepositoryRoot,
        [string[]]$Arguments = @(),
        [scriptblock]$ProcessLauncher = ${function:Invoke-MobileEditionSetupCompanion},
        [scriptblock]$TerminalLauncher = ${function:Invoke-MobileEditionSetupScript}
    )

    $resolvedRepositoryRoot = [System.IO.Path]::GetFullPath($RepositoryRoot)
    $setupScript = Join-Path -Path $resolvedRepositoryRoot -ChildPath 'scripts\Setup-MobileEdition.ps1'
    [string[]]$requestedArguments = @()
    if ($null -ne $Arguments) {
        $requestedArguments = @($Arguments)
    }

    if ($requestedArguments.Count -gt 0) {
        return Invoke-MobileEditionTerminalLauncher -SetupScript $setupScript -Arguments $requestedArguments -TerminalLauncher $TerminalLauncher
    }

    foreach ($candidate in Get-MobileEditionSetupCompanionCandidates -RepositoryRoot $resolvedRepositoryRoot) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            continue
        }

        try {
            & $ProcessLauncher -FilePath $candidate -Arguments @('--checkout', $resolvedRepositoryRoot) -WorkingDirectory $resolvedRepositoryRoot
            return 0
        } catch {
            [Console]::Error.WriteLine("Failed to launch visual Setup Companion '$candidate': $($_.Exception.Message)")
            return 1
        }
    }

    return Invoke-MobileEditionTerminalLauncher -SetupScript $setupScript -Arguments @() -TerminalLauncher $TerminalLauncher
}

if ($MyInvocation.InvocationName -ne '.') {
    $repositoryRoot = Split-Path -Parent $PSScriptRoot
    $exitCode = Invoke-MobileEditionSetupLauncher -RepositoryRoot $repositoryRoot -Arguments $LauncherArguments
    exit $exitCode
}
