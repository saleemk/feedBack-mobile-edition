$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$composePath = Join-Path -Path $repoRoot -ChildPath 'docker-compose.release.yml'
$compose = Get-Content -LiteralPath $composePath -Raw
$dockerIgnorePath = Join-Path -Path $repoRoot -ChildPath '.dockerignore'
$dockerIgnoreLines = @(Get-Content -LiteralPath $dockerIgnorePath)

if ($compose -notmatch '(?m)^name:\s*feedback-mobile-edition\s*$') {
    throw 'Release Compose file must define stable project name feedback-mobile-edition.'
}

if ($compose -notmatch '(?m)^\s{2}web:\s*$') {
    throw 'Release Compose file must preserve the web service.'
}

if ($compose -notmatch '(?m)^\s{2}feedback-mobile-edition-config:\s*$') {
    throw 'Release Compose file must preserve the stable config volume.'
}

$pluginsRoot = Join-Path -Path $repoRoot -ChildPath 'plugins'
foreach ($pluginDirectory in Get-ChildItem -LiteralPath $pluginsRoot -Directory) {
    $manifestPath = Join-Path -Path $pluginDirectory.FullName -ChildPath 'plugin.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        continue
    }

    $directoryRule = "!plugins/$($pluginDirectory.Name)/"
    $contentRule = "!plugins/$($pluginDirectory.Name)/**"
    if ($dockerIgnoreLines -notcontains $directoryRule -or $dockerIgnoreLines -notcontains $contentRule) {
        throw "Bundled plugin '$($pluginDirectory.Name)' must be explicitly included in the Docker build context."
    }
}
