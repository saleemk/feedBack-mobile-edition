param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$LauncherArguments
)

Set-StrictMode -Version 2.0

$script:MobileEditionSetupCompanionBootstrapManifestName = 'SETUP-COMPANION-BOOTSTRAP.json'
$script:MobileEditionSetupCompanionBootstrapSchema = 'feedback-mobile-edition.setup-companion-bootstrap.v1'
$script:MobileEditionSetupCompanionBootstrapCacheDirectoryName = '.setup-companion-bootstrap'
$script:MobileEditionSetupCompanionBootstrapExecutablePrefix = 'Setup-MobileEdition'

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

function Get-MobileEditionTopLevelJsonPropertyNames {
    param([string]$Json)

    $names = @()
    $depth = 0
    $inString = $false
    $escaped = $false
    $stringStart = -1

    for ($index = 0; $index -lt $Json.Length; $index += 1) {
        $character = $Json[$index]

        if ($inString) {
            if ($escaped) {
                $escaped = $false
                continue
            }
            if ($character -eq '\') {
                $escaped = $true
                continue
            }
            if ($character -eq '"') {
                $inString = $false
                if ($depth -eq 1) {
                    $lookahead = $index + 1
                    while ($lookahead -lt $Json.Length -and [char]::IsWhiteSpace($Json[$lookahead])) {
                        $lookahead += 1
                    }
                    if ($lookahead -lt $Json.Length -and $Json[$lookahead] -eq ':') {
                        $stringLiteral = $Json.Substring($stringStart, $index - $stringStart + 1)
                        $names += [string](ConvertFrom-Json -InputObject $stringLiteral -ErrorAction Stop)
                    }
                }
                continue
            }
            continue
        }

        if ($character -eq '"') {
            $inString = $true
            $stringStart = $index
            continue
        }
        if ($character -eq '{') {
            $depth += 1
            continue
        }
        if ($character -eq '}') {
            $depth -= 1
            continue
        }
    }

    return $names
}

function ConvertFrom-MobileEditionSetupCompanionBootstrapManifest {
    param(
        [string]$ManifestContent,
        [string]$ManifestPath
    )

    if ([string]::IsNullOrWhiteSpace($ManifestContent)) {
        throw "Bootstrap manifest '$ManifestPath' is empty."
    }

    try {
        $manifest = ConvertFrom-Json -InputObject $ManifestContent -ErrorAction Stop
    } catch {
        throw "Bootstrap manifest '$ManifestPath' is not valid JSON."
    }

    if ($null -eq $manifest -or $manifest -isnot [pscustomobject]) {
        throw "Bootstrap manifest '$ManifestPath' must be one JSON object."
    }

    $propertyNames = @($manifest.PSObject.Properties | ForEach-Object { $_.Name })
    $expectedPropertyNames = @('schema', 'version', 'assetUrl', 'sha256')
    $topLevelNames = @(Get-MobileEditionTopLevelJsonPropertyNames -Json $ManifestContent)

    foreach ($name in $topLevelNames | Select-Object -Unique) {
        $matchingCount = @($topLevelNames | Where-Object { $_ -ceq $name }).Count
        if ($matchingCount -gt 1) {
            throw "Bootstrap manifest '$ManifestPath' contains duplicate property '$name'."
        }
    }

    foreach ($expected in $expectedPropertyNames) {
        if (-not ($propertyNames | Where-Object { $_ -ceq $expected })) {
            throw "Bootstrap manifest '$ManifestPath' is missing '$expected'."
        }
    }

    foreach ($actual in $propertyNames) {
        if (-not ($expectedPropertyNames | Where-Object { $_ -ceq $actual })) {
            throw "Bootstrap manifest '$ManifestPath' contains unsupported property '$actual'."
        }
    }

    foreach ($expected in $expectedPropertyNames) {
        $value = $manifest.PSObject.Properties[$expected].Value
        if ($value -isnot [string]) {
            throw "Bootstrap manifest '$ManifestPath' property '$expected' must be a string."
        }
    }

    if ($manifest.schema -cne $script:MobileEditionSetupCompanionBootstrapSchema) {
        throw "Bootstrap manifest '$ManifestPath' has unsupported schema '$($manifest.schema)'."
    }

    if ($manifest.version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or $manifest.version -match '(?i)latest') {
        throw "Bootstrap manifest '$ManifestPath' has invalid companion version '$($manifest.version)'."
    }

    $assetUri = $null
    if (-not [System.Uri]::TryCreate($manifest.assetUrl, [System.UriKind]::Absolute, [ref]$assetUri)) {
        throw "Bootstrap manifest '$ManifestPath' assetUrl must be an absolute HTTPS URL."
    }
    if ($assetUri.Scheme -cne [System.Uri]::UriSchemeHttps) {
        throw "Bootstrap manifest '$ManifestPath' assetUrl must use HTTPS."
    }
    if ($manifest.assetUrl -match '\\' -or $manifest.assetUrl -match '(?i)(^|[\/?&=#._-])latest($|[\/?&=#._-])') {
        throw "Bootstrap manifest '$ManifestPath' assetUrl must identify an immutable HTTPS asset."
    }

    if ($manifest.sha256 -notmatch '^[0-9A-Fa-f]{64}$') {
        throw "Bootstrap manifest '$ManifestPath' sha256 must be exactly 64 hexadecimal characters."
    }

    [pscustomobject]@{
        schema = $manifest.schema
        version = $manifest.version
        assetUrl = $assetUri.AbsoluteUri
        sha256 = $manifest.sha256.ToLowerInvariant()
    }
}

function Get-MobileEditionSetupCompanionBootstrapCachePath {
    param(
        [string]$RepositoryRoot,
        [string]$Version,
        [string]$Sha256
    )

    $cacheDirectory = Join-Path -Path $RepositoryRoot -ChildPath $script:MobileEditionSetupCompanionBootstrapCacheDirectoryName
    $cacheFileName = '{0}-{1}-{2}.exe' -f $script:MobileEditionSetupCompanionBootstrapExecutablePrefix, $Version, $Sha256.Substring(0, 12)
    return Join-Path -Path $cacheDirectory -ChildPath $cacheFileName
}

function Get-MobileEditionFileSha256 {
    param([string]$FilePath)

    (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Invoke-MobileEditionSetupCompanionBootstrapDownload {
    param(
        [string]$AssetUrl,
        [string]$DestinationPath
    )

    Invoke-WebRequest -Uri $AssetUrl -OutFile $DestinationPath -UseBasicParsing
}

function Resolve-MobileEditionSetupCompanionBootstrap {
    param(
        [string]$RepositoryRoot,
        [scriptblock]$Downloader = ${function:Invoke-MobileEditionSetupCompanionBootstrapDownload}
    )

    $manifestPath = Join-Path -Path $RepositoryRoot -ChildPath $script:MobileEditionSetupCompanionBootstrapManifestName
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        return $null
    }

    try {
        $manifestContent = Get-Content -LiteralPath $manifestPath -Raw
        $manifest = ConvertFrom-MobileEditionSetupCompanionBootstrapManifest -ManifestContent $manifestContent -ManifestPath $manifestPath
    } catch {
        [Console]::Error.WriteLine("Setup Companion bootstrap unavailable: $($_.Exception.Message) Falling back to terminal Guided Setup.")
        return $null
    }

    $temporaryPath = $null
    try {
        $cachePath = Get-MobileEditionSetupCompanionBootstrapCachePath -RepositoryRoot $RepositoryRoot -Version $manifest.version -Sha256 $manifest.sha256
        $cacheDirectory = Split-Path -Parent $cachePath
        if (Test-Path -LiteralPath $cachePath -PathType Leaf) {
            try {
                if ((Get-MobileEditionFileSha256 -FilePath $cachePath) -ceq $manifest.sha256) {
                    return $cachePath
                }
                [Console]::Error.WriteLine("Setup Companion bootstrap cache checksum did not match; downloading a verified replacement.")
            } catch {
                [Console]::Error.WriteLine("Setup Companion bootstrap cache could not be verified; downloading a verified replacement.")
            }
        }

        if (Test-Path -LiteralPath $cacheDirectory -PathType Leaf) {
            throw "Managed bootstrap cache path is occupied by a file."
        }
        New-Item -ItemType Directory -Path $cacheDirectory -Force | Out-Null
        $temporaryPath = Join-Path -Path $cacheDirectory -ChildPath ('{0}.{1}.tmp' -f ([System.IO.Path]::GetFileName($cachePath)), [guid]::NewGuid().ToString('N'))
        & $Downloader -AssetUrl $manifest.assetUrl -DestinationPath $temporaryPath
        if (-not (Test-Path -LiteralPath $temporaryPath -PathType Leaf)) {
            throw "Download completed without creating the expected file."
        }
        $downloadedSha256 = Get-MobileEditionFileSha256 -FilePath $temporaryPath
        if ($downloadedSha256 -cne $manifest.sha256) {
            throw "Downloaded Setup Companion checksum did not match the bootstrap manifest."
        }
        Move-Item -LiteralPath $temporaryPath -Destination $cachePath -Force
        return $cachePath
    } catch {
        [Console]::Error.WriteLine("Setup Companion bootstrap unavailable: $($_.Exception.Message) Falling back to terminal Guided Setup.")
        return $null
    } finally {
        if ($null -ne $temporaryPath -and (Test-Path -LiteralPath $temporaryPath -PathType Leaf)) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
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
        [scriptblock]$TerminalLauncher = ${function:Invoke-MobileEditionSetupScript},
        [scriptblock]$BootstrapDownloader = ${function:Invoke-MobileEditionSetupCompanionBootstrapDownload}
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

    $bootstrapCandidate = Resolve-MobileEditionSetupCompanionBootstrap -RepositoryRoot $resolvedRepositoryRoot -Downloader $BootstrapDownloader
    if ($null -ne $bootstrapCandidate) {
        try {
            & $ProcessLauncher -FilePath $bootstrapCandidate -Arguments @('--checkout', $resolvedRepositoryRoot) -WorkingDirectory $resolvedRepositoryRoot
            return 0
        } catch {
            [Console]::Error.WriteLine("Failed to launch bootstrapped visual Setup Companion '$bootstrapCandidate': $($_.Exception.Message) Falling back to terminal Guided Setup.")
        }
    }

    return Invoke-MobileEditionTerminalLauncher -SetupScript $setupScript -Arguments @() -TerminalLauncher $TerminalLauncher
}

if ($MyInvocation.InvocationName -ne '.') {
    $repositoryRoot = Split-Path -Parent $PSScriptRoot
    $exitCode = Invoke-MobileEditionSetupLauncher -RepositoryRoot $repositoryRoot -Arguments $LauncherArguments
    exit $exitCode
}
