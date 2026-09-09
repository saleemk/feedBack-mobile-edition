$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$composePath = Join-Path -Path $repoRoot -ChildPath 'docker-compose.release.yml'
$compose = Get-Content -LiteralPath $composePath -Raw

if ($compose -notmatch '(?m)^name:\s*feedback-mobile-edition\s*$') {
    throw 'Release Compose file must define stable project name feedback-mobile-edition.'
}

if ($compose -notmatch '(?m)^\s{2}web:\s*$') {
    throw 'Release Compose file must preserve the web service.'
}

if ($compose -notmatch '(?m)^\s{2}feedback-mobile-edition-config:\s*$') {
    throw 'Release Compose file must preserve the stable config volume.'
}
