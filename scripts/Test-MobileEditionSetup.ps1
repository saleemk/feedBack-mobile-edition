param(
    [switch]$Json
)

# JSON schema: feedback.mobile-edition.setup-doctor.v1
# Top-level fields:
# - schema: stable schema identifier
# - generatedAt: UTC ISO-8601 timestamp
# - overall: status and short reason
# - checks.repository: .env, LIBRARY_PATH, FEEDBACK_PORT, and compose file inputs
# - checks.docker: Docker CLI, Compose, daemon, compose config, and container state
# - checks.server: same-machine localhost /api/version health
# - checks.tailscale: Tailscale CLI and local node state
# - checks.privateHttps: validated Tailscale Serve HTTPS endpoint for this port
# Checks may include optional remediation values for safe UI prerequisite actions.

Set-StrictMode -Version 2.0

function New-MobileEditionCheck {
    param(
        [ValidateSet('ready', 'needs_action', 'unavailable')]
        [string]$Status,
        [string]$Reason,
        [string]$NextAction,
        [ValidateSet('get_docker', 'open_docker', 'start_server', 'get_tailscale', 'tailscale_help')]
        [string]$Remediation,
        [hashtable]$Details
    )

    $check = [ordered]@{
        status = $Status
        reason = $Reason
    }
    if ($NextAction) {
        $check.nextAction = $NextAction
    }
    if ($Remediation) {
        $check.remediation = $Remediation
    }
    if ($Details) {
        foreach ($key in ($Details.Keys | Sort-Object)) {
            $check[$key] = $Details[$key]
        }
    }
    [pscustomobject]$check
}

function ConvertTo-MobileEditionDisplayStatus {
    param([string]$Status)

    switch ($Status) {
        'ready' { 'Ready' }
        'needs_action' { 'Needs action' }
        'unavailable' { 'Unavailable' }
        default { $Status }
    }
}

function Invoke-MobileEditionCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    $oldLocation = Get-Location
    try {
        if ($WorkingDirectory) {
            Set-Location -LiteralPath $WorkingDirectory
        }
        $output = @(& $FilePath @Arguments 2>&1 | ForEach-Object { $_.ToString() })
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) {
            $exitCode = 0
        }
        [pscustomobject]@{
            exitCode = [int]$exitCode
            output = ($output -join "`n")
        }
    } catch {
        [pscustomobject]@{
            exitCode = 1
            output = $_.Exception.Message
        }
    } finally {
        Set-Location -LiteralPath $oldLocation
    }
}

function Invoke-MobileEditionCommandWithRunner {
    param(
        [scriptblock]$CommandRunner,
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    if ($CommandRunner) {
        return & $CommandRunner -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $WorkingDirectory
    }

    Invoke-MobileEditionCommand -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $WorkingDirectory
}

function Parse-MobileEditionEnvContent {
    param([string[]]$Content)

    $values = @{}
    $errors = @()
    $lineNumber = 0

    foreach ($line in $Content) {
        $lineNumber += 1
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) {
            continue
        }
        $equalsIndex = $line.IndexOf('=')
        if ($equalsIndex -lt 1) {
            $errors += "Line $lineNumber is not KEY=VALUE."
            continue
        }

        $key = $line.Substring(0, $equalsIndex).Trim()
        $value = $line.Substring($equalsIndex + 1).Trim()
        if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
            $errors += "Line $lineNumber has an invalid key."
            continue
        }
        if (($value.Length -ge 2) -and
            (($value.StartsWith('"') -and $value.EndsWith('"')) -or
             ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$key] = $value
    }

    [pscustomobject]@{
        values = $values
        errors = $errors
    }
}

function Read-MobileEditionEnvFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{
            exists = $false
            values = @{}
            errors = @('Missing .env file.')
        }
    }

    try {
        $content = Get-Content -LiteralPath $Path -ErrorAction Stop
        $parsed = Parse-MobileEditionEnvContent -Content $content
        [pscustomobject]@{
            exists = $true
            values = $parsed.values
            errors = $parsed.errors
        }
    } catch {
        [pscustomobject]@{
            exists = $true
            values = @{}
            errors = @('Could not read .env.')
        }
    }
}

function Resolve-MobileEditionPath {
    param(
        [string]$RepositoryRoot,
        [string]$Path
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    [System.IO.Path]::GetFullPath((Join-Path -Path $RepositoryRoot -ChildPath $Path))
}

function Resolve-MobileEditionSettings {
    param(
        [string]$RepositoryRoot,
        [hashtable]$EnvValues
    )

    $libraryPath = './library'
    if ($EnvValues.ContainsKey('LIBRARY_PATH') -and $EnvValues['LIBRARY_PATH']) {
        $libraryPath = $EnvValues['LIBRARY_PATH']
    }

    $portValue = '8000'
    if ($EnvValues.ContainsKey('FEEDBACK_PORT') -and $EnvValues['FEEDBACK_PORT']) {
        $portValue = $EnvValues['FEEDBACK_PORT']
    }

    $resolvedLibraryPath = $null
    $pathError = $null
    try {
        $resolvedLibraryPath = Resolve-MobileEditionPath -RepositoryRoot $RepositoryRoot -Path $libraryPath
    } catch {
        $pathError = 'LIBRARY_PATH could not be resolved.'
    }

    $port = 0
    $portValid = [int]::TryParse($portValue, [ref]$port) -and $port -ge 1 -and $port -le 65535

    [pscustomobject]@{
        libraryPath = $libraryPath
        resolvedLibraryPath = $resolvedLibraryPath
        libraryPathError = $pathError
        feedbackPortValue = $portValue
        feedbackPort = $port
        feedbackPortValid = $portValid
    }
}

function Get-MobileEditionRepositoryCheck {
    param(
        [string]$RepositoryRoot,
        [object]$EnvResult,
        [object]$Settings
    )

    $composeFile = Join-Path -Path $RepositoryRoot -ChildPath 'docker-compose.release.yml'
    if (-not (Test-Path -LiteralPath $composeFile -PathType Leaf)) {
        return New-MobileEditionCheck -Status 'needs_action' -Reason 'docker-compose.release.yml is missing.' -NextAction 'Restore docker-compose.release.yml from the Mobile Edition checkout.'
    }

    if (-not $EnvResult.exists) {
        return New-MobileEditionCheck -Status 'needs_action' -Reason '.env is missing.' -NextAction 'Run: Copy-Item .env.example .env, then edit LIBRARY_PATH.'
    }

    if ($EnvResult.errors.Count -gt 0) {
        return New-MobileEditionCheck -Status 'needs_action' -Reason '.env could not be parsed safely.' -NextAction 'Edit .env so each non-comment line uses KEY=VALUE.'
    }

    if (-not $Settings.feedbackPortValid) {
        return New-MobileEditionCheck -Status 'needs_action' -Reason 'FEEDBACK_PORT is not a valid TCP port.' -NextAction 'Edit .env and set FEEDBACK_PORT to a number from 1 to 65535.'
    }

    if ($Settings.libraryPathError) {
        return New-MobileEditionCheck -Status 'needs_action' -Reason $Settings.libraryPathError -NextAction 'Edit .env and set LIBRARY_PATH to an existing song library folder.'
    }

    if (-not (Test-Path -LiteralPath $Settings.resolvedLibraryPath -PathType Container)) {
        return New-MobileEditionCheck -Status 'needs_action' -Reason 'The configured LIBRARY_PATH folder does not exist.' -NextAction 'Edit .env and set LIBRARY_PATH to an existing song library folder.'
    }

    New-MobileEditionCheck -Status 'ready' -Reason 'Repository files, .env, library path, and port are ready.' -Details @{
        effectivePort = $Settings.feedbackPort
        libraryPathExists = $true
    }
}

function ConvertFrom-MobileEditionJson {
    param([string]$Text)

    try {
        if (-not $Text) {
            return $null
        }
        ConvertFrom-Json -InputObject $Text -ErrorAction Stop
    } catch {
        $null
    }
}

function Get-MobileEditionContainerState {
    param([string]$Text)

    $trimmed = ''
    if ($Text) {
        $trimmed = $Text.Trim()
    }
    if (-not $trimmed) {
        return 'missing'
    }

    try {
        if ($trimmed.StartsWith('[')) {
            $converted = ConvertFrom-Json -InputObject $trimmed -ErrorAction Stop
            if ($converted -is [System.Array]) {
                $items = $converted
            } else {
                $items = @($converted)
            }
        } else {
            $items = @()
            foreach ($line in ($trimmed -split "`r?`n")) {
                if ($line.Trim()) {
                    $items += ConvertFrom-Json -InputObject $line -ErrorAction Stop
                }
            }
        }
    } catch {
        return 'unknown'
    }

    foreach ($item in $items) {
        $service = ''
        $serviceProperty = @($item.PSObject.Properties | Where-Object { $_.Name -eq 'Service' } | Select-Object -First 1)
        $nameProperty = @($item.PSObject.Properties | Where-Object { $_.Name -eq 'Name' } | Select-Object -First 1)
        if ($serviceProperty.Count -gt 0) {
            $service = [string]$serviceProperty[0].Value
        } elseif ($nameProperty.Count -gt 0) {
            $service = [string]$nameProperty[0].Value
        }

        if ($service -eq 'web' -or $service -match 'web') {
            $state = ''
            $stateProperty = @($item.PSObject.Properties | Where-Object { $_.Name -eq 'State' } | Select-Object -First 1)
            $statusProperty = @($item.PSObject.Properties | Where-Object { $_.Name -eq 'Status' } | Select-Object -First 1)
            if ($stateProperty.Count -gt 0) {
                $state = ([string]$stateProperty[0].Value).ToLowerInvariant()
            } elseif ($statusProperty.Count -gt 0) {
                $state = ([string]$statusProperty[0].Value).ToLowerInvariant()
            }
            if ($state -match 'running') {
                return 'running'
            }
            if ($state) {
                return $state
            }
            return 'unknown'
        }
    }

    'missing'
}

function Get-MobileEditionDockerCheck {
    param(
        [string]$RepositoryRoot,
        [string]$ComposeFile,
        [object]$DockerCommand,
        [scriptblock]$CommandRunner,
        [switch]$SkipDockerDiscovery
    )

    $docker = $DockerCommand
    if (-not $docker -and -not $SkipDockerDiscovery) {
        $docker = Get-Command docker -ErrorAction SilentlyContinue
    }
    if (-not $docker) {
        return New-MobileEditionCheck -Status 'unavailable' -Reason 'Docker CLI is not available.' -NextAction 'Install Docker Desktop, then reopen PowerShell.' -Remediation 'get_docker'
    }

    $compose = Invoke-MobileEditionCommandWithRunner -CommandRunner $CommandRunner -FilePath $docker.Source -Arguments @('compose', 'version') -WorkingDirectory $RepositoryRoot
    if ($compose.exitCode -ne 0) {
        return New-MobileEditionCheck -Status 'unavailable' -Reason 'Docker Compose is not available through the Docker CLI.' -NextAction 'Install or update Docker Desktop with Docker Compose.' -Remediation 'get_docker'
    }

    $daemon = Invoke-MobileEditionCommandWithRunner -CommandRunner $CommandRunner -FilePath $docker.Source -Arguments @('info') -WorkingDirectory $RepositoryRoot
    if ($daemon.exitCode -ne 0) {
        return New-MobileEditionCheck -Status 'needs_action' -Reason 'Docker is installed, but the Docker daemon is not reachable.' -NextAction 'Start Docker Desktop, then rerun this doctor.' -Remediation 'open_docker'
    }

    $config = Invoke-MobileEditionCommandWithRunner -CommandRunner $CommandRunner -FilePath $docker.Source -Arguments @('compose', '-f', $ComposeFile, 'config', '--quiet') -WorkingDirectory $RepositoryRoot
    if ($config.exitCode -ne 0) {
        return New-MobileEditionCheck -Status 'needs_action' -Reason 'docker-compose.release.yml is not valid with the current environment.' -NextAction 'Run: docker compose -f docker-compose.release.yml config'
    }

    $ps = Invoke-MobileEditionCommandWithRunner -CommandRunner $CommandRunner -FilePath $docker.Source -Arguments @('compose', '-f', $ComposeFile, 'ps', '--format', 'json') -WorkingDirectory $RepositoryRoot
    if ($ps.exitCode -ne 0) {
        return New-MobileEditionCheck -Status 'needs_action' -Reason 'Docker is reachable, but the Edition container state could not be read.' -NextAction 'Run: docker compose -f docker-compose.release.yml ps'
    }

    $containerState = Get-MobileEditionContainerState -Text $ps.output
    if ($containerState -ne 'running') {
        return New-MobileEditionCheck -Status 'needs_action' -Reason 'The Mobile Edition container is not running.' -NextAction 'Run: docker compose -f docker-compose.release.yml up --build' -Remediation 'start_server' -Details @{
            containerState = $containerState
        }
    }

    New-MobileEditionCheck -Status 'ready' -Reason 'Docker, Compose, release configuration, and the Edition container are ready.' -Details @{
        containerState = $containerState
    }
}

function Get-MobileEditionServerCheck {
    param([int]$Port)

    if ($Port -lt 1 -or $Port -gt 65535) {
        return New-MobileEditionCheck -Status 'unavailable' -Reason 'Server health cannot be checked until FEEDBACK_PORT is valid.' -NextAction 'Edit .env and set FEEDBACK_PORT to a number from 1 to 65535.'
    }

    $url = "http://localhost:$Port/api/version"
    $response = $null
    try {
        $request = [System.Net.WebRequest]::Create($url)
        $request.Method = 'GET'
        $request.Timeout = 5000
        $response = $request.GetResponse()
        $statusCode = [int]$response.StatusCode
        if ($statusCode -ge 200 -and $statusCode -lt 300) {
            return New-MobileEditionCheck -Status 'ready' -Reason 'The local Mobile Edition server responded on localhost.' -Details @{
                localhostUrl = "http://localhost:$Port"
            }
        }
        New-MobileEditionCheck -Status 'needs_action' -Reason 'The local server responded with an unexpected status.' -NextAction 'Run: docker compose -f docker-compose.release.yml logs web'
    } catch {
        New-MobileEditionCheck -Status 'needs_action' -Reason 'The local Mobile Edition server is not reachable on localhost.' -NextAction 'Run: docker compose -f docker-compose.release.yml up --build'
    } finally {
        if ($response) {
            $response.Close()
        }
    }
}

function Get-MobileEditionTailscaleStatusFromJson {
    param([string]$Text)

    $json = ConvertFrom-MobileEditionJson -Text $Text
    if (-not $json) {
        return New-MobileEditionCheck -Status 'unavailable' -Reason 'Tailscale status returned malformed JSON.' -NextAction 'Use the Tailscale notification-area icon to sign in or reconnect, then rerun this doctor.' -Remediation 'tailscale_help'
    }

    $backendState = ''
    if ($json.PSObject.Properties['BackendState']) {
        $backendState = [string]$json.BackendState
    }
    $online = $false
    if ($json.PSObject.Properties['Self'] -and $json.Self -and $json.Self.PSObject.Properties['Online']) {
        $online = [bool]$json.Self.Online
    }

    if ($backendState -eq 'Running' -and $json.PSObject.Properties['Self'] -and $json.Self) {
        if ($online) {
            return New-MobileEditionCheck -Status 'ready' -Reason 'Tailscale is running and signed in.' -Details @{
                backendState = $backendState
                online = $true
            }
        }
        return New-MobileEditionCheck -Status 'needs_action' -Reason 'Tailscale is signed in, but this node is offline.' -NextAction 'Use the Tailscale notification-area icon to reconnect this device.' -Remediation 'tailscale_help' -Details @{
            backendState = $backendState
            online = $false
        }
    }

    if ($backendState -match 'NeedsLogin|NoState|Stopped') {
        return New-MobileEditionCheck -Status 'needs_action' -Reason 'Tailscale is installed, but it is not signed in and running.' -NextAction 'Use the Tailscale notification-area icon to sign in.' -Remediation 'tailscale_help' -Details @{
            backendState = $backendState
            online = $online
        }
    }

    New-MobileEditionCheck -Status 'needs_action' -Reason 'Tailscale is installed, but its local state is not ready.' -NextAction 'Use the Tailscale notification-area icon to sign in or reconnect, then rerun this doctor.' -Remediation 'tailscale_help' -Details @{
        backendState = $backendState
        online = $online
    }
}

function Get-MobileEditionTailscaleCheck {
    param(
        [string]$RepositoryRoot,
        [object]$TailscaleCommand,
        [scriptblock]$CommandRunner,
        [switch]$SkipTailscaleDiscovery
    )

    $tailscale = $TailscaleCommand
    if (-not $tailscale -and -not $SkipTailscaleDiscovery) {
        $tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
    }
    if (-not $tailscale) {
        return New-MobileEditionCheck -Status 'unavailable' -Reason 'Tailscale CLI is not available.' -NextAction 'Install Tailscale for Windows and sign in.' -Remediation 'get_tailscale'
    }

    $status = Invoke-MobileEditionCommandWithRunner -CommandRunner $CommandRunner -FilePath $tailscale.Source -Arguments @('status', '--json') -WorkingDirectory $RepositoryRoot
    if ($status.exitCode -ne 0) {
        return New-MobileEditionCheck -Status 'unavailable' -Reason 'Tailscale local status is not readable from this PowerShell session.' -NextAction 'Use the Tailscale notification-area icon to sign in or reconnect; if access is still denied, run from a PowerShell session with access to the Tailscale local API.' -Remediation 'tailscale_help'
    }

    Get-MobileEditionTailscaleStatusFromJson -Text $status.output
}

function Test-MobileEditionLocalProxy {
    param(
        [string]$Value,
        [int]$Port
    )

    if (-not $Value) {
        return $false
    }

    try {
        $uri = [System.Uri]$Value
        if ($uri.Scheme -ne 'http') {
            return $false
        }
        $uriHost = $uri.Host.ToLowerInvariant()
        if ($uriHost -notin @('localhost', '127.0.0.1', '::1')) {
            return $false
        }
        return $uri.Port -eq $Port
    } catch {
        return $false
    }
}

function Find-MobileEditionLocalProxyString {
    param(
        [object]$Value,
        [int]$Port
    )

    if ($null -eq $Value) {
        return $null
    }
    if ($Value -is [string]) {
        if (Test-MobileEditionLocalProxy -Value $Value -Port $Port) {
            return $Value
        }
        return $null
    }
    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        foreach ($item in $Value) {
            $match = Find-MobileEditionLocalProxyString -Value $item -Port $Port
            if ($match) {
                return $match
            }
        }
        return $null
    }
    if ($Value.PSObject) {
        foreach ($property in $Value.PSObject.Properties) {
            $match = Find-MobileEditionLocalProxyString -Value $property.Value -Port $Port
            if ($match) {
                return $match
            }
        }
    }
    $null
}

function ConvertTo-MobileEditionHttpsUrl {
    param([string]$Endpoint)

    if (-not $Endpoint) {
        return $null
    }
    if ($Endpoint -match '^https://') {
        return $Endpoint.TrimEnd('/')
    }
    if ($Endpoint -match '^http://') {
        return $null
    }

    $endpointHost = $Endpoint
    if ($endpointHost -match '^(?<name>[^:]+):443$') {
        $endpointHost = $Matches['name']
    }
    if ($endpointHost -match '^[A-Za-z0-9.-]+$') {
        return "https://$endpointHost"
    }
    $null
}

function Find-MobileEditionServeUrl {
    param(
        [object]$ServeJson,
        [int]$Port
    )

    $state = Get-MobileEditionServeRootState -ServeJson $ServeJson -Port $Port
    if ($state.status -eq 'matching') {
        return $state.url
    }
    $null
}

function Get-MobileEditionServeRootState {
    param(
        [object]$ServeJson,
        [int]$Port
    )

    if (-not $ServeJson -or -not $ServeJson.PSObject.Properties['Web']) {
        return [pscustomobject]@{
            status = 'absent'
            url = $null
        }
    }

    foreach ($endpointProperty in $ServeJson.Web.PSObject.Properties) {
        $endpointUrl = ConvertTo-MobileEditionHttpsUrl -Endpoint $endpointProperty.Name
        if (-not $endpointUrl) {
            continue
        }

        $endpoint = $endpointProperty.Value
        if (-not $endpoint -or -not $endpoint.PSObject.Properties['Handlers']) {
            continue
        }

        foreach ($handlerProperty in $endpoint.Handlers.PSObject.Properties) {
            if ($handlerProperty.Name -ne '/') {
                continue
            }
            $proxy = Find-MobileEditionLocalProxyString -Value $handlerProperty.Value -Port $Port
            if ($proxy) {
                return [pscustomobject]@{
                    status = 'matching'
                    url = $endpointUrl
                }
            }

            return [pscustomobject]@{
                status = 'conflict'
                url = $endpointUrl
            }
        }
    }

    [pscustomobject]@{
        status = 'absent'
        url = $null
    }
}

function Get-MobileEditionPrivateHttpsCheck {
    param(
        [string]$RepositoryRoot,
        [int]$Port,
        [object]$TailscaleCheck,
        [object]$TailscaleCommand,
        [scriptblock]$CommandRunner,
        [switch]$SkipTailscaleDiscovery
    )

    if ($Port -lt 1 -or $Port -gt 65535) {
        return New-MobileEditionCheck -Status 'needs_action' -Reason 'Private mobile HTTPS cannot be checked until FEEDBACK_PORT is valid.' -NextAction 'Edit .env and set FEEDBACK_PORT to a number from 1 to 65535.'
    }

    $tailscale = $TailscaleCommand
    if (-not $tailscale -and -not $SkipTailscaleDiscovery) {
        $tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
    }
    if (-not $tailscale) {
        return New-MobileEditionCheck -Status 'needs_action' -Reason 'Private mobile HTTPS cannot be checked because Tailscale is not installed.' -NextAction 'Install Tailscale for Windows and sign in.'
    }

    if ($TailscaleCheck.status -ne 'ready') {
        return New-MobileEditionCheck -Status 'needs_action' -Reason 'Private mobile HTTPS cannot be checked until Tailscale is running and signed in.' -NextAction 'Use the Tailscale notification-area icon to sign in or reconnect.'
    }

    $serve = Invoke-MobileEditionCommandWithRunner -CommandRunner $CommandRunner -FilePath $tailscale.Source -Arguments @('serve', 'status', '--json') -WorkingDirectory $RepositoryRoot
    if ($serve.exitCode -ne 0) {
        return New-MobileEditionCheck -Status 'needs_action' -Reason 'Tailscale Serve status is not readable from this PowerShell session.' -NextAction "Run: tailscale serve --bg $Port"
    }

    $serveJson = ConvertFrom-MobileEditionJson -Text $serve.output
    if (-not $serveJson) {
        return New-MobileEditionCheck -Status 'unavailable' -Reason 'Tailscale Serve returned malformed JSON.' -NextAction 'Run: tailscale serve status'
    }

    $url = Find-MobileEditionServeUrl -ServeJson $serveJson -Port $Port
    if ($url) {
        return New-MobileEditionCheck -Status 'ready' -Reason 'Tailscale Serve exposes this Edition port over HTTPS.' -Details @{
            url = $url
        }
    }

    New-MobileEditionCheck -Status 'needs_action' -Reason 'Tailscale Serve is not exposing this Edition port at the root HTTPS URL.' -NextAction "Run: tailscale serve --bg $Port"
}

function Get-MobileEditionOverall {
    param(
        [object]$RepositoryCheck,
        [object]$DockerCheck,
        [object]$ServerCheck,
        [object]$TailscaleCheck,
        [object]$PrivateHttpsCheck
    )

    if ($RepositoryCheck.status -ne 'ready') {
        return [pscustomobject]@{
            status = 'blocked'
            reason = 'Repository configuration needs action before Mobile Edition can run locally.'
        }
    }
    if ($DockerCheck.status -ne 'ready') {
        return [pscustomobject]@{
            status = 'blocked'
            reason = 'Docker or the Edition container needs action before Mobile Edition can run locally.'
        }
    }
    if ($ServerCheck.status -ne 'ready') {
        return [pscustomobject]@{
            status = 'blocked'
            reason = 'The local Mobile Edition server is not ready yet.'
        }
    }
    if ($TailscaleCheck.status -ne 'ready' -or $PrivateHttpsCheck.status -ne 'ready') {
        return [pscustomobject]@{
            status = 'local_ready_mobile_setup_remaining'
            reason = 'Local Mobile Edition is ready; private mobile HTTPS still needs action.'
        }
    }

    [pscustomobject]@{
        status = 'ready'
        reason = 'Local and private mobile HTTPS access are ready.'
    }
}

function New-MobileEditionReport {
    param(
        [object]$RepositoryCheck,
        [object]$DockerCheck,
        [object]$ServerCheck,
        [object]$TailscaleCheck,
        [object]$PrivateHttpsCheck
    )

    $overall = Get-MobileEditionOverall -RepositoryCheck $RepositoryCheck -DockerCheck $DockerCheck -ServerCheck $ServerCheck -TailscaleCheck $TailscaleCheck -PrivateHttpsCheck $PrivateHttpsCheck
    [pscustomobject]@{
        schema = 'feedback.mobile-edition.setup-doctor.v1'
        generatedAt = ([DateTime]::UtcNow.ToString('o'))
        overall = $overall
        checks = [pscustomobject]@{
            repository = $RepositoryCheck
            docker = $DockerCheck
            server = $ServerCheck
            tailscale = $TailscaleCheck
            privateHttps = $PrivateHttpsCheck
        }
    }
}

function Get-MobileEditionSetupReport {
    param([string]$RepositoryRoot)

    $envPath = Join-Path -Path $RepositoryRoot -ChildPath '.env'
    $composeFile = Join-Path -Path $RepositoryRoot -ChildPath 'docker-compose.release.yml'
    $envResult = Read-MobileEditionEnvFile -Path $envPath
    $settings = Resolve-MobileEditionSettings -RepositoryRoot $RepositoryRoot -EnvValues $envResult.values

    $repositoryCheck = Get-MobileEditionRepositoryCheck -RepositoryRoot $RepositoryRoot -EnvResult $envResult -Settings $settings
    $dockerCheck = Get-MobileEditionDockerCheck -RepositoryRoot $RepositoryRoot -ComposeFile $composeFile
    $serverCheck = Get-MobileEditionServerCheck -Port $settings.feedbackPort
    $tailscaleCheck = Get-MobileEditionTailscaleCheck -RepositoryRoot $RepositoryRoot
    $privateHttpsCheck = Get-MobileEditionPrivateHttpsCheck -RepositoryRoot $RepositoryRoot -Port $settings.feedbackPort -TailscaleCheck $tailscaleCheck

    New-MobileEditionReport -RepositoryCheck $repositoryCheck -DockerCheck $dockerCheck -ServerCheck $serverCheck -TailscaleCheck $tailscaleCheck -PrivateHttpsCheck $privateHttpsCheck
}

function Write-MobileEditionHumanReport {
    param([object]$Report)

    $overallLabel = switch ($Report.overall.status) {
        'ready' { 'Ready' }
        'local_ready_mobile_setup_remaining' { 'Needs action' }
        default { 'Needs action' }
    }

    Write-Output 'Mobile Edition Setup Doctor'
    Write-Output "Overall: $overallLabel - $($Report.overall.reason)"
    Write-Output ''

    $checks = @(
        @('Repository configuration', $Report.checks.repository),
        @('Docker and Compose', $Report.checks.docker),
        @('Edition server', $Report.checks.server),
        @('Tailscale', $Report.checks.tailscale),
        @('Private HTTPS access', $Report.checks.privateHttps)
    )

    foreach ($entry in $checks) {
        $name = $entry[0]
        $check = $entry[1]
        $label = ConvertTo-MobileEditionDisplayStatus -Status $check.status
        Write-Output "[$label] $name - $($check.reason)"
        if ($check.PSObject.Properties['url'] -and $check.url) {
            Write-Output "  URL: $($check.url)"
        }
        if ($check.PSObject.Properties['nextAction'] -and $check.nextAction) {
            Write-Output "  Next: $($check.nextAction)"
        }
    }
}

function Invoke-MobileEditionSetupDoctorMain {
    param([switch]$Json)

    $scriptRoot = Split-Path -Parent $MyInvocation.ScriptName
    if (-not $scriptRoot) {
        $scriptRoot = $PSScriptRoot
    }
    $repositoryRoot = Split-Path -Parent $scriptRoot
    $report = Get-MobileEditionSetupReport -RepositoryRoot $repositoryRoot

    if ($Json) {
        $report | ConvertTo-Json -Depth 8
    } else {
        Write-MobileEditionHumanReport -Report $report
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-MobileEditionSetupDoctorMain -Json:$Json
}
