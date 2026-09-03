param(
    [string]$Version,
    [string]$RepositoryRoot,
    [string]$OutputDirectory,
    [string]$PrebuiltCompanionPath,
    [switch]$Force
)

Set-StrictMode -Version 2.0
Add-Type -AssemblyName System.IO.Compression.FileSystem

$script:BundleSchema = 'feedback-mobile-edition.setup-bundle.v1'

function ConvertTo-MobileEditionBundleProcessArgument {
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

function Join-MobileEditionBundleProcessArguments {
    param([string[]]$Arguments)

    (@($Arguments) | ForEach-Object { ConvertTo-MobileEditionBundleProcessArgument -Argument $_ }) -join ' '
}

function Resolve-MobileEditionBundleRepositoryRoot {
    param([string]$RepositoryRoot)

    if ($RepositoryRoot) {
        return [System.IO.Path]::GetFullPath($RepositoryRoot)
    }
    return [System.IO.Path]::GetFullPath((Join-Path -Path $PSScriptRoot -ChildPath '..'))
}

function Test-MobileEditionBundleChildPath {
    param(
        [string]$Parent,
        [string]$Child
    )

    $parentPath = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $childPath = [System.IO.Path]::GetFullPath($Child).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    return $childPath.StartsWith($parentPath, [System.StringComparison]::OrdinalIgnoreCase)
}

function Invoke-MobileEditionBundleProcess {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [string]$Description
    )

    $process = $null
    try {
        $argumentText = Join-MobileEditionBundleProcessArguments -Arguments $Arguments
        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        if ([System.IO.Path]::GetExtension($FilePath) -in @('.cmd', '.bat')) {
            $commandInterpreter = if ($env:ComSpec) { $env:ComSpec } else { Join-Path -Path $env:SystemRoot -ChildPath 'System32\cmd.exe' }
            $startInfo.FileName = $commandInterpreter
            $startInfo.Arguments = '/d /s /c "' + (ConvertTo-MobileEditionBundleProcessArgument -Argument $FilePath) + $(if ($argumentText) { " $argumentText" } else { '' }) + '"'
        } else {
            $startInfo.FileName = $FilePath
            $startInfo.Arguments = $argumentText
        }
        $startInfo.WorkingDirectory = $WorkingDirectory
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true

        $process = [System.Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        if (-not $process.Start()) {
            throw "$Description process did not start."
        }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdoutText = $stdoutTask.GetAwaiter().GetResult()
        $stderrText = $stderrTask.GetAwaiter().GetResult()
        $stdout = @($stdoutText -split "`r?`n" | Where-Object { $_ -ne '' })
        $stderr = @($stderrText -split "`r?`n" | Where-Object { $_ -ne '' })
        if ($process.ExitCode -ne 0) {
            throw "$Description failed with exit code $($process.ExitCode). $((@($stdout) + @($stderr)) -join "`n")"
        }
        return @($stdout)
    } catch {
        throw "$Description failed to start or complete: $($_.Exception.Message)"
    } finally {
        if ($process) {
            $process.Dispose()
        }
    }
}

function Assert-MobileEditionBundleVersion {
    param([string]$Version)

    if (-not $Version -or $Version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
        throw "Version must be 1-64 characters and contain only letters, numbers, dots, underscores, and hyphens."
    }
}

function Invoke-MobileEditionBundleGit {
    param(
        [string]$RepositoryRoot,
        [string[]]$Arguments
    )

    $gitCommand = Get-Command git -ErrorAction Stop
    return @(Invoke-MobileEditionBundleProcess `
            -FilePath $gitCommand.Source `
            -Arguments (@('-C', $RepositoryRoot) + @($Arguments)) `
            -WorkingDirectory $RepositoryRoot `
            -Description "git $($Arguments -join ' ')")
}

function Invoke-MobileEditionBundleCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [string]$Description
    )

    if (-not $FilePath) {
        throw "$Description command path is required."
    }
    return @(Invoke-MobileEditionBundleProcess -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $WorkingDirectory -Description $Description)
}

function Assert-MobileEditionBundleCleanTrackedTree {
    param([string]$RepositoryRoot)

    $status = @(Invoke-MobileEditionBundleGit -RepositoryRoot $RepositoryRoot -Arguments @('status', '--porcelain', '--untracked-files=no'))
    if ($status.Count -gt 0) {
        throw "Refusing to build setup bundle because the tracked working tree is dirty."
    }
}

function Assert-MobileEditionBundleTrackedExclusions {
    param([string]$RepositoryRoot)

    $tracked = @(Invoke-MobileEditionBundleGit -RepositoryRoot $RepositoryRoot -Arguments @('ls-files'))
    $forbidden = @($tracked | Where-Object {
            $_ -eq '.env' `
            -or $_ -eq 'AI_HANDOFF.local.md' `
            -or ($_ -match '^library/' -and $_ -ne 'library/.gitkeep') `
            -or $_ -match '(^|/)node_modules/' `
            -or $_ -match '(^|/)target/' `
            -or $_ -match '(^|/)(__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache)/'
        })
    if ($forbidden.Count -gt 0) {
        throw "Refusing to build setup bundle because forbidden tracked paths would be archived: $($forbidden -join ', ')"
    }
}

function Assert-MobileEditionBundleUnchangedHead {
    param(
        [string]$RepositoryRoot,
        [string]$ExpectedHead
    )

    $currentHead = (Invoke-MobileEditionBundleGit -RepositoryRoot $RepositoryRoot -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1)
    if ($currentHead -ne $ExpectedHead) {
        throw "Refusing to build setup bundle because HEAD changed during companion build. Expected $ExpectedHead, got $currentHead."
    }
}

function New-MobileEditionBundleZip {
    param(
        [string]$SourceDirectory,
        [string]$ZipPath
    )

    $sourceRoot = [System.IO.Path]::GetFullPath($SourceDirectory).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $files = Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Force
        foreach ($file in $files) {
            $relativePath = $file.FullName.Substring($sourceRoot.Length) -replace '\\', '/'
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relativePath, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally {
        $zip.Dispose()
    }
}

function Invoke-MobileEditionSetupCompanionReleaseBuild {
    param([string]$RepositoryRoot)

    $companionRoot = Join-Path -Path $RepositoryRoot -ChildPath 'setup-companion'
    $packageLock = Join-Path -Path $companionRoot -ChildPath 'package-lock.json'
    if (-not (Test-Path -LiteralPath $packageLock -PathType Leaf)) {
        throw "Setup Companion package-lock.json not found at $packageLock. Cannot perform locked dependency install."
    }
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCommand) {
        $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
    }
    if (-not $npmCommand) {
        throw "npm is required to install locked Setup Companion dependencies before building the setup bundle."
    }

    Invoke-MobileEditionBundleCommand -FilePath $npmCommand.Source -Arguments @('ci') -WorkingDirectory $companionRoot -Description 'Setup Companion npm ci' | Out-Null
    $tauriCommand = Join-Path -Path $companionRoot -ChildPath 'node_modules\.bin\tauri.cmd'
    if (-not (Test-Path -LiteralPath $tauriCommand -PathType Leaf)) {
        throw "Tauri CLI was not installed at $tauriCommand after npm ci."
    }
    Invoke-MobileEditionBundleCommand -FilePath $tauriCommand -Arguments @('build', '--no-bundle') -WorkingDirectory $companionRoot -Description 'Setup Companion release build' | Out-Null
    return (Join-Path -Path $companionRoot -ChildPath 'src-tauri\target\release\feedback-mobile-edition-setup-companion.exe')
}

function New-MobileEditionSetupBundle {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Version,
        [string]$RepositoryRoot,
        [string]$OutputDirectory,
        [string]$PrebuiltCompanionPath,
        [switch]$Force,
        [scriptblock]$CompanionBuilder = ${function:Invoke-MobileEditionSetupCompanionReleaseBuild}
    )

    Assert-MobileEditionBundleVersion -Version $Version
    $resolvedRepositoryRoot = Resolve-MobileEditionBundleRepositoryRoot -RepositoryRoot $RepositoryRoot
    if (-not (Test-Path -LiteralPath (Join-Path -Path $resolvedRepositoryRoot -ChildPath '.git') -PathType Container)) {
        throw "Repository root is not a Git checkout: $resolvedRepositoryRoot"
    }

    $resolvedOutputDirectory = if ($OutputDirectory) {
        [System.IO.Path]::GetFullPath($OutputDirectory)
    } else {
        [System.IO.Path]::GetFullPath((Join-Path -Path $resolvedRepositoryRoot -ChildPath 'artifacts\setup-bundles'))
    }
    $artifactRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $resolvedRepositoryRoot -ChildPath 'artifacts'))
    if ($resolvedOutputDirectory -ne $artifactRoot -and -not (Test-MobileEditionBundleChildPath -Parent $artifactRoot -Child $resolvedOutputDirectory)) {
        throw "Output directory must stay inside the repository artifact area."
    }

    Assert-MobileEditionBundleCleanTrackedTree -RepositoryRoot $resolvedRepositoryRoot
    Assert-MobileEditionBundleTrackedExclusions -RepositoryRoot $resolvedRepositoryRoot

    $head = (Invoke-MobileEditionBundleGit -RepositoryRoot $resolvedRepositoryRoot -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1)
    $topLevelName = "feedback-mobile-edition-$Version"
    $zipName = "$topLevelName-windows-setup.zip"
    $zipPath = Join-Path -Path $resolvedOutputDirectory -ChildPath $zipName
    $checksumPath = "$zipPath.sha256"
    if ((Test-Path -LiteralPath $zipPath -PathType Leaf) -and -not $Force) {
        throw "Refusing to overwrite existing setup bundle: $zipPath"
    }
    if ((Test-Path -LiteralPath $checksumPath -PathType Leaf) -and -not $Force) {
        throw "Refusing to overwrite existing setup bundle checksum: $checksumPath"
    }

    $companionPath = if ($PrebuiltCompanionPath) {
        [System.IO.Path]::GetFullPath($PrebuiltCompanionPath)
    } else {
        [System.IO.Path]::GetFullPath((& $CompanionBuilder -RepositoryRoot $resolvedRepositoryRoot))
    }
    if (-not (Test-Path -LiteralPath $companionPath -PathType Leaf)) {
        throw "Setup Companion executable not found: $companionPath"
    }
    Assert-MobileEditionBundleCleanTrackedTree -RepositoryRoot $resolvedRepositoryRoot
    Assert-MobileEditionBundleUnchangedHead -RepositoryRoot $resolvedRepositoryRoot -ExpectedHead $head

    $stagingRoot = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("feedback-mobile-edition-bundle-" + [guid]::NewGuid().ToString('N'))
    $archivePath = Join-Path -Path $stagingRoot -ChildPath 'source.zip'
    $stageDirectory = Join-Path -Path $stagingRoot -ChildPath $topLevelName

    try {
        New-Item -ItemType Directory -Path $stagingRoot | Out-Null
        Invoke-MobileEditionBundleGit -RepositoryRoot $resolvedRepositoryRoot -Arguments @('archive', '--format=zip', "--output=$archivePath", "--prefix=$topLevelName/", $head) | Out-Null
        [System.IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $stagingRoot)

        $requiredPaths = @(
            'Setup-MobileEdition.cmd',
            '.env.example',
            'docker-compose.release.yml',
            'LICENSE',
            'ATTRIBUTIONS.md',
            'RELEASE-MANIFEST.md',
            'scripts/Setup-MobileEdition.ps1',
            'scripts/Start-MobileEditionSetup.ps1'
        )
        foreach ($requiredPath in $requiredPaths) {
            $candidate = Join-Path -Path $stageDirectory -ChildPath $requiredPath
            if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                throw "Staged bundle is missing required file: $requiredPath"
            }
        }

        $stagedCompanionPath = Join-Path -Path $stageDirectory -ChildPath 'Setup-MobileEdition.exe'
        Copy-Item -LiteralPath $companionPath -Destination $stagedCompanionPath -Force
        $companionHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $stagedCompanionPath).Hash.ToLowerInvariant()

        $manifest = [ordered]@{
            schema = $script:BundleSchema
            bundleFormat = 'zip'
            editionVersion = $Version
            editionCommit = $head
            companionPath = 'Setup-MobileEdition.exe'
            companionSha256 = $companionHash
            generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        }
        $manifestPath = Join-Path -Path $stageDirectory -ChildPath 'SETUP-BUNDLE-MANIFEST.json'
        $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

        New-Item -ItemType Directory -Path $resolvedOutputDirectory -Force | Out-Null
        if ($Force) {
            Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $checksumPath -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $archivePath -Force
        New-MobileEditionBundleZip -SourceDirectory $stagingRoot -ZipPath $zipPath
        $zipHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
        "$zipHash  $zipName" | Set-Content -LiteralPath $checksumPath -Encoding ASCII

        [pscustomobject]@{
            version = $Version
            editionCommit = $head
            zipPath = $zipPath
            zipSha256 = $zipHash
            checksumPath = $checksumPath
            companionSha256 = $companionHash
            topLevelDirectory = $topLevelName
            stagingRoot = $stagingRoot
        }
    } finally {
        if ($stagingRoot) {
            $fullStagingRoot = [System.IO.Path]::GetFullPath($stagingRoot)
            $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
            if ($fullStagingRoot.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $fullStagingRoot).StartsWith('feedback-mobile-edition-bundle-', [System.StringComparison]::OrdinalIgnoreCase)) {
                Remove-Item -LiteralPath $fullStagingRoot -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    if (-not $Version) {
        throw "Version is required. Pass -Version <edition-version>."
    }
    $result = New-MobileEditionSetupBundle -Version $Version -RepositoryRoot $RepositoryRoot -OutputDirectory $OutputDirectory -PrebuiltCompanionPath $PrebuiltCompanionPath -Force:$Force
    Write-Output "Setup bundle: $($result.zipPath)"
    Write-Output "Setup bundle SHA-256: $($result.zipSha256)"
    Write-Output "Checksum file: $($result.checksumPath)"
    Write-Output "Companion SHA-256: $($result.companionSha256)"
}
