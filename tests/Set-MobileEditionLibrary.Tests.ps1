$ErrorActionPreference = 'Stop'

$libraryScriptPath = Join-Path -Path (Split-Path -Parent $PSScriptRoot) -ChildPath 'scripts\Set-MobileEditionLibrary.ps1'
. $libraryScriptPath

function Assert-Equal {
    param([object]$Actual, [object]$Expected, [string]$Message)
    if ($Actual -ne $Expected) {
        throw "$Message Expected '$Expected', got '$Actual'."
    }
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        throw $Message
    }
}

function New-TempLibraryRepo {
    $root = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("mobile-edition-library-test-" + [guid]::NewGuid().ToString('N'))
    $library = Join-Path -Path $root -ChildPath 'songs'
    New-Item -ItemType Directory -Path $library -Force | Out-Null
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath '.env.example') -Value @(
        '# example',
        'LIBRARY_PATH=./missing',
        'FEEDBACK_PORT=8123'
    ) -Encoding UTF8
    [pscustomobject]@{ root = $root; library = $library; env = Join-Path -Path $root -ChildPath '.env' }
}

function Remove-TempLibraryRepo {
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

$repo = New-TempLibraryRepo
try {
    $inspect = Invoke-MobileEditionLibraryConfiguration -RepositoryRoot $repo.root -Mode Inspect
    Assert-True (-not $inspect.valid) 'Inspect should report the missing default library.'

    $validate = Invoke-MobileEditionLibraryConfiguration -RepositoryRoot $repo.root -Mode Validate -LibraryPath $repo.library
    Assert-True $validate.valid 'Validate should accept an existing folder.'
    Assert-True (-not $validate.changed) 'Validate must not write configuration.'
    Assert-True (-not (Test-Path -LiteralPath $repo.env)) 'Validate must not create .env.'

    $apply = Invoke-MobileEditionLibraryConfiguration -RepositoryRoot $repo.root -Mode Apply -LibraryPath $repo.library
    Assert-True $apply.valid 'Apply should accept an existing folder.'
    Assert-True $apply.changed 'Apply should report the configuration write.'
    $content = Get-Content -LiteralPath $repo.env
    Assert-True (($content -join "`n").Contains("LIBRARY_PATH=$($repo.library)")) 'Apply should save the selected library.'
    Assert-True (($content -join "`n").Contains('FEEDBACK_PORT=8000')) 'A new configuration should use the established default port.'

    $after = Invoke-MobileEditionLibraryConfiguration -RepositoryRoot $repo.root -Mode Inspect
    Assert-True $after.valid 'Inspect should report the saved library as ready.'
    Assert-Equal $after.path $repo.library 'Inspect should return the resolved library path.'
} finally {
    Remove-TempLibraryRepo -Root $repo.root
}

$repo = New-TempLibraryRepo
try {
    Set-Content -LiteralPath $repo.env -Value @('MALFORMED') -Encoding UTF8
    $before = Get-Content -LiteralPath $repo.env -Raw
    $apply = Invoke-MobileEditionLibraryConfiguration -RepositoryRoot $repo.root -Mode Apply -LibraryPath $repo.library
    $after = Get-Content -LiteralPath $repo.env -Raw
    Assert-True (-not $apply.valid) 'Apply should reject a malformed existing .env.'
    Assert-Equal $after $before 'Rejected Apply must not alter malformed configuration.'
} finally {
    Remove-TempLibraryRepo -Root $repo.root
}

$repo = New-TempLibraryRepo
try {
    $newlinePath = "$($repo.library)`nINJECTED=value"
    $validate = Invoke-MobileEditionLibraryConfiguration -RepositoryRoot $repo.root -Mode Validate -LibraryPath $newlinePath
    Assert-True (-not $validate.valid) 'Validate should reject line breaks in a path.'
    Assert-True (-not (Test-Path -LiteralPath $repo.env)) 'Rejected paths must not create .env.'
} finally {
    Remove-TempLibraryRepo -Root $repo.root
}

$repo = New-TempLibraryRepo
try {
    Set-Content -LiteralPath $repo.env -Value @(
        '# keep this comment',
        'LIBRARY_PATH=./old-library',
        'FEEDBACK_PORT=9456',
        'CUSTOM_SETTING=keep-me'
    ) -Encoding UTF8

    $apply = Invoke-MobileEditionLibraryConfiguration -RepositoryRoot $repo.root -Mode Apply -LibraryPath $repo.library
    $content = Get-Content -LiteralPath $repo.env
    Assert-True $apply.valid 'Apply should accept an existing replacement folder.'
    Assert-True (($content -join "`n").Contains("LIBRARY_PATH=$($repo.library)")) 'Apply should replace only the library path.'
    Assert-True (($content -join "`n").Contains('FEEDBACK_PORT=9456')) 'Apply should preserve the configured port.'
    Assert-True (($content -join "`n").Contains('CUSTOM_SETTING=keep-me')) 'Apply should preserve unrelated settings.'
    Assert-True (($content -join "`n").Contains('# keep this comment')) 'Apply should preserve comments.'

    $jsonResult = & $libraryScriptPath -Mode Inspect -RepositoryRoot $repo.root -Json | ConvertFrom-Json
    Assert-True $jsonResult.valid 'The executable script contract should emit parseable JSON.'
    Assert-Equal $jsonResult.path $repo.library 'The JSON contract should report the configured library.'
} finally {
    Remove-TempLibraryRepo -Root $repo.root
}

Write-Output 'Set-MobileEditionLibrary tests passed.'
