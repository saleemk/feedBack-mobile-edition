[CmdletBinding()]
param(
    [ValidateSet('Inspect', 'Validate', 'Apply')]
    [string]$Mode = 'Inspect',
    [string]$LibraryPath,
    [string]$RepositoryRoot,
    [switch]$Json
)

Set-StrictMode -Version 2.0

$requestedMode = $Mode
$requestedLibraryPath = $LibraryPath
$requestedRepositoryRoot = $RepositoryRoot
$jsonRequested = $Json.IsPresent

$setupPath = Join-Path -Path $PSScriptRoot -ChildPath 'Setup-MobileEdition.ps1'
. $setupPath

function New-MobileEditionLibraryResult {
    param(
        [string]$Status,
        [bool]$Valid,
        [bool]$Changed,
        [string]$Reason,
        [string]$Path,
        [int]$Port
    )

    [pscustomobject]@{
        status = $Status
        valid = $Valid
        changed = $Changed
        reason = $Reason
        path = $Path
        port = $Port
    }
}

function Invoke-MobileEditionLibraryConfiguration {
    param(
        [string]$RepositoryRoot,
        [ValidateSet('Inspect', 'Validate', 'Apply')]
        [string]$Mode,
        [string]$LibraryPath
    )

    $envPath = Join-Path -Path $RepositoryRoot -ChildPath '.env'
    $envExamplePath = Join-Path -Path $RepositoryRoot -ChildPath '.env.example'
    $envResult = Read-MobileEditionEnvFile -Path $envPath
    $settings = Resolve-MobileEditionSettings -RepositoryRoot $RepositoryRoot -EnvValues $envResult.values
    $portChoice = Get-MobileEditionPortChoice -RequestedPort $null -CurrentPort $settings.feedbackPort

    if ($Mode -eq 'Inspect') {
        if ($envResult.errors.Count -gt 0) {
            return New-MobileEditionLibraryResult -Status 'needs_action' -Valid $false -Changed $false -Reason '.env must be repaired before the library can be configured.' -Path '' -Port $portChoice.port
        }

        $currentChoice = Resolve-MobileEditionLibraryChoice -RepositoryRoot $RepositoryRoot -LibraryPath $settings.libraryPath
        if (-not $currentChoice.valid) {
            return New-MobileEditionLibraryResult -Status 'needs_action' -Valid $false -Changed $false -Reason $currentChoice.reason -Path $currentChoice.resolvedPath -Port $portChoice.port
        }

        return New-MobileEditionLibraryResult -Status 'ready' -Valid $true -Changed $false -Reason 'The configured song-library folder is ready.' -Path $currentChoice.resolvedPath -Port $portChoice.port
    }

    if (-not $LibraryPath -or $LibraryPath.Contains("`r") -or $LibraryPath.Contains("`n")) {
        return New-MobileEditionLibraryResult -Status 'needs_action' -Valid $false -Changed $false -Reason 'Choose one existing song-library folder.' -Path '' -Port $portChoice.port
    }

    $libraryChoice = Resolve-MobileEditionLibraryChoice -RepositoryRoot $RepositoryRoot -LibraryPath $LibraryPath
    if (-not $libraryChoice.valid) {
        return New-MobileEditionLibraryResult -Status 'needs_action' -Valid $false -Changed $false -Reason $libraryChoice.reason -Path $libraryChoice.resolvedPath -Port $portChoice.port
    }

    if ($Mode -eq 'Validate') {
        return New-MobileEditionLibraryResult -Status 'ready' -Valid $true -Changed $false -Reason 'This folder can be used as the song library.' -Path $libraryChoice.resolvedPath -Port $portChoice.port
    }

    if ($envResult.exists -and $envResult.errors.Count -gt 0) {
        return New-MobileEditionLibraryResult -Status 'needs_action' -Valid $false -Changed $false -Reason '.env must be repaired before it can be updated safely.' -Path $libraryChoice.resolvedPath -Port $portChoice.port
    }

    $envUpdate = Set-MobileEditionEnvFile -EnvPath $envPath -EnvExamplePath $envExamplePath -LibraryPath $libraryChoice.resolvedPath -Port $portChoice.port
    if ($envUpdate.status -ne 'ready') {
        return New-MobileEditionLibraryResult -Status 'needs_action' -Valid $false -Changed $false -Reason $envUpdate.reason -Path $libraryChoice.resolvedPath -Port $portChoice.port
    }

    New-MobileEditionLibraryResult -Status 'ready' -Valid $true -Changed $true -Reason 'Song-library configuration saved.' -Path $libraryChoice.resolvedPath -Port $portChoice.port
}

function Invoke-MobileEditionLibraryConfigurationMain {
    param(
        [string]$Mode,
        [string]$LibraryPath,
        [string]$RepositoryRoot,
        [switch]$Json
    )

    if (-not $RepositoryRoot) {
        $RepositoryRoot = Split-Path -Parent $PSScriptRoot
    }

    $result = Invoke-MobileEditionLibraryConfiguration -RepositoryRoot $RepositoryRoot -Mode $Mode -LibraryPath $LibraryPath
    if ($Json) {
        $result | ConvertTo-Json -Depth 4
    } else {
        $result
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-MobileEditionLibraryConfigurationMain -Mode $requestedMode -LibraryPath $requestedLibraryPath -RepositoryRoot $requestedRepositoryRoot -Json:$jsonRequested
}
