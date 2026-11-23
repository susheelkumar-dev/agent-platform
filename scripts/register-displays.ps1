<#
.SYNOPSIS
  After adding or changing a display in the React app: type-check it and register the menus, in one step.

.DESCRIPTION
  1. type-checks the app, so a mistake is reported here with its file and line;
  2. registers every registration\*.manifest.json with the display registry (menus, displays, permissions).
  The running dev server shows code changes by itself. Sign out and in again in the app to see new menu entries.

.EXAMPLE
  cd D:\AI-Imp\ai-agent-platform
  powershell -ExecutionPolicy Bypass -File scripts\register-displays.ps1
#>
param(
    [string]$Workspace,
    [string]$App,
    [string]$AdminUser = 'admin',
    [string]$AdminPassword,
    [switch]$NoTypeCheck,
    [switch]$NoRegister
)
. (Join-Path $PSScriptRoot 'local-common.ps1')
Assert-NotAdmin 'register-displays.ps1'

$ws = Resolve-Workspace $Workspace
if (-not $App) { $App = Join-Path $ws 'gridtrade-react' }
if (-not (Test-Path (Join-Path $App 'package.json'))) { throw "No React app at $App. Run scripts\migrate-gridtrade.ps1 first." }
Merge-LegacyAppFiles $ws (Join-Path $ws 'gridtrade-contracts-extjs') $App

# ---- 1. type check -------------------------------------------------------------------------------------
if (-not $NoTypeCheck) {
    Write-Step 'Type check (tsc)'
    $npx = if ($OnWindows) { 'npx.cmd' } else { 'npx' }
    Push-Location $App
    try { & $npx tsc --noEmit -p . ; $code = $LASTEXITCODE } finally { Pop-Location }
    if ($code -ne 0) { throw 'Type errors above (file:line). Fix them and run this again.' }
    Write-Ok 'no type errors'
}

# ---- 2. register ---------------------------------------------------------------------------------------
if (-not $NoRegister) {
    Write-Step 'Registering menus and displays'
    if (-not (Wait-Http 'http://127.0.0.1:8130/health' 2)) {
        Write-Note 'The display registry is not running: start everything with scripts\start-local.ps1 (it registers on start).'
    } else {
        $manifests = @(Get-ChildItem -Path (Join-Path $App 'registration') -Filter '*.manifest.json' | ForEach-Object { $_.FullName })
        if (-not $AdminPassword) { $AdminPassword = $env:GT_ADMIN_PASSWORD }
        if (-not $AdminPassword) { $AdminPassword = 'GridTrade#2026' }
        $env:GT_ADMIN_PASSWORD = $AdminPassword
        $agentctl = Get-VenvTool 'agentctl'
        & $agentctl display register @manifests --registry http://127.0.0.1:8130 --app-api http://127.0.0.1:5080/api --user $AdminUser --password-env GT_ADMIN_PASSWORD
        if ($LASTEXITCODE -eq 1) { Write-Warning 'Some manifests were rejected (errors above); the others are registered.' }
        elseif ($LASTEXITCODE -ne 0) { throw 'Registration failed (sign-in or connection).' }
    }
}

Write-Host ''
Write-Ok 'Done. In the app: sign out and in again to load new menu entries.'
