$ErrorActionPreference = 'Stop'

$deviceActionScriptPath = Join-Path -Path (Split-Path -Parent $PSScriptRoot) -ChildPath 'scripts\Invoke-MobileEditionDeviceAction.ps1'
. $deviceActionScriptPath

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
        [string]$PrivateHttps = 'needs_action',
        [string]$HttpsUrl,
        [string]$PrivateReason
    )

    $privateDetails = $null
    if ($HttpsUrl) {
        $privateDetails = @{ url = $HttpsUrl }
    }
    if (-not $PrivateReason) {
        $PrivateReason = "private HTTPS $PrivateHttps"
    }

    New-MobileEditionReport `
        -RepositoryCheck (New-MobileEditionCheck -Status $Repository -Reason "repository $Repository") `
        -DockerCheck (New-MobileEditionCheck -Status $Docker -Reason "docker $Docker") `
        -ServerCheck (New-MobileEditionCheck -Status $Server -Reason "server $Server") `
        -TailscaleCheck (New-MobileEditionCheck -Status $Tailscale -Reason "tailscale $Tailscale") `
        -PrivateHttpsCheck (New-MobileEditionCheck -Status $PrivateHttps -Reason $PrivateReason -Details $privateDetails)
}

function New-TempDeviceRepo {
    param([int]$Port = 8123)

    $root = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("mobile-edition-device-action-test-" + [guid]::NewGuid().ToString('N'))
    $library = Join-Path -Path $root -ChildPath 'library'
    New-Item -ItemType Directory -Path $library -Force | Out-Null
    Set-Content -LiteralPath (Join-Path -Path $root -ChildPath '.env') -Value @(
        "LIBRARY_PATH=$library",
        "FEEDBACK_PORT=$Port"
    ) -Encoding UTF8
    [pscustomobject]@{
        root = $root
        library = $library
    }
}

function Remove-TempDeviceRepo {
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

$repoRoot = 'C:\MobileEdition'

$allowlistRejected = $false
try {
    Invoke-MobileEditionDeviceAction -RepositoryRoot $repoRoot -Action ResetTailscale | Out-Null
} catch {
    $allowlistRejected = $true
}
Assert-True $allowlistRejected 'The device action allowlist should reject unsupported actions.'

$repo = New-TempDeviceRepo -Port 8123
try {
    $serveCalled = $false
    $repositoryBlocked = Invoke-MobileEditionDeviceAction `
        -RepositoryRoot $repo.root `
        -Action EnableHttps `
        -DoctorRunner { param($RepositoryRoot) New-TestReport -Repository 'needs_action' } `
        -ServeRunner { $script:serveCalled = $true; throw 'Serve should not run when repository is not ready.' }
    Assert-Equal $repositoryBlocked.status 'needs_action' 'Repository readiness should be required for EnableHttps.'
    Assert-True (-not $serveCalled) 'Repository-blocked EnableHttps should not call Serve.'
} finally {
    Remove-TempDeviceRepo -Root $repo.root
}

$repo = New-TempDeviceRepo -Port 8123
try {
    $serveCalled = $false
    $serverBlocked = Invoke-MobileEditionDeviceAction `
        -RepositoryRoot $repo.root `
        -Action EnableHttps `
        -DoctorRunner { param($RepositoryRoot) New-TestReport -Server 'needs_action' } `
        -ServeRunner { $script:serveCalled = $true; throw 'Serve should not run when the server is not ready.' }
    Assert-Equal $serverBlocked.status 'needs_action' 'Server readiness should be required for EnableHttps.'
    Assert-True $serverBlocked.reason.Contains('server') 'Server prerequisite should be explained.'
    Assert-True (-not $serveCalled) 'Server-blocked EnableHttps should not call Serve.'
} finally {
    Remove-TempDeviceRepo -Root $repo.root
}

$repo = New-TempDeviceRepo -Port 8123
try {
    $serveCalled = $false
    $tailscaleBlocked = Invoke-MobileEditionDeviceAction `
        -RepositoryRoot $repo.root `
        -Action EnableHttps `
        -DoctorRunner { param($RepositoryRoot) New-TestReport -Tailscale 'unavailable' } `
        -ServeRunner { $script:serveCalled = $true; throw 'Serve should not run when Tailscale is unavailable.' }
    Assert-Equal $tailscaleBlocked.status 'needs_action' 'Tailscale readiness should be required for EnableHttps.'
    Assert-True $tailscaleBlocked.reason.Contains('Tailscale') 'Tailscale prerequisite should be explained.'
    Assert-True (-not $serveCalled) 'Tailscale-blocked EnableHttps should not call Serve.'
} finally {
    Remove-TempDeviceRepo -Root $repo.root
}

$repo = New-TempDeviceRepo -Port 8123
try {
    $serveCalls = [System.Collections.ArrayList]::new()
    $doctorCalls = 0
    $enabled = Invoke-MobileEditionDeviceAction `
        -RepositoryRoot $repo.root `
        -Action EnableHttps `
        -DoctorRunner {
            param($RepositoryRoot)
            $script:doctorCalls += 1
            if ($script:doctorCalls -eq 1) {
                return New-TestReport -PrivateHttps 'needs_action'
            }
            New-TestReport -PrivateHttps 'ready' -HttpsUrl 'https://desktop.example.ts.net'
        } `
        -ServeRunner {
            param($RepositoryRoot, $Port, $CommandRunner, $ConfirmHandler, $TailscaleCommand)
            [void]$serveCalls.Add([pscustomobject]@{
                repositoryRoot = $RepositoryRoot
                port = $Port
                confirmed = (& $ConfirmHandler -Prompt 'Confirm from UI')
            })
            [pscustomobject]@{
                status = 'ready'
                reason = 'Tailscale Serve setup command completed.'
            }
        }
    Assert-Equal $enabled.status 'ready' 'EnableHttps should be ready only after the final doctor confirms HTTPS.'
    Assert-True $enabled.changed 'EnableHttps should report changed when it configured HTTPS.'
    Assert-Equal $enabled.url 'https://desktop.example.ts.net' 'EnableHttps should return the doctor-validated URL.'
    Assert-Equal $doctorCalls 2 'EnableHttps should run the doctor before and after Serve setup.'
    Assert-Equal $serveCalls.Count 1 'EnableHttps should call Serve once.'
    Assert-Equal $serveCalls[0].port 8123 'EnableHttps should derive the configured port locally.'
    Assert-True $serveCalls[0].confirmed 'EnableHttps should pass fixed affirmative confirmation from the UI click.'
} finally {
    Remove-TempDeviceRepo -Root $repo.root
}

$repo = New-TempDeviceRepo -Port 8123
try {
    $conflict = Invoke-MobileEditionDeviceAction `
        -RepositoryRoot $repo.root `
        -Action EnableHttps `
        -DoctorRunner { param($RepositoryRoot) New-TestReport -PrivateHttps 'needs_action' -PrivateReason 'Root handler still points elsewhere.' } `
        -ServeRunner {
            param($RepositoryRoot, $Port, $CommandRunner, $ConfirmHandler, $TailscaleCommand)
            [pscustomobject]@{
                status = 'conflict'
                reason = 'Tailscale Serve already has a root HTTPS handler for another target.'
                url = 'https://desktop.example.ts.net'
            }
        }
    Assert-Equal $conflict.status 'conflict' 'EnableHttps should preserve Serve conflict status.'
    Assert-True (-not $conflict.changed) 'Serve conflict should not report mutation.'
    Assert-True $conflict.reason.Contains('root HTTPS handler') 'Serve conflict should preserve the helper reason.'
    Assert-Equal $conflict.report.checks.privateHttps.status 'needs_action' 'Conflict should preserve the final doctor report.'
} finally {
    Remove-TempDeviceRepo -Root $repo.root
}

$repo = New-TempDeviceRepo -Port 8123
try {
    $failed = Invoke-MobileEditionDeviceAction `
        -RepositoryRoot $repo.root `
        -Action EnableHttps `
        -DoctorRunner { param($RepositoryRoot) New-TestReport -PrivateHttps 'needs_action' -PrivateReason 'Serve status is not readable.' } `
        -ServeRunner {
            param($RepositoryRoot, $Port, $CommandRunner, $ConfirmHandler, $TailscaleCommand)
            [pscustomobject]@{
                status = 'failed'
                reason = 'Tailscale Serve setup failed: access denied'
            }
        }
    Assert-Equal $failed.status 'failed' 'EnableHttps should preserve Serve failure status.'
    Assert-True (-not $failed.changed) 'Serve failure should not report mutation.'
    Assert-True $failed.reason.Contains('access denied') 'Serve failure should preserve the helper reason.'
} finally {
    Remove-TempDeviceRepo -Root $repo.root
}

$repo = New-TempDeviceRepo -Port 8123
try {
    $notReady = Invoke-MobileEditionDeviceAction `
        -RepositoryRoot $repo.root `
        -Action EnableHttps `
        -DoctorRunner { param($RepositoryRoot) New-TestReport -PrivateHttps 'needs_action' -PrivateReason 'Tailscale Serve is not exposing this Edition port.' } `
        -ServeRunner {
            param($RepositoryRoot, $Port, $CommandRunner, $ConfirmHandler, $TailscaleCommand)
            [pscustomobject]@{
                status = 'ready'
                reason = 'Tailscale Serve setup command completed.'
            }
        }
    Assert-Equal $notReady.status 'needs_action' 'EnableHttps should not report ready until the doctor confirms HTTPS.'
    Assert-True $notReady.changed 'EnableHttps should preserve changed true after a successful Serve command.'
    Assert-True $notReady.reason.Contains('Tailscale Serve is not exposing') 'EnableHttps should include the final private HTTPS reason.'
    Assert-Equal $notReady.report.checks.privateHttps.status 'needs_action' 'EnableHttps should preserve the final doctor report.'
} finally {
    Remove-TempDeviceRepo -Root $repo.root
}

$guideCalled = $false
$guideBlocked = Invoke-MobileEditionDeviceAction `
    -RepositoryRoot $repoRoot `
    -Action OpenGuide `
    -DoctorRunner { param($RepositoryRoot) New-TestReport -PrivateHttps 'needs_action' } `
    -GuideRunner { $script:guideCalled = $true; throw 'Guide should not run without a doctor-validated private HTTPS URL.' }
Assert-Equal $guideBlocked.status 'needs_action' 'OpenGuide should require private HTTPS readiness.'
Assert-True (-not $guideCalled) 'OpenGuide should not call the guide helper without a validated URL.'

$guideCalls = [System.Collections.ArrayList]::new()
$guideReady = Invoke-MobileEditionDeviceAction `
    -RepositoryRoot $repoRoot `
    -Action OpenGuide `
    -DoctorRunner { param($RepositoryRoot) New-TestReport -PrivateHttps 'ready' -HttpsUrl 'https://desktop.example.ts.net' } `
    -GuideRunner {
        param($RepositoryRoot, $Url, $CommandRunner, $ConfirmHandler, $BrowserLauncher, $GuidePath, $DockerCommand)
        [void]$guideCalls.Add([pscustomobject]@{
            repositoryRoot = $RepositoryRoot
            url = $Url
            confirmed = (& $ConfirmHandler -Prompt 'Confirm from UI')
        })
        [pscustomobject]@{
            status = 'ready'
            reason = 'Device guide created and opened.'
            path = 'C:\Temp\feedback-mobile-edition-device-guide.html'
        }
    }
Assert-Equal $guideReady.status 'ready' 'OpenGuide should preserve a ready guide result.'
Assert-True $guideReady.changed 'OpenGuide should report changed when the guide is created and opened.'
Assert-Equal $guideReady.url 'https://desktop.example.ts.net' 'OpenGuide should pass through only the doctor-validated URL.'
Assert-Equal $guideReady.path 'C:\Temp\feedback-mobile-edition-device-guide.html' 'OpenGuide should return the helper guide path.'
Assert-Equal $guideCalls.Count 1 'OpenGuide should call the guide helper once.'
Assert-True $guideCalls[0].confirmed 'OpenGuide should pass fixed affirmative confirmation from the UI click.'

$guideFailure = Invoke-MobileEditionDeviceAction `
    -RepositoryRoot $repoRoot `
    -Action OpenGuide `
    -DoctorRunner { param($RepositoryRoot) New-TestReport -PrivateHttps 'ready' -HttpsUrl 'https://desktop.example.ts.net' } `
    -GuideRunner {
        param($RepositoryRoot, $Url, $CommandRunner, $ConfirmHandler, $BrowserLauncher, $GuidePath, $DockerCommand)
        [pscustomobject]@{
            status = 'failed'
            reason = 'QR generation failed: container unavailable'
            path = $null
        }
    }
Assert-Equal $guideFailure.status 'failed' 'OpenGuide should preserve guide helper failures.'
Assert-True (-not $guideFailure.changed) 'OpenGuide failure should not report completion.'
Assert-True $guideFailure.reason.Contains('QR generation failed') 'OpenGuide failure should preserve the helper reason.'

$json = $guideReady | ConvertTo-Json -Depth 10
$parsed = $json | ConvertFrom-Json
Assert-Equal $parsed.action 'OpenGuide' 'JSON output should include the device action.'
Assert-Equal $parsed.status 'ready' 'JSON output should include the device action status.'
Assert-Equal $parsed.url 'https://desktop.example.ts.net' 'JSON output should include the doctor-validated private URL.'
Assert-True ($parsed.report.schema -eq 'feedback.mobile-edition.setup-doctor.v1') 'JSON output should include the doctor report.'

Write-Output 'Invoke-MobileEditionDeviceAction tests passed.'
