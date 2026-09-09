param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$LauncherArguments
)

Set-StrictMode -Version 2.0

$script:MobileEditionSetupCompanionBootstrapManifestName = 'SETUP-COMPANION-BOOTSTRAP.json'
$script:MobileEditionSetupCompanionBootstrapSchema = 'feedback-mobile-edition.setup-companion-bootstrap.v1'
$script:MobileEditionSetupCompanionBootstrapCacheDirectoryName = '.setup-companion-bootstrap'
$script:MobileEditionSetupCompanionBootstrapExecutablePrefix = 'Setup-MobileEdition'
$script:MobileEditionCompanionDataDirectoryName = 'fee[dB]ack Mobile Edition'
$script:MobileEditionCurrentInstallationRecordName = 'current-installation.json'
$script:MobileEditionCurrentInstallationSchema = 'feedback-mobile-edition.current-installation.v1'
$script:MobileEditionSetupBundleManifestName = 'SETUP-BUNDLE-MANIFEST.json'
$script:MobileEditionSetupBundleManifestSchema = 'feedback-mobile-edition.setup-bundle.v1'

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

function Get-MobileEditionSetupCompanionDataRoot {
    $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        throw 'Local application data directory is unavailable.'
    }
    Join-Path -Path $localAppData -ChildPath $script:MobileEditionCompanionDataDirectoryName
}

function Get-MobileEditionCurrentInstallationRecordPath {
    param([string]$DataRoot)

    Join-Path -Path $DataRoot -ChildPath $script:MobileEditionCurrentInstallationRecordName
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

function Test-MobileEditionPathInside {
    param(
        [string]$Path,
        [string]$Parent
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $fullParent = [System.IO.Path]::GetFullPath($Parent)
    if (-not $fullParent.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $fullParent += [System.IO.Path]::DirectorySeparatorChar
    }

    $fullPath.StartsWith($fullParent, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-MobileEditionNonReparseDirectory {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return $false
    }
    $item = Get-Item -LiteralPath $Path -Force
    return (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0)
}

function Test-MobileEditionNonReparseFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }
    $item = Get-Item -LiteralPath $Path -Force
    return (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0)
}

function Assert-MobileEditionNoReparseDescendants {
    param([string]$Root)

    $items = @(Get-ChildItem -LiteralPath $Root -Recurse -Force)
    foreach ($item in $items) {
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Managed setup bundle contains a reparse point.'
        }
    }
}

function Assert-MobileEditionSetupBundleRequiredFiles {
    param([string]$Root)

    $requiredFiles = @(
        'Setup-MobileEdition.cmd',
        '.env.example',
        'docker-compose.release.yml',
        'LICENSE',
        'ATTRIBUTIONS.md',
        'RELEASE-MANIFEST.md',
        'scripts\Setup-MobileEdition.ps1',
        'scripts\Start-MobileEditionSetup.ps1'
    )

    foreach ($relativePath in $requiredFiles) {
        $path = Join-Path -Path $Root -ChildPath $relativePath
        if (-not (Test-MobileEditionNonReparseFile -Path $path)) {
            throw 'Current installation is missing required setup bundle files.'
        }
    }
}

function ConvertTo-MobileEditionRelativeKey {
    param(
        [string]$Root,
        [string]$Path
    )

    $fullRoot = [System.IO.Path]::GetFullPath($Root)
    if (-not $fullRoot.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $fullRoot += [System.IO.Path]::DirectorySeparatorChar
    }
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Managed setup bundle path escapes the installation root.'
    }
    $fullPath.Substring($fullRoot.Length).Replace('\', '/').ToLowerInvariant()
}

function Test-MobileEditionForbiddenBundleRelativePath {
    param([string]$RelativeKey)

    if ($RelativeKey -cne '.env.example') {
        $leaf = ($RelativeKey -split '/')[-1]
        if ($leaf -ceq '.env' -or $leaf.StartsWith('.env.', [System.StringComparison]::Ordinal)) {
            return $RelativeKey -cne '.env'
        }
    }
    if ($RelativeKey -ceq 'ai_handoff.local.md') {
        return $true
    }
    if ($RelativeKey -ceq '.git' -or $RelativeKey.StartsWith('.git/', [System.StringComparison]::Ordinal) -or $RelativeKey.EndsWith('/.git', [System.StringComparison]::Ordinal) -or $RelativeKey.Contains('/.git/')) {
        return $true
    }

    $forbiddenDirectories = @(
        'node_modules',
        'target',
        '__pycache__',
        '.pytest_cache',
        '.mypy_cache',
        '.ruff_cache',
        'artifacts',
        'build',
        'dist',
        '.setup-companion-bootstrap',
        'bootstrap-cache',
        'update-cache',
        'logs',
        'profiles',
        'offline-packages',
        'diagnostics',
        'recordings',
        '.cache',
        'cache'
    )
    foreach ($component in ($RelativeKey -split '/')) {
        if ($forbiddenDirectories -contains $component) {
            return $true
        }
    }

    foreach ($extension in @('.log', '.pem', '.key', '.pfx', '.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac')) {
        if ($RelativeKey.EndsWith($extension, [System.StringComparison]::Ordinal)) {
            return $true
        }
    }

    $RelativeKey.StartsWith('library/', [System.StringComparison]::Ordinal) -and $RelativeKey -cne 'library/.gitkeep'
}

function Assert-MobileEditionNoForbiddenInstalledPaths {
    param([string]$Root)

    foreach ($item in @(Get-ChildItem -LiteralPath $Root -Recurse -Force)) {
        $relative = ConvertTo-MobileEditionRelativeKey -Root $Root -Path $item.FullName
        if (Test-MobileEditionForbiddenBundleRelativePath -RelativeKey $relative) {
            throw 'Current installation contains local or unsupported files.'
        }
    }
}

function Assert-MobileEditionJsonContract {
    param(
        [pscustomobject]$Object,
        [string]$Content,
        [string]$Path,
        [string[]]$ExpectedPropertyNames,
        [string]$Label
    )

    $propertyNames = @($Object.PSObject.Properties | ForEach-Object { $_.Name })
    $topLevelNames = @(Get-MobileEditionTopLevelJsonPropertyNames -Json $Content)

    foreach ($name in $topLevelNames | Select-Object -Unique) {
        $matchingCount = @($topLevelNames | Where-Object { $_ -ceq $name }).Count
        if ($matchingCount -gt 1) {
            throw "$Label '$Path' contains duplicate property '$name'."
        }
    }

    foreach ($expected in $ExpectedPropertyNames) {
        if (-not ($propertyNames | Where-Object { $_ -ceq $expected })) {
            throw "$Label '$Path' is missing '$expected'."
        }
    }

    foreach ($actual in $propertyNames) {
        if (-not ($ExpectedPropertyNames | Where-Object { $_ -ceq $actual })) {
            throw "$Label '$Path' contains unsupported property '$actual'."
        }
    }

    foreach ($expected in $ExpectedPropertyNames) {
        $value = $Object.PSObject.Properties[$expected].Value
        if ($value -isnot [string]) {
            throw "$Label '$Path' property '$expected' must be a string."
        }
    }
}

function ConvertFrom-MobileEditionCurrentInstallationRecord {
    param(
        [string]$RecordContent,
        [string]$RecordPath
    )

    if ([string]::IsNullOrWhiteSpace($RecordContent)) {
        throw "Current installation record '$RecordPath' is empty."
    }

    try {
        $record = ConvertFrom-Json -InputObject $RecordContent -ErrorAction Stop
    } catch {
        throw "Current installation record '$RecordPath' is not valid JSON."
    }

    if ($null -eq $record -or $record -isnot [pscustomobject]) {
        throw "Current installation record '$RecordPath' must be one JSON object."
    }

    Assert-MobileEditionJsonContract `
        -Object $record `
        -Content $RecordContent `
        -Path $RecordPath `
        -ExpectedPropertyNames @('schema', 'currentTag') `
        -Label 'Current installation record'

    if ($record.schema -cne $script:MobileEditionCurrentInstallationSchema) {
        throw "Current installation record '$RecordPath' has unsupported schema '$($record.schema)'."
    }

    if ($record.currentTag -notmatch '^v\d+\.\d+\.\d+$') {
        throw "Current installation record '$RecordPath' has invalid currentTag '$($record.currentTag)'."
    }

    [pscustomobject]@{
        schema = $record.schema
        currentTag = $record.currentTag
    }
}

function ConvertFrom-MobileEditionSetupBundleManifest {
    param(
        [string]$ManifestContent,
        [string]$ManifestPath
    )

    if ([string]::IsNullOrWhiteSpace($ManifestContent)) {
        throw "Setup bundle manifest '$ManifestPath' is empty."
    }

    try {
        $manifest = ConvertFrom-Json -InputObject $ManifestContent -ErrorAction Stop
    } catch {
        throw "Setup bundle manifest '$ManifestPath' is not valid JSON."
    }

    if ($null -eq $manifest -or $manifest -isnot [pscustomobject]) {
        throw "Setup bundle manifest '$ManifestPath' must be one JSON object."
    }

    Assert-MobileEditionJsonContract `
        -Object $manifest `
        -Content $ManifestContent `
        -Path $ManifestPath `
        -ExpectedPropertyNames @('schema', 'bundleFormat', 'editionVersion', 'editionCommit', 'companionPath', 'companionSha256', 'generatedAtUtc') `
        -Label 'Setup bundle manifest'

    if ($manifest.schema -cne $script:MobileEditionSetupBundleManifestSchema) {
        throw "Setup bundle manifest '$ManifestPath' has unsupported schema '$($manifest.schema)'."
    }
    if ($manifest.bundleFormat -cne 'zip') {
        throw "Setup bundle manifest '$ManifestPath' has unsupported bundleFormat '$($manifest.bundleFormat)'."
    }
    if ($manifest.editionVersion -notmatch '^v?\d+\.\d+\.\d+$') {
        throw "Setup bundle manifest '$ManifestPath' has invalid editionVersion '$($manifest.editionVersion)'."
    }
    if ($manifest.editionCommit -notmatch '^[0-9A-Fa-f]{40}$') {
        throw "Setup bundle manifest '$ManifestPath' has invalid editionCommit '$($manifest.editionCommit)'."
    }
    if ($manifest.companionPath -cne 'Setup-MobileEdition.exe') {
        throw "Setup bundle manifest '$ManifestPath' has unsupported companionPath '$($manifest.companionPath)'."
    }
    if ($manifest.companionSha256 -notmatch '^[0-9A-Fa-f]{64}$') {
        throw "Setup bundle manifest '$ManifestPath' companionSha256 must be exactly 64 hexadecimal characters."
    }
    if ([string]::IsNullOrWhiteSpace($manifest.generatedAtUtc)) {
        throw "Setup bundle manifest '$ManifestPath' generatedAtUtc must be present."
    }

    [pscustomobject]@{
        schema = $manifest.schema
        bundleFormat = $manifest.bundleFormat
        editionVersion = $manifest.editionVersion
        editionCommit = $manifest.editionCommit.ToLowerInvariant()
        companionPath = $manifest.companionPath
        companionSha256 = $manifest.companionSha256.ToLowerInvariant()
        generatedAtUtc = $manifest.generatedAtUtc
    }
}

function Resolve-MobileEditionCurrentSetupCompanion {
    param(
        [string]$RepositoryRoot,
        [string]$CompanionDataRoot
    )

    $recordPath = Get-MobileEditionCurrentInstallationRecordPath -DataRoot $CompanionDataRoot
    if (-not (Test-Path -LiteralPath $recordPath -PathType Leaf)) {
        return $null
    }

    try {
        $recordContent = Get-Content -LiteralPath $recordPath -Raw
        $record = ConvertFrom-MobileEditionCurrentInstallationRecord -RecordContent $recordContent -RecordPath $recordPath

        $resolvedDataRoot = [System.IO.Path]::GetFullPath($CompanionDataRoot)
        $installationsRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $resolvedDataRoot -ChildPath 'installations'))
        $versionRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $installationsRoot -ChildPath $record.currentTag))
        if (-not (Test-MobileEditionPathInside -Path $versionRoot -Parent $installationsRoot)) {
            throw 'Current installation target escapes the managed installations directory.'
        }
        if (-not (Test-MobileEditionNonReparseDirectory -Path $installationsRoot)) {
            throw 'Managed installations directory is unavailable or unsafe.'
        }
        if (-not (Test-MobileEditionNonReparseDirectory -Path $versionRoot)) {
            throw 'Current installation directory is unavailable or unsafe.'
        }
        Assert-MobileEditionNoReparseDescendants -Root $versionRoot
        Assert-MobileEditionSetupBundleRequiredFiles -Root $versionRoot
        Assert-MobileEditionNoForbiddenInstalledPaths -Root $versionRoot

        $manifestPath = Join-Path -Path $versionRoot -ChildPath $script:MobileEditionSetupBundleManifestName
        if (-not (Test-MobileEditionNonReparseFile -Path $manifestPath)) {
            throw 'Setup bundle manifest is unavailable or unsafe.'
        }
        $manifestContent = Get-Content -LiteralPath $manifestPath -Raw
        $manifest = ConvertFrom-MobileEditionSetupBundleManifest -ManifestContent $manifestContent -ManifestPath $manifestPath
        $versionWithoutPrefix = $record.currentTag.Substring(1)
        if ($manifest.editionVersion -cne $record.currentTag -and $manifest.editionVersion -cne $versionWithoutPrefix) {
            throw 'Setup bundle manifest version does not match the current installation tag.'
        }

        $companionPath = [System.IO.Path]::GetFullPath((Join-Path -Path $versionRoot -ChildPath $manifest.companionPath))
        if (-not (Test-MobileEditionPathInside -Path $companionPath -Parent $versionRoot)) {
            throw 'Setup Companion path escapes the current installation directory.'
        }
        if (-not (Test-MobileEditionNonReparseFile -Path $companionPath)) {
            throw 'Setup Companion executable is unavailable or unsafe.'
        }
        if ((Get-MobileEditionFileSha256 -FilePath $companionPath) -cne $manifest.companionSha256) {
            throw 'Setup Companion checksum did not match the setup bundle manifest.'
        }

        [pscustomobject]@{
            filePath = $companionPath
            arguments = @('--checkout', $versionRoot)
            workingDirectory = $versionRoot
            tag = $record.currentTag
        }
    } catch {
        [Console]::Error.WriteLine('Current managed Setup Companion unavailable. Falling back to bundled Setup Companion.')
        return $null
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
        [scriptblock]$BootstrapDownloader = ${function:Invoke-MobileEditionSetupCompanionBootstrapDownload},
        [string]$CompanionDataRoot = $null
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

    $resolvedCompanionDataRoot = if ([string]::IsNullOrWhiteSpace($CompanionDataRoot)) {
        Get-MobileEditionSetupCompanionDataRoot
    } else {
        [System.IO.Path]::GetFullPath($CompanionDataRoot)
    }
    $currentCandidate = Resolve-MobileEditionCurrentSetupCompanion -RepositoryRoot $resolvedRepositoryRoot -CompanionDataRoot $resolvedCompanionDataRoot
    if ($null -ne $currentCandidate) {
        try {
            & $ProcessLauncher -FilePath $currentCandidate.filePath -Arguments @($currentCandidate.arguments) -WorkingDirectory $currentCandidate.workingDirectory
            return 0
        } catch {
            [Console]::Error.WriteLine('Failed to launch current managed Setup Companion. Falling back to bundled Setup Companion.')
        }
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
