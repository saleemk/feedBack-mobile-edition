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

function New-TestPngBytes {
    $bytes = New-Object byte[] 160
    $signature = [byte[]](0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    for ($index = 0; $index -lt $signature.Length; $index += 1) {
        $bytes[$index] = $signature[$index]
    }
    $bytes
}

function New-TestQrPayload {
    [System.Convert]::ToBase64String((New-TestPngBytes))
}

function Remove-TestDeviceGuide {
    $path = Get-MobileEditionDeviceGuidePath
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force
    }
}

Assert-True (Test-MobileEditionPrivateHttpsUrl -Url 'https://desktop.tailnet.ts.net') 'HTTPS URLs should be accepted for device guide generation.'
Assert-True (-not (Test-MobileEditionPrivateHttpsUrl -Url 'http://desktop.tailnet.ts.net')) 'HTTP URLs should be rejected for device guide generation.'
Assert-True (-not (Test-MobileEditionPrivateHttpsUrl -Url 'not a url')) 'Malformed URLs should be rejected for device guide generation.'

$decodedQr = ConvertFrom-MobileEditionQrPayload -Payload (New-TestQrPayload)
Assert-True $decodedQr.valid 'Valid QR payloads should decode to PNG bytes.'
$blankQr = ConvertFrom-MobileEditionQrPayload -Payload ''
Assert-True (-not $blankQr.valid) 'Blank QR payloads should be rejected.'
$badQr = ConvertFrom-MobileEditionQrPayload -Payload ([System.Convert]::ToBase64String([byte[]](1, 2, 3, 4)))
Assert-True (-not $badQr.valid) 'Non-PNG QR payloads should be rejected.'

$htmlUrl = 'https://desktop.tailnet.ts.net/mobile?name=Saleem&mode=%3Cready%3E'
$guideHtml = New-MobileEditionDeviceGuideHtml -Url $htmlUrl -QrPngBytes (New-TestPngBytes)
$encodedHtmlUrl = [System.Net.WebUtility]::HtmlEncode($htmlUrl)
Assert-True $guideHtml.Contains('<title>Connect your device</title>') 'Guide HTML should include the required title.'
Assert-True $guideHtml.Contains('data:image/png;base64,') 'Guide HTML should embed the QR image as a data URL.'
Assert-True $guideHtml.Contains($encodedHtmlUrl) 'Guide HTML should HTML-encode the private URL.'
Assert-True $guideHtml.Contains('Tailscale') 'Guide HTML should include Tailscale device steps.'
Assert-True $guideHtml.Contains('Add to Home Screen') 'Guide HTML should include iPhone/iPad install guidance.'
Assert-True $guideHtml.Contains('Install app') 'Guide HTML should include Android install guidance.'
Assert-True $guideHtml.Contains('Open the installed app once while connected') 'Guide HTML should tell users to cache the app while connected.'
Assert-True $guideHtml.Contains('Download the songs') 'Guide HTML should tell users to download offline songs.'
Assert-True (-not ($guideHtml -match '<script')) 'Guide HTML should not include scripts.'
Assert-True (-not ($guideHtml -match 'rel="stylesheet"')) 'Guide HTML should not include external stylesheets.'
Assert-True (-not ($guideHtml -match 'src="https?://')) 'Guide HTML should not include external image resources.'

Remove-TestDeviceGuide
try {
    $declinedGuideCommandCalled = $false
    $declinedGuideBrowserCalled = $false
    $declinedGuideOutput = @(Invoke-MobileEditionDeviceGuide `
        -RepositoryRoot 'C:\MobileEdition' `
        -Url 'https://desktop.tailnet.ts.net' `
        -DockerCommand (New-TestCommand -Source 'docker') `
        -ConfirmHandler { param($Prompt) $false } `
        -CommandRunner { $script:declinedGuideCommandCalled = $true; throw 'QR helper should not run when guide is declined.' } `
        -BrowserLauncher { param($Path) $script:declinedGuideBrowserCalled = $true; throw 'Browser should not launch when guide is declined.' })
    $declinedGuide = $declinedGuideOutput | Where-Object { $_ -isnot [string] } | Select-Object -Last 1
    Assert-Equal $declinedGuide.status 'declined' 'Declined guide confirmation should return declined.'
    Assert-True (-not $declinedGuideCommandCalled) 'Declined guide confirmation should not run the QR helper.'
    Assert-True (-not $declinedGuideBrowserCalled) 'Declined guide confirmation should not launch the browser.'
    Assert-True (-not (Test-Path -LiteralPath (Get-MobileEditionDeviceGuidePath) -PathType Leaf)) 'Declined guide should not write a file.'
} finally {
    Remove-TestDeviceGuide
}

try {
    $guideCommands = @()
    $openedGuidePaths = @()
    $successfulGuideOutput = @(Invoke-MobileEditionDeviceGuide `
        -RepositoryRoot 'C:\MobileEdition' `
        -Url 'https://desktop.tailnet.ts.net' `
        -DockerCommand (New-TestCommand -Source 'docker') `
        -ConfirmHandler { param($Prompt) $true } `
        -CommandRunner {
            param($FilePath, $Arguments, $WorkingDirectory)
            $script:guideCommands += ($Arguments -join ' ')
            [pscustomobject]@{ exitCode = 0; output = (New-TestQrPayload) }
        } `
        -BrowserLauncher { param($Path) $script:openedGuidePaths += $Path })
    $successfulGuide = $successfulGuideOutput | Where-Object { $_ -isnot [string] } | Select-Object -Last 1
    Assert-Equal $successfulGuide.status 'ready' 'Accepted guide should be created and opened.'
    Assert-Equal $successfulGuide.path (Get-MobileEditionDeviceGuidePath) 'Accepted guide should target the known temp file.'
    Assert-True (($guideCommands -join '|').Contains('exec -T web python /app/scripts/Generate-MobileEditionQr.py')) 'Guide should invoke the container QR helper.'
    Assert-Equal $openedGuidePaths.Count 1 'Accepted guide should launch the generated file once.'
    Assert-Equal $openedGuidePaths[0] (Get-MobileEditionDeviceGuidePath) 'Browser launch should receive the known temp guide path.'
    $writtenGuide = Get-Content -LiteralPath (Get-MobileEditionDeviceGuidePath) -Raw
    Assert-True $writtenGuide.Contains('Connect your device') 'Generated guide should contain the required page title.'
    Assert-True $writtenGuide.Contains('https://desktop.tailnet.ts.net') 'Generated guide should preserve the visible private URL.'
} finally {
    Remove-TestDeviceGuide
}

try {
    $failedGuideBrowserCalled = $false
    $failedGuideOutput = @(Invoke-MobileEditionDeviceGuide `
        -RepositoryRoot 'C:\MobileEdition' `
        -Url 'https://desktop.tailnet.ts.net' `
        -DockerCommand (New-TestCommand -Source 'docker') `
        -ConfirmHandler { param($Prompt) $true } `
        -CommandRunner { param($FilePath, $Arguments, $WorkingDirectory) [pscustomobject]@{ exitCode = 1; output = 'container unavailable' } } `
        -BrowserLauncher { param($Path) $script:failedGuideBrowserCalled = $true })
    $failedGuide = $failedGuideOutput | Where-Object { $_ -isnot [string] } | Select-Object -Last 1
    Assert-Equal $failedGuide.status 'failed' 'QR command failure should be reported as guide failure.'
    Assert-True $failedGuide.reason.Contains('QR generation failed') 'QR command failure should be summarized.'
    Assert-True (-not $failedGuideBrowserCalled) 'QR command failure should not launch a browser.'
    Assert-True (-not (Test-Path -LiteralPath (Get-MobileEditionDeviceGuidePath) -PathType Leaf)) 'QR command failure should not write the guide.'
} finally {
    Remove-TestDeviceGuide
}

try {
    $browserFailureGuideOutput = @(Invoke-MobileEditionDeviceGuide `
        -RepositoryRoot 'C:\MobileEdition' `
        -Url 'https://desktop.tailnet.ts.net' `
        -DockerCommand (New-TestCommand -Source 'docker') `
        -ConfirmHandler { param($Prompt) $true } `
        -CommandRunner { param($FilePath, $Arguments, $WorkingDirectory) [pscustomobject]@{ exitCode = 0; output = (New-TestQrPayload) } } `
        -BrowserLauncher { param($Path) throw 'browser blocked' })
    $browserFailureGuide = $browserFailureGuideOutput | Where-Object { $_ -isnot [string] } | Select-Object -Last 1
    Assert-Equal $browserFailureGuide.status 'failed' 'Browser launch failure should be nonfatal to setup readiness.'
    Assert-True $browserFailureGuide.reason.Contains('could not be opened') 'Browser launch failure should be concise.'
    Assert-True (Test-Path -LiteralPath (Get-MobileEditionDeviceGuidePath) -PathType Leaf) 'Browser launch failure should retain the written local guide.'
} finally {
    Remove-TestDeviceGuide
}

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

$whatIfReadyRepo = New-TempSetupRepo
try {
    Set-Content -LiteralPath $whatIfReadyRepo.env -Value @(
        "LIBRARY_PATH=$($whatIfReadyRepo.library)",
        'FEEDBACK_PORT=8000'
    ) -Encoding UTF8
    $whatIfReadyOutput = @(Invoke-MobileEditionGuidedSetup `
        -RepositoryRoot $whatIfReadyRepo.root `
        -ConfirmHandler { param($Prompt) throw 'Confirmation should not be called during ready -WhatIf.' } `
        -CommandRunner { param($FilePath, $Arguments, $WorkingDirectory) throw 'Command runner should not be called during ready -WhatIf.' } `
        -BrowserLauncher { param($Path) throw 'Browser should not launch during ready -WhatIf.' } `
        -DoctorRunner { param($RepositoryRoot) New-TestReport -Repository 'ready' -Docker 'ready' -Server 'ready' -Tailscale 'ready' -PrivateHttps 'ready' -HttpsUrl 'https://desktop.tailnet.ts.net' } `
        -DryRun)
    $whatIfReadyText = ($whatIfReadyOutput | Where-Object { $_ -is [string] }) -join "`n"
    Assert-True $whatIfReadyText.Contains('would offer to generate and open a local phone/tablet QR guide') '-WhatIf should preview guide creation when private HTTPS is already ready.'
    Assert-True (-not (Test-Path -LiteralPath (Get-MobileEditionDeviceGuidePath) -PathType Leaf)) '-WhatIf should not write the device guide.'
} finally {
    Remove-TestDeviceGuide
    Remove-TempSetupRepo -Root $whatIfReadyRepo.root
}

$guidedReadyRepo = New-TempSetupRepo
try {
    Set-Content -LiteralPath $guidedReadyRepo.env -Value @(
        "LIBRARY_PATH=$($guidedReadyRepo.library)",
        'FEEDBACK_PORT=8000'
    ) -Encoding UTF8
    $guidedReadyOpened = @()
    $guidedReadyOutput = @(Invoke-MobileEditionGuidedSetup `
        -RepositoryRoot $guidedReadyRepo.root `
        -ConfirmHandler { param($Prompt) $true } `
        -CommandRunner { param($FilePath, $Arguments, $WorkingDirectory) [pscustomobject]@{ exitCode = 0; output = (New-TestQrPayload) } } `
        -BrowserLauncher { param($Path) $script:guidedReadyOpened += $Path } `
        -DoctorRunner { param($RepositoryRoot) New-TestReport -Repository 'ready' -Docker 'ready' -Server 'ready' -Tailscale 'ready' -PrivateHttps 'ready' -HttpsUrl 'https://desktop.tailnet.ts.net' })
    $guidedReadyResult = $guidedReadyOutput | Where-Object { $_ -isnot [string] } | Select-Object -Last 1
    $guidedReadyText = ($guidedReadyOutput | Where-Object { $_ -is [string] }) -join "`n"
    Assert-Equal $guidedReadyResult.status 'ready' 'Ready guided setup should remain ready after guide creation.'
    Assert-Equal $guidedReadyResult.deviceGuide.status 'ready' 'Ready guided setup should include a ready guide result.'
    Assert-True $guidedReadyText.Contains('Open: https://desktop.tailnet.ts.net') 'Ready guided setup should keep the visible text URL.'
    Assert-Equal $guidedReadyOpened.Count 1 'Ready guided setup should open the guide once after confirmation.'
} finally {
    Remove-TestDeviceGuide
    Remove-TempSetupRepo -Root $guidedReadyRepo.root
}

$guidedNoUrlRepo = New-TempSetupRepo
try {
    Set-Content -LiteralPath $guidedNoUrlRepo.env -Value @(
        "LIBRARY_PATH=$($guidedNoUrlRepo.library)",
        'FEEDBACK_PORT=8000'
    ) -Encoding UTF8
    $guidedNoUrlConfirmCalled = $false
    $guidedNoUrlResult = Invoke-MobileEditionGuidedSetup `
        -RepositoryRoot $guidedNoUrlRepo.root `
        -ConfirmHandler { param($Prompt) $script:guidedNoUrlConfirmCalled = $true; $true } `
        -CommandRunner { param($FilePath, $Arguments, $WorkingDirectory) throw 'QR helper should not run without ready private HTTPS.' } `
        -BrowserLauncher { param($Path) throw 'Browser should not launch without ready private HTTPS.' } `
        -DoctorRunner { param($RepositoryRoot) New-TestReport -Repository 'ready' -Docker 'ready' -Server 'ready' -Tailscale 'needs_action' -PrivateHttps 'needs_action' } | Select-Object -Last 1
    Assert-Equal $guidedNoUrlResult.status 'local_ready_mobile_setup_remaining' 'Setup without private HTTPS should keep local-ready status.'
    Assert-True (-not $guidedNoUrlConfirmCalled) 'Setup without ready private HTTPS should not offer the guide.'
} finally {
    Remove-TempSetupRepo -Root $guidedNoUrlRepo.root
}

Write-Output 'Setup-MobileEdition.Tests.ps1 passed.'
