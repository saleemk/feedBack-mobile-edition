$ErrorActionPreference = 'Stop'

. (Join-Path -Path (Split-Path -Parent $PSScriptRoot) -ChildPath 'scripts\Test-MobileEditionSetup.ps1')

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

function New-TestCheck {
    param([string]$Status)
    New-MobileEditionCheck -Status $Status -Reason "status $Status"
}

function New-TestCommand {
    param([string]$Source)
    [pscustomobject]@{
        Source = $Source
    }
}

$repoRoot = 'C:\MobileEdition'

$parsed = Parse-MobileEditionEnvContent -Content @(
    '# comment',
    'LIBRARY_PATH=.\library',
    'FEEDBACK_PORT=9001',
    'QUOTED="value=with=equals"'
)
Assert-Equal $parsed.errors.Count 0 'Valid .env content should not produce parse errors.'
Assert-Equal $parsed.values['LIBRARY_PATH'] '.\library' 'LIBRARY_PATH should parse.'
Assert-Equal $parsed.values['FEEDBACK_PORT'] '9001' 'FEEDBACK_PORT should parse.'
Assert-Equal $parsed.values['QUOTED'] 'value=with=equals' 'Quoted value should preserve embedded equals signs.'

$badParsed = Parse-MobileEditionEnvContent -Content @('LIBRARY_PATH')
Assert-Equal $badParsed.errors.Count 1 'Malformed .env content should produce one parse error.'

$defaults = Resolve-MobileEditionSettings -RepositoryRoot $repoRoot -EnvValues @{}
Assert-Equal $defaults.feedbackPort 8000 'Default FEEDBACK_PORT should be 8000.'
Assert-True $defaults.feedbackPortValid 'Default FEEDBACK_PORT should be valid.'
Assert-Equal $defaults.resolvedLibraryPath 'C:\MobileEdition\library' 'Relative default library path should resolve under the repository.'

$explicit = Resolve-MobileEditionSettings -RepositoryRoot $repoRoot -EnvValues @{
    LIBRARY_PATH = 'D:\Songs'
    FEEDBACK_PORT = '8123'
}
Assert-Equal $explicit.feedbackPort 8123 'Explicit FEEDBACK_PORT should parse.'
Assert-True $explicit.feedbackPortValid 'Explicit FEEDBACK_PORT should be valid.'
Assert-Equal $explicit.resolvedLibraryPath 'D:\Songs' 'Absolute LIBRARY_PATH should stay absolute.'

$invalidPort = Resolve-MobileEditionSettings -RepositoryRoot $repoRoot -EnvValues @{
    FEEDBACK_PORT = 'not-a-port'
}
Assert-True (-not $invalidPort.feedbackPortValid) 'Invalid FEEDBACK_PORT should be rejected.'

$invalidPortHttps = Get-MobileEditionPrivateHttpsCheck `
    -RepositoryRoot $repoRoot `
    -Port 0 `
    -TailscaleCheck (New-TestCheck -Status 'ready') `
    -TailscaleCommand (New-TestCommand -Source 'tailscale') `
    -CommandRunner { throw 'Command runner should not be called for invalid ports.' } `
    -SkipTailscaleDiscovery
Assert-Equal $invalidPortHttps.status 'needs_action' 'Invalid port should block private HTTPS checks.'
Assert-True (-not $invalidPortHttps.nextAction.Contains('tailscale serve --bg 0')) 'Invalid port should not suggest tailscale serve --bg 0.'
Assert-True $invalidPortHttps.nextAction.Contains('FEEDBACK_PORT') 'Invalid port action should direct the user to fix FEEDBACK_PORT.'

$serveJson = ConvertFrom-Json @'
{
  "Web": {
    "desktop.tailnet.ts.net:443": {
      "Handlers": {
        "/": {
          "Proxy": "http://127.0.0.1:8123"
        }
      }
    }
  }
}
'@
Assert-Equal (Find-MobileEditionServeUrl -ServeJson $serveJson -Port 8123) 'https://desktop.tailnet.ts.net' 'Root Serve handler should match the configured local port.'

$unrelatedServeJson = ConvertFrom-Json @'
{
  "Web": {
    "desktop.tailnet.ts.net:443": {
      "Handlers": {
        "/": {
          "Proxy": "http://127.0.0.1:3000"
        }
      }
    },
    "other.tailnet.ts.net:443": {
      "Handlers": {
        "/docs": {
          "Proxy": "http://127.0.0.1:8123"
        }
      }
    }
  }
}
'@
Assert-Equal (Find-MobileEditionServeUrl -ServeJson $unrelatedServeJson -Port 8123) $null 'Unrelated Serve endpoints should not match.'

$singleEndpointJson = ConvertFrom-Json @'
{
  "Web": {
    "https://desktop.tailnet.ts.net": {
      "Handlers": {
        "/": {
          "ProxyURL": "http://localhost:8123"
        }
      }
    }
  }
}
'@
Assert-Equal (Find-MobileEditionServeUrl -ServeJson $singleEndpointJson -Port 8123) 'https://desktop.tailnet.ts.net' 'HTTPS endpoint keys should be preserved.'

$tailscaleReadyJson = @'
{
  "BackendState": "Running",
  "Self": {
    "Online": true,
    "HostName": "private-host",
    "DNSName": "private-host.example.ts.net"
  },
  "Peer": {
    "node": {
      "DNSName": "peer.example.ts.net",
      "TailscaleIPs": ["100.64.0.1"]
    }
  }
}
'@
$tailscaleCheck = Get-MobileEditionTailscaleStatusFromJson -Text $tailscaleReadyJson
Assert-Equal $tailscaleCheck.status 'ready' 'Running online Tailscale status should be ready.'
$tailscaleJson = $tailscaleCheck | ConvertTo-Json -Depth 8
Assert-True (-not $tailscaleJson.Contains('private-host')) 'Tailscale check should not expose local host names.'
Assert-True (-not $tailscaleJson.Contains('peer.example')) 'Tailscale check should not expose peer inventory.'
Assert-True (-not $tailscaleJson.Contains('100.64.0.1')) 'Tailscale check should not expose Tailscale IP inventories.'

$malformedTailscale = Get-MobileEditionTailscaleStatusFromJson -Text '{not json'
Assert-Equal $malformedTailscale.status 'unavailable' 'Malformed Tailscale JSON should be unavailable.'

$readyReport = New-MobileEditionReport `
    -RepositoryCheck (New-TestCheck -Status 'ready') `
    -DockerCheck (New-TestCheck -Status 'ready') `
    -ServerCheck (New-TestCheck -Status 'ready') `
    -TailscaleCheck (New-TestCheck -Status 'ready') `
    -PrivateHttpsCheck (New-TestCheck -Status 'ready')
Assert-Equal $readyReport.overall.status 'ready' 'All ready checks should produce a ready overall status.'

$localOnlyReport = New-MobileEditionReport `
    -RepositoryCheck (New-TestCheck -Status 'ready') `
    -DockerCheck (New-TestCheck -Status 'ready') `
    -ServerCheck (New-TestCheck -Status 'ready') `
    -TailscaleCheck (New-TestCheck -Status 'ready') `
    -PrivateHttpsCheck (New-TestCheck -Status 'needs_action')
Assert-Equal $localOnlyReport.overall.status 'local_ready_mobile_setup_remaining' 'Missing private HTTPS should produce local-only status.'

$blockedReport = New-MobileEditionReport `
    -RepositoryCheck (New-TestCheck -Status 'needs_action') `
    -DockerCheck (New-TestCheck -Status 'ready') `
    -ServerCheck (New-TestCheck -Status 'ready') `
    -TailscaleCheck (New-TestCheck -Status 'ready') `
    -PrivateHttpsCheck (New-TestCheck -Status 'ready')
Assert-Equal $blockedReport.overall.status 'blocked' 'Repository action should block local readiness.'

$containerArray = @'
[
  {"Service": "web", "State": "running"}
]
'@
Assert-Equal (Get-MobileEditionContainerState -Text $containerArray) 'running' 'Compose JSON arrays should parse container state.'

$containerLines = @'
{"Service": "web", "State": "exited"}
'@
Assert-Equal (Get-MobileEditionContainerState -Text $containerLines) 'exited' 'Compose JSON line output should parse container state.'

$missingDocker = Get-MobileEditionDockerCheck `
    -RepositoryRoot $repoRoot `
    -ComposeFile 'docker-compose.release.yml' `
    -SkipDockerDiscovery
Assert-Equal $missingDocker.status 'unavailable' 'Missing Docker command should be unavailable.'
Assert-Equal $missingDocker.remediation 'get_docker' 'Missing Docker command should offer Docker installation guidance.'

$missingCompose = Get-MobileEditionDockerCheck `
    -RepositoryRoot $repoRoot `
    -ComposeFile 'docker-compose.release.yml' `
    -DockerCommand (New-TestCommand -Source 'docker') `
    -CommandRunner {
        param($FilePath, $Arguments, $WorkingDirectory)
        [pscustomobject]@{ exitCode = 1; output = 'compose missing' }
    } `
    -SkipDockerDiscovery
Assert-Equal $missingCompose.status 'unavailable' 'Missing Compose through Docker CLI should be unavailable.'
Assert-Equal $missingCompose.remediation 'get_docker' 'Missing Compose should offer Docker installation guidance.'

$dockerDaemonFailure = Get-MobileEditionDockerCheck `
    -RepositoryRoot $repoRoot `
    -ComposeFile 'docker-compose.release.yml' `
    -DockerCommand (New-TestCommand -Source 'docker') `
    -CommandRunner {
        param($FilePath, $Arguments, $WorkingDirectory)
        $joined = $Arguments -join ' '
        if ($joined -eq 'compose version') {
            return [pscustomobject]@{ exitCode = 0; output = 'Docker Compose version test' }
        }
        if ($joined -eq 'info') {
            return [pscustomobject]@{ exitCode = 1; output = 'daemon unavailable' }
        }
        [pscustomobject]@{ exitCode = 0; output = '' }
    } `
    -SkipDockerDiscovery
Assert-Equal $dockerDaemonFailure.status 'needs_action' 'Docker daemon command failure should need action.'
Assert-True $dockerDaemonFailure.nextAction.Contains('Start Docker Desktop') 'Docker daemon failure should suggest starting Docker Desktop.'
Assert-Equal $dockerDaemonFailure.remediation 'open_docker' 'Docker daemon failure should offer opening Docker Desktop.'

$invalidComposeConfig = Get-MobileEditionDockerCheck `
    -RepositoryRoot $repoRoot `
    -ComposeFile 'docker-compose.release.yml' `
    -DockerCommand (New-TestCommand -Source 'docker') `
    -CommandRunner {
        param($FilePath, $Arguments, $WorkingDirectory)
        $joined = $Arguments -join ' '
        if ($joined -eq 'compose version') {
            return [pscustomobject]@{ exitCode = 0; output = 'Docker Compose version test' }
        }
        if ($joined -eq 'info') {
            return [pscustomobject]@{ exitCode = 0; output = 'daemon ready' }
        }
        if ($joined -match 'config --quiet') {
            return [pscustomobject]@{ exitCode = 1; output = 'invalid compose' }
        }
        [pscustomobject]@{ exitCode = 0; output = '' }
    } `
    -SkipDockerDiscovery
Assert-Equal $invalidComposeConfig.status 'needs_action' 'Invalid Compose config should need action.'
Assert-True (-not $invalidComposeConfig.PSObject.Properties['remediation']) 'Invalid Compose config should not offer prerequisite remediation.'

$unreadableContainerState = Get-MobileEditionDockerCheck `
    -RepositoryRoot $repoRoot `
    -ComposeFile 'docker-compose.release.yml' `
    -DockerCommand (New-TestCommand -Source 'docker') `
    -CommandRunner {
        param($FilePath, $Arguments, $WorkingDirectory)
        $joined = $Arguments -join ' '
        if ($joined -eq 'compose version') {
            return [pscustomobject]@{ exitCode = 0; output = 'Docker Compose version test' }
        }
        if ($joined -eq 'info') {
            return [pscustomobject]@{ exitCode = 0; output = 'daemon ready' }
        }
        if ($joined -match 'config --quiet') {
            return [pscustomobject]@{ exitCode = 0; output = '' }
        }
        if ($joined -match 'ps --format json') {
            return [pscustomobject]@{ exitCode = 1; output = 'ps failed' }
        }
        [pscustomobject]@{ exitCode = 0; output = '' }
    } `
    -SkipDockerDiscovery
Assert-Equal $unreadableContainerState.status 'needs_action' 'Unreadable container state should need action.'
Assert-True (-not $unreadableContainerState.PSObject.Properties['remediation']) 'Unreadable container state should not offer prerequisite remediation.'

$stoppedContainer = Get-MobileEditionDockerCheck `
    -RepositoryRoot $repoRoot `
    -ComposeFile 'docker-compose.release.yml' `
    -DockerCommand (New-TestCommand -Source 'docker') `
    -CommandRunner {
        param($FilePath, $Arguments, $WorkingDirectory)
        $joined = $Arguments -join ' '
        if ($joined -eq 'compose version') {
            return [pscustomobject]@{ exitCode = 0; output = 'Docker Compose version test' }
        }
        if ($joined -eq 'info') {
            return [pscustomobject]@{ exitCode = 0; output = 'daemon ready' }
        }
        if ($joined -match 'config --quiet') {
            return [pscustomobject]@{ exitCode = 0; output = '' }
        }
        if ($joined -match 'ps --format json') {
            return [pscustomobject]@{ exitCode = 0; output = '{"Service":"web","State":"exited"}' }
        }
        [pscustomobject]@{ exitCode = 0; output = '' }
    } `
    -SkipDockerDiscovery
Assert-Equal $stoppedContainer.status 'needs_action' 'Stopped Edition container should need action.'
Assert-Equal $stoppedContainer.remediation 'start_server' 'Stopped Edition container should preserve the Start server action.'

$missingTailscale = Get-MobileEditionTailscaleCheck `
    -RepositoryRoot $repoRoot `
    -SkipTailscaleDiscovery
Assert-Equal $missingTailscale.status 'unavailable' 'Missing Tailscale command should be unavailable.'
Assert-Equal $missingTailscale.remediation 'get_tailscale' 'Missing Tailscale command should offer Tailscale installation guidance.'

$tailscaleStatusFailure = Get-MobileEditionTailscaleCheck `
    -RepositoryRoot $repoRoot `
    -TailscaleCommand (New-TestCommand -Source 'tailscale') `
    -CommandRunner {
        param($FilePath, $Arguments, $WorkingDirectory)
        [pscustomobject]@{ exitCode = 1; output = 'access denied' }
    } `
    -SkipTailscaleDiscovery
Assert-Equal $tailscaleStatusFailure.status 'unavailable' 'Tailscale status command failure should be unavailable.'
Assert-True $tailscaleStatusFailure.reason.Contains('not readable') 'Tailscale status failure should explain local status is not readable.'
Assert-Equal $tailscaleStatusFailure.remediation 'tailscale_help' 'Unreadable Tailscale status should offer Tailscale sign-in steps.'

Assert-Equal $malformedTailscale.remediation 'tailscale_help' 'Malformed Tailscale status should offer Tailscale sign-in steps.'

$tailscaleOffline = Get-MobileEditionTailscaleStatusFromJson -Text @'
{
  "BackendState": "Running",
  "Self": {
    "Online": false
  }
}
'@
Assert-Equal $tailscaleOffline.status 'needs_action' 'Offline Tailscale node should need action.'
Assert-Equal $tailscaleOffline.remediation 'tailscale_help' 'Offline Tailscale node should offer Tailscale sign-in steps.'

$tailscaleNeedsLogin = Get-MobileEditionTailscaleStatusFromJson -Text @'
{
  "BackendState": "NeedsLogin",
  "Self": {
    "Online": false
  }
}
'@
Assert-Equal $tailscaleNeedsLogin.status 'needs_action' 'Signed-out Tailscale should need action.'
Assert-Equal $tailscaleNeedsLogin.remediation 'tailscale_help' 'Signed-out Tailscale should offer Tailscale sign-in steps.'

$tailscaleUnknownState = Get-MobileEditionTailscaleStatusFromJson -Text @'
{
  "BackendState": "Starting",
  "Self": {
    "Online": false
  }
}
'@
Assert-Equal $tailscaleUnknownState.status 'needs_action' 'Unknown Tailscale state should need action.'
Assert-Equal $tailscaleUnknownState.remediation 'tailscale_help' 'Unknown Tailscale state should offer Tailscale sign-in steps.'

$serveStatusFailure = Get-MobileEditionPrivateHttpsCheck `
    -RepositoryRoot $repoRoot `
    -Port 8123 `
    -TailscaleCheck (New-TestCheck -Status 'ready') `
    -TailscaleCommand (New-TestCommand -Source 'tailscale') `
    -CommandRunner {
        param($FilePath, $Arguments, $WorkingDirectory)
        [pscustomobject]@{ exitCode = 1; output = 'serve unavailable' }
    } `
    -SkipTailscaleDiscovery
Assert-Equal $serveStatusFailure.status 'needs_action' 'Tailscale Serve command failure should need action.'
Assert-Equal $serveStatusFailure.nextAction 'Run: tailscale serve --bg 8123' 'Serve status failure should suggest serving the valid configured port.'

Write-Output 'Test-MobileEditionSetup.Tests.ps1 passed.'
