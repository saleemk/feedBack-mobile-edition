$ErrorActionPreference = 'Stop'

. (Join-Path -Path (Split-Path -Parent $PSScriptRoot) -ChildPath 'scripts\Setup-MobileEdition.ps1')

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

function New-TestCommand {
    param([string]$Source)
    [pscustomobject]@{
        Source = $Source
    }
}

function New-TestReport {
    param(
        [string]$Repository = 'ready',
        [string]$Docker = 'ready',
        [string]$Server = 'ready',
        [string]$Tailscale = 'ready',
        [string]$PrivateHttps = 'ready',
        [string]$HttpsUrl
    )

    $privateDetails = $null
    if ($HttpsUrl) {
        $privateDetails = @{ url = $HttpsUrl }
    }

    New-MobileEditionReport `
        -RepositoryCheck (New-MobileEditionCheck -Status $Repository -Reason "repository $Repository") `
        -DockerCheck (New-MobileEditionCheck -Status $Docker -Reason "docker $Docker") `
        -ServerCheck (New-MobileEditionCheck -Status $Server -Reason "server $Server") `
        -TailscaleCheck (New-MobileEditionCheck -Status $Tailscale -Reason "tailscale $Tailscale") `
        -PrivateHttpsCheck (New-MobileEditionCheck -Status $PrivateHttps -Reason "privateHttps $PrivateHttps" -Details $privateDetails)
}

function New-TempSetupRepo {
    $root = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("mobile-edition-setup-test-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $root | Out-Null
    New-Item -ItemType Directory -Path (Join-Path -Path $root -ChildPath 'library') | Out-Null
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath '.env.example') -Value @(
        '# example',
        'LIBRARY_PATH=./library',
        '',
        'FEEDBACK_PORT=8000'
    ) -Encoding UTF8
    [pscustomobject]@{
        root = $root
        library = Join-Path -Path $root -ChildPath 'library'
        env = Join-Path -Path $root -ChildPath '.env'
        example = Join-Path -Path $root -ChildPath '.env.example'
    }
}

function Remove-TempSetupRepo {
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

$repo = New-TempSetupRepo
try {
    $created = Set-MobileEditionEnvFile -EnvPath $repo.env -EnvExamplePath $repo.example -LibraryPath $repo.library -Port 8000
    Assert-Equal $created.status 'ready' '.env creation should succeed.'
    Assert-True (Test-Path -LiteralPath $repo.env -PathType Leaf) '.env should be created from the example.'
    $createdContent = Get-Content -LiteralPath $repo.env
    Assert-True (($createdContent -join "`n").Contains("LIBRARY_PATH=$($repo.library)")) '.env should contain the chosen library path.'
    Assert-True (($createdContent -join "`n").Contains('FEEDBACK_PORT=8000')) '.env should contain the default port.'
} finally {
    Remove-TempSetupRepo -Root $repo.root
}

$repo = New-TempSetupRepo
try {
    Set-Content -LiteralPath $repo.env -Value @(
        '# keep this comment',
        'UNRELATED=value',
        'LIBRARY_PATH=C:\old',
        '# another comment',
        'FEEDBACK_PORT=7000'
    ) -Encoding UTF8
    $updated = Set-MobileEditionEnvFile -EnvPath $repo.env -EnvExamplePath $repo.example -LibraryPath $repo.library -Port 8123
    Assert-Equal $updated.status 'ready' 'Surgical .env update should succeed.'
    $updatedContent = Get-Content -LiteralPath $repo.env
    Assert-Equal $updatedContent[0] '# keep this comment' 'Comments should be preserved.'
    Assert-Equal $updatedContent[1] 'UNRELATED=value' 'Unrelated keys should be preserved.'
    Assert-Equal $updatedContent[2] "LIBRARY_PATH=$($repo.library)" 'LIBRARY_PATH should be updated in place.'
    Assert-Equal $updatedContent[3] '# another comment' 'Ordering should be preserved.'
    Assert-Equal $updatedContent[4] 'FEEDBACK_PORT=8123' 'FEEDBACK_PORT should be updated in place.'
} finally {
    Remove-TempSetupRepo -Root $repo.root
}

$repo = New-TempSetupRepo
try {
    $missingLibrary = Resolve-MobileEditionLibraryChoice -RepositoryRoot $repo.root -LibraryPath (Join-Path -Path $repo.root -ChildPath 'missing-library')
    Assert-True (-not $missingLibrary.valid) 'Missing library paths should be rejected.'
    $blankLibrary = Resolve-MobileEditionLibraryChoice -RepositoryRoot $repo.root -LibraryPath ''
    Assert-True (-not $blankLibrary.valid) 'Blank library paths should be rejected.'

    $defaultPort = Get-MobileEditionPortChoice -RequestedPort $null -CurrentPort $null
    Assert-Equal $defaultPort.port 8000 'Default port should be 8000.'
    $explicitPort = Get-MobileEditionPortChoice -RequestedPort 8123 -CurrentPort $null
    Assert-Equal $explicitPort.port 8123 'Explicit port should be accepted.'
    $invalidPort = Get-MobileEditionPortChoice -RequestedPort 70000 -CurrentPort $null
    Assert-True (-not $invalidPort.valid) 'Invalid explicit ports should be rejected.'
} finally {
    Remove-TempSetupRepo -Root $repo.root
}

$repo = New-TempSetupRepo
try {
    Set-Content -LiteralPath $repo.env -Value @('UNRELATED=value') -Encoding UTF8
    $before = Get-Content -LiteralPath $repo.env
    $dryRun = Set-MobileEditionEnvFile -EnvPath $repo.env -EnvExamplePath $repo.example -LibraryPath $repo.library -Port 8000 -DryRun
    $after = Get-Content -LiteralPath $repo.env
    Assert-Equal $dryRun.status 'ready' '-WhatIf env update should still plan successfully.'
    Assert-Equal ($after -join "`n") ($before -join "`n") '-WhatIf env update should not mutate .env.'
} finally {
    Remove-TempSetupRepo -Root $repo.root
}

$whatIfRepo = New-TempSetupRepo
try {
    $promptCalled = $false
    $confirmCalled = $false
    $whatIfOutput = @(Invoke-MobileEditionGuidedSetup `
        -RepositoryRoot $whatIfRepo.root `
        -Port 8123 `
        -PromptHandler { param($Prompt) $script:promptCalled = $true; throw 'Prompt should not be called during -WhatIf.' } `
        -ConfirmHandler { param($Prompt) $script:confirmCalled = $true; throw 'Confirmation should not be called during -WhatIf.' } `
        -DoctorRunner { param($RepositoryRoot) New-TestReport -Repository 'needs_action' -Docker 'needs_action' -Server 'needs_action' -Tailscale 'ready' -PrivateHttps 'needs_action' } `
        -DryRun)
    $whatIfResult = $whatIfOutput | Where-Object { $_ -isnot [string] } | Select-Object -Last 1
    $whatIfText = ($whatIfOutput | Where-Object { $_ -is [string] }) -join "`n"
    Assert-Equal $whatIfResult.status 'whatif' '-WhatIf should return a preview status.'
    Assert-True (-not $promptCalled) '-WhatIf should not prompt for input.'
    Assert-True (-not $confirmCalled) '-WhatIf should not ask confirmations.'
    Assert-True (-not (Test-Path -LiteralPath $whatIfRepo.env)) '-WhatIf should not create .env.'
    Assert-True $whatIfText.Contains('docker compose -f docker-compose.release.yml up -d --build') '-WhatIf should preview Docker start.'
    Assert-True $whatIfText.Contains('tailscale serve --bg 8123') '-WhatIf should preview the private HTTPS step.'
} finally {
    Remove-TempSetupRepo -Root $whatIfRepo.root
}

$invalidWhatIfRepo = New-TempSetupRepo
try {
    $invalidWhatIfOutput = @(Invoke-MobileEditionGuidedSetup `
        -RepositoryRoot $invalidWhatIfRepo.root `
        -LibraryPath (Join-Path -Path $invalidWhatIfRepo.root -ChildPath 'missing-library') `
        -Port 8123 `
        -PromptHandler { param($Prompt) throw 'Prompt should not be called during invalid -WhatIf.' } `
        -ConfirmHandler { param($Prompt) throw 'Confirmation should not be called during invalid -WhatIf.' } `
        -DoctorRunner { param($RepositoryRoot) New-TestReport -Repository 'needs_action' -Docker 'needs_action' -Server 'needs_action' -Tailscale 'ready' -PrivateHttps 'needs_action' } `
        -DryRun)
    $invalidWhatIfResult = $invalidWhatIfOutput | Where-Object { $_ -isnot [string] } | Select-Object -Last 1
    $invalidWhatIfText = ($invalidWhatIfOutput | Where-Object { $_ -is [string] }) -join "`n"
    Assert-Equal $invalidWhatIfResult.status 'partial' 'Invalid explicit library -WhatIf should end in a partial preview.'
    Assert-True $invalidWhatIfText.Contains('would stop before changing .env') 'Invalid explicit library -WhatIf should explain why setup stops.'
    Assert-True (-not $invalidWhatIfText.Contains('docker compose -f docker-compose.release.yml up -d --build')) 'Invalid explicit library -WhatIf should not preview Docker startup.'
    Assert-True (-not $invalidWhatIfText.Contains('tailscale serve --bg')) 'Invalid explicit library -WhatIf should not preview Tailscale Serve.'
    Assert-True (-not (Test-Path -LiteralPath $invalidWhatIfRepo.env)) 'Invalid explicit library -WhatIf should not create .env.'
} finally {
    Remove-TempSetupRepo -Root $invalidWhatIfRepo.root
}

$overrideRepo = New-TempSetupRepo
try {
    $newLibrary = Join-Path -Path $overrideRepo.root -ChildPath 'new-library'
    New-Item -ItemType Directory -Path $newLibrary | Out-Null
    Set-Content -LiteralPath $overrideRepo.env -Value @(
        '# keep',
        'LIBRARY_PATH=./library',
        'UNCHANGED=yes',
        'FEEDBACK_PORT=8000'
    ) -Encoding UTF8
    $overrideReports = @(
        (New-TestReport -Repository 'ready' -Docker 'ready' -Server 'ready' -Tailscale 'ready' -PrivateHttps 'ready' -HttpsUrl 'https://desktop.tailnet.ts.net'),
        (New-TestReport -Repository 'ready' -Docker 'ready' -Server 'ready' -Tailscale 'ready' -PrivateHttps 'ready' -HttpsUrl 'https://desktop.tailnet.ts.net'),
        (New-TestReport -Repository 'ready' -Docker 'ready' -Server 'ready' -Tailscale 'ready' -PrivateHttps 'ready' -HttpsUrl 'https://desktop.tailnet.ts.net')
    )
    $overrideIndex = 0
    $overrideResult = Invoke-MobileEditionGuidedSetup `
        -RepositoryRoot $overrideRepo.root `
        -LibraryPath $newLibrary `
        -Port 8123 `
        -ConfirmHandler { param($Prompt) $true } `
        -DoctorRunner {
            param($RepositoryRoot)
            $report = $overrideReports[$overrideIndex]
            if ($overrideIndex -lt ($overrideReports.Count - 1)) {
                $script:overrideIndex += 1
            }
            $report
        } | Select-Object -Last 1
    Assert-Equal $overrideResult.status 'ready' 'Explicit overrides should still complete when the repo starts ready.'
    $overrideContent = Get-Content -LiteralPath $overrideRepo.env
    Assert-Equal $overrideContent[0] '# keep' 'Explicit override should preserve comments.'
    Assert-Equal $overrideContent[1] "LIBRARY_PATH=$newLibrary" 'Explicit LibraryPath override should update .env.'
    Assert-Equal $overrideContent[2] 'UNCHANGED=yes' 'Explicit override should preserve unrelated keys.'
    Assert-Equal $overrideContent[3] 'FEEDBACK_PORT=8123' 'Explicit Port override should update .env.'
} finally {
    Remove-TempSetupRepo -Root $overrideRepo.root
}

$declinedDockerCalled = $false
$declinedDocker = Invoke-MobileEditionDockerStart `
    -RepositoryRoot 'C:\MobileEdition' `
    -DockerCommand (New-TestCommand -Source 'docker') `
    -ConfirmHandler { param($Prompt) $false } `
    -CommandRunner { $script:declinedDockerCalled = $true; [pscustomobject]@{ exitCode = 0; output = '' } }
Assert-Equal $declinedDocker.status 'declined' 'Declined Docker confirmation should return declined.'
Assert-True (-not $declinedDockerCalled) 'Declined Docker confirmation should not run a command.'

$dockerSuccess = Invoke-MobileEditionDockerStart `
    -RepositoryRoot 'C:\MobileEdition' `
    -DockerCommand (New-TestCommand -Source 'docker') `
    -ConfirmHandler { param($Prompt) $true } `
    -CommandRunner { param($FilePath, $Arguments, $WorkingDirectory) [pscustomobject]@{ exitCode = 0; output = 'started' } }
Assert-Equal $dockerSuccess.status 'ready' 'Docker success should report ready.'

$dockerFailure = Invoke-MobileEditionDockerStart `
    -RepositoryRoot 'C:\MobileEdition' `
    -DockerCommand (New-TestCommand -Source 'docker') `
    -ConfirmHandler { param($Prompt) $true } `
    -CommandRunner { param($FilePath, $Arguments, $WorkingDirectory) [pscustomobject]@{ exitCode = 1; output = "first error`nsecond error`nthird error`nfourth error" } }
Assert-Equal $dockerFailure.status 'failed' 'Docker failure should report failed.'
Assert-True $dockerFailure.reason.Contains('first error second error third error') 'Docker failure should include an actionable summary.'
Assert-True (-not $dockerFailure.reason.Contains('fourth error')) 'Docker failure summary should stay concise.'

$matchingServeJson = ConvertFrom-Json @'
{
  "Web": {
    "desktop.tailnet.ts.net:443": {
      "Handlers": {
        "/": { "Proxy": "http://127.0.0.1:8000" },
        "/docs": { "Proxy": "http://127.0.0.1:3000" }
      }
    }
  }
}
'@
$matchingDecision = Get-MobileEditionServeDecision -ServeJson $matchingServeJson -Port 8000
Assert-Equal $matchingDecision.status 'ready' 'Existing matching Serve configuration should remain unchanged.'
Assert-Equal $matchingDecision.url 'https://desktop.tailnet.ts.net' 'Matching Serve configuration should return the HTTPS URL.'

$absentServeJson = ConvertFrom-Json @'
{
  "Web": {
    "desktop.tailnet.ts.net:443": {
      "Handlers": {
        "/docs": { "Proxy": "http://127.0.0.1:8000" }
      }
    }
  }
}
'@
$absentDecision = Get-MobileEditionServeDecision -ServeJson $absentServeJson -Port 8000
Assert-Equal $absentDecision.status 'absent' 'A missing root Serve handler should allow setup.'
Assert-Equal $absentDecision.command 'tailscale serve --bg 8000' 'Absent root Serve handler should propose the correct command.'

$conflictServeJson = ConvertFrom-Json @'
{
  "Web": {
    "desktop.tailnet.ts.net:443": {
      "Handlers": {
        "/": { "Proxy": "http://127.0.0.1:3000" },
        "/docs": { "Proxy": "http://127.0.0.1:8000" }
      }
    }
  }
}
'@
$conflictDecision = Get-MobileEditionServeDecision -ServeJson $conflictServeJson -Port 8000
Assert-Equal $conflictDecision.status 'conflict' 'A conflicting root Serve handler should block mutation.'

$serveCommandCalls = @()
$serveAlreadyReady = Invoke-MobileEditionServeSetup `
    -RepositoryRoot 'C:\MobileEdition' `
    -Port 8000 `
    -TailscaleCommand (New-TestCommand -Source 'tailscale') `
    -ConfirmHandler { param($Prompt) $true } `
    -CommandRunner {
        param($FilePath, $Arguments, $WorkingDirectory)
        $script:serveCommandCalls += ($Arguments -join ' ')
        [pscustomobject]@{ exitCode = 0; output = ($matchingServeJson | ConvertTo-Json -Depth 8) }
    }
Assert-Equal $serveAlreadyReady.status 'ready' 'Existing matching Serve setup should report ready.'
Assert-Equal $serveCommandCalls.Count 1 'Existing matching Serve setup should only inspect status.'

$serveAbsentCalls = @()
$serveConfigured = Invoke-MobileEditionServeSetup `
    -RepositoryRoot 'C:\MobileEdition' `
    -Port 8000 `
    -TailscaleCommand (New-TestCommand -Source 'tailscale') `
    -ConfirmHandler { param($Prompt) $true } `
    -CommandRunner {
        param($FilePath, $Arguments, $WorkingDirectory)
        $script:serveAbsentCalls += ($Arguments -join ' ')
        if (($Arguments -join ' ') -eq 'serve status --json') {
            return [pscustomobject]@{ exitCode = 0; output = ($absentServeJson | ConvertTo-Json -Depth 8) }
        }
        [pscustomobject]@{ exitCode = 0; output = 'started' }
    }
Assert-Equal $serveConfigured.status 'ready' 'Absent root Serve setup should run after approval.'
Assert-True (($serveAbsentCalls -join '|').Contains('serve --bg 8000')) 'Serve setup should run the configured port command.'

$serveConflictCalls = @()
$serveConflict = Invoke-MobileEditionServeSetup `
    -RepositoryRoot 'C:\MobileEdition' `
    -Port 8000 `
    -TailscaleCommand (New-TestCommand -Source 'tailscale') `
    -ConfirmHandler { param($Prompt) $true } `
    -CommandRunner {
        param($FilePath, $Arguments, $WorkingDirectory)
        $script:serveConflictCalls += ($Arguments -join ' ')
        [pscustomobject]@{ exitCode = 0; output = ($conflictServeJson | ConvertTo-Json -Depth 8) }
    }
Assert-Equal $serveConflict.status 'conflict' 'Conflicting root Serve setup should not mutate.'
Assert-Equal $serveConflictCalls.Count 1 'Conflicting root Serve setup should only inspect status.'

$serverNotReadyCalls = @()
$serverNotReadyRepo = New-TempSetupRepo
try {
    Set-Content -LiteralPath $serverNotReadyRepo.env -Value @(
        "LIBRARY_PATH=$($serverNotReadyRepo.library)",
        'FEEDBACK_PORT=8000'
    ) -Encoding UTF8
    $serverNotReadyReports = @(
        (New-TestReport -Repository 'ready' -Docker 'needs_action' -Server 'needs_action' -Tailscale 'ready' -PrivateHttps 'needs_action'),
        (New-TestReport -Repository 'ready' -Docker 'needs_action' -Server 'needs_action' -Tailscale 'ready' -PrivateHttps 'needs_action'),
        (New-TestReport -Repository 'ready' -Docker 'ready' -Server 'needs_action' -Tailscale 'ready' -PrivateHttps 'needs_action'),
        (New-TestReport -Repository 'ready' -Docker 'ready' -Server 'needs_action' -Tailscale 'ready' -PrivateHttps 'needs_action')
    )
    $serverNotReadyIndex = 0
    $serverNotReadyResult = Invoke-MobileEditionGuidedSetup `
        -RepositoryRoot $serverNotReadyRepo.root `
        -Port 8000 `
        -ConfirmHandler { param($Prompt) $true } `
        -CommandRunner {
            param($FilePath, $Arguments, $WorkingDirectory)
            $script:serverNotReadyCalls += ($Arguments -join ' ')
            [pscustomobject]@{ exitCode = 0; output = 'ok' }
        } `
        -DoctorRunner {
            param($RepositoryRoot)
            $report = $serverNotReadyReports[$serverNotReadyIndex]
            if ($serverNotReadyIndex -lt ($serverNotReadyReports.Count - 1)) {
                $script:serverNotReadyIndex += 1
            }
            $report
        } | Select-Object -Last 1
    Assert-Equal $serverNotReadyResult.status 'blocked' 'Server-not-ready flow should remain blocked.'
    Assert-True (-not (($serverNotReadyCalls -join '|').Contains('serve --bg'))) 'Tailscale Serve should not be offered until the local server is ready.'
} finally {
    Remove-TempSetupRepo -Root $serverNotReadyRepo.root
}

$flowRepo = New-TempSetupRepo
try {
    $reports = @(
        (New-TestReport -Repository 'needs_action' -Docker 'needs_action' -Server 'needs_action' -Tailscale 'needs_action' -PrivateHttps 'needs_action'),
        (New-TestReport -Repository 'ready' -Docker 'needs_action' -Server 'needs_action' -Tailscale 'ready' -PrivateHttps 'needs_action'),
        (New-TestReport -Repository 'ready' -Docker 'ready' -Server 'ready' -Tailscale 'ready' -PrivateHttps 'needs_action'),
        (New-TestReport -Repository 'ready' -Docker 'ready' -Server 'ready' -Tailscale 'ready' -PrivateHttps 'ready' -HttpsUrl 'https://desktop.tailnet.ts.net')
    )
    $index = 0
    $flowResult = Invoke-MobileEditionGuidedSetup `
        -RepositoryRoot $flowRepo.root `
        -LibraryPath $flowRepo.library `
        -Port 8000 `
        -ConfirmHandler { param($Prompt) $true } `
        -CommandRunner {
            param($FilePath, $Arguments, $WorkingDirectory)
            [pscustomobject]@{ exitCode = 0; output = ($absentServeJson | ConvertTo-Json -Depth 8) }
        } `
        -DoctorRunner {
            param($RepositoryRoot)
            $report = $script:reports[$script:index]
            if ($script:index -lt ($script:reports.Count - 1)) {
                $script:index += 1
            }
            $report
        } | Select-Object -Last 1
    Assert-Equal $flowResult.status 'ready' 'Guided setup should rerun the doctor and report final ready state.'
} finally {
    Remove-TempSetupRepo -Root $flowRepo.root
}

$partialRepo = New-TempSetupRepo
try {
    $partial = Invoke-MobileEditionGuidedSetup `
        -RepositoryRoot $partialRepo.root `
        -LibraryPath (Join-Path -Path $partialRepo.root -ChildPath 'missing') `
        -Port 8000 `
        -ConfirmHandler { param($Prompt) $true } `
        -DoctorRunner { param($RepositoryRoot) New-TestReport -Repository 'needs_action' -Docker 'needs_action' -Server 'needs_action' -Tailscale 'needs_action' -PrivateHttps 'needs_action' } | Select-Object -Last 1
    Assert-Equal $partial.status 'partial' 'Invalid library path should end in a partial state.'
} finally {
    Remove-TempSetupRepo -Root $partialRepo.root
}

$entryRepo = New-TempSetupRepo
try {
    $setupScript = Join-Path -Path (Split-Path -Parent $PSScriptRoot) -ChildPath 'scripts\Setup-MobileEdition.ps1'
    $entryOutput = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $setupScript -WhatIf -LibraryPath $entryRepo.library 2>&1 | ForEach-Object { $_.ToString() })
    Assert-True (($entryOutput -join "`n").Contains('Mobile Edition Guided Setup')) 'Real entry point should print guided setup output.'
    Assert-True (($entryOutput -join "`n").Contains('What if:')) 'Real entry point should print -WhatIf preview output.'
    Assert-True (-not (($entryOutput -join "`n").Contains('@{status='))) 'Real entry point should suppress only the structured return object.'
} finally {
    Remove-TempSetupRepo -Root $entryRepo.root
}

Write-Output 'Setup-MobileEdition.Tests.ps1 passed.'
