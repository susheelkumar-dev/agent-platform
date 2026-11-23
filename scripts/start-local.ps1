<#
.SYNOPSIS
  Start GridTrade on React locally: GridTrade API, display registry, menu registration, and the React app.
  Optionally also the AI Agent Platform and the Ext JS migration agent.

.EXAMPLE
  scripts\start-local.ps1                     # React dev server on http://localhost:5173 (hot reload)
  scripts\start-local.ps1 -Mode single        # the API serves the built React app on http://localhost:5080
  scripts\start-local.ps1 -WithPlatform       # also the platform (http://127.0.0.1:8000) and the migration agent
  scripts\start-local.ps1 -Only platform      # just the platform and the migration agent
  scripts\start-local.ps1 -WithBuilder        # also UI Forge, the visual display builder (http://127.0.0.1:8140)
  scripts\start-local.ps1 -Only builder       # just UI Forge (start the API with the rest for live preview)
  scripts\stop-local.ps1                      # stop everything this script started

.NOTES
  Logs and process ids go to <workspace>\.local-run. Sign in to the React app as admin / GridTrade#2026
  (the seeded development password) unless you changed it.
#>
param(
    [string]$Workspace,
    [string]$GridTrade,
    [string]$App,
    [ValidateSet('dev', 'single')][string]$Mode = 'dev',
    [switch]$WithPlatform,
    [switch]$WithBuilder,
    [switch]$BuilderBackend,
    [ValidateSet('all', 'platform', 'builder')][string]$Only = 'all',
    [string]$AdminUser = 'admin',
    [string]$AdminPassword,
    [switch]$NoBrowser
)
. (Join-Path $PSScriptRoot 'local-common.ps1')
Assert-NotAdmin 'start-local.ps1'

$ws = Resolve-Workspace $Workspace
if (-not $GridTrade) { $GridTrade = Join-Path $ws 'gridtrade-contracts-extjs' }
if (-not $App) { $App = Join-Path $ws 'gridtrade-react' }
$state = Get-StateDir $ws
if (Test-Path (Join-Path $App 'package.json')) { Merge-LegacyAppFiles $ws $GridTrade $App }
$py = Get-VenvPython
if (-not $py) { throw 'No .venv yet. Run scripts\setup-local.ps1 first.' }
$node = Get-NodeExe

function Assert-PortFree([int]$port, [string]$what) {
    if (Wait-Http "http://127.0.0.1:$port/" 1) {
        $who = @(Get-PortOwners @($port)) | ForEach-Object { "$($_.Name) pid $($_.Pid)" }
        throw "Port $port is still in use ($what) by $($who -join ', '). It was probably started from an Administrator window or by another program: end it in Task Manager (Details tab), or restart Windows, then run this again."
    }
}

# Services left running (from this workspace, another copy of it, or a run that was interrupted) are stopped first,
# so a restart never fails on 'port already in use'.
if (@(Get-PortOwners).Count -or (Test-Path (Join-Path $state '*.pid'))) {
    Write-Step 'Stopping services that are still running'
    & (Join-Path $PSScriptRoot 'stop-local.ps1') -Workspace $ws
}

$started = @()
$urls = @()

if ($Only -eq 'all') {
    if (-not (Test-Path (Join-Path (Join-Path $GridTrade 'server') 'server.js'))) { throw "GridTrade not found at $GridTrade (pass -GridTrade <folder>)" }
    if (-not (Test-Path (Join-Path $App 'package.json'))) { throw "No React app at $App. Run scripts\migrate-gridtrade.ps1 first." }
    Assert-PortFree 5080 'GridTrade API'
    Assert-PortFree 8130 'display registry'

    # One signing secret for the API and the registry (the registry validates the API's tokens).
    $env:GT_JWT_SECRET = Get-GridTradeSecret $GridTrade
    $env:GT_REGISTRY_URL = 'http://127.0.0.1:8130'
    $env:GT_LATENCY = '0'
    if ($Mode -eq 'single') {
        $dist = Join-Path $App 'dist'
        if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw "No build at $dist. Run scripts\migrate-gridtrade.ps1 (it builds), or 'npm run build' in $App." }
        $env:GT_WEB_ROOT = $dist
    } else { Remove-Item Env:\GT_WEB_ROOT -ErrorAction SilentlyContinue }

    Write-Step 'GridTrade API on :5080'
    $started += Start-Service2 'gridtrade-api' $node @('server/server.js') $GridTrade $state
    Write-Step 'Display registry on :8130'
    $env:DISPLAY_REGISTRY_APPS_FILE = Join-Path (Join-Path $PlatformRoot 'deploy') 'display-registry.apps.json'
    $started += Start-Service2 'display-registry' $py @('-m', 'display_registry') $PlatformRoot $state

    if (-not (Wait-Http 'http://127.0.0.1:5080/api/health' 30)) { throw "The API did not start; see $(Join-Path $state 'gridtrade-api.err.log')" }
    if (-not (Wait-Http 'http://127.0.0.1:8130/health' 60)) { throw "The registry did not start; see $(Join-Path $state 'display-registry.err.log')" }
    Write-Ok 'API and registry are up'

    Write-Step 'Registering menus and displays (idempotent)'
    $manifests = @(Get-ChildItem -Path (Join-Path $App 'registration') -Filter '*.manifest.json' | ForEach-Object { $_.FullName })
    if ($manifests.Count -eq 0) { Write-Note 'No registration\*.manifest.json in the app; the menu will be empty.' }
    else {
        if (-not $AdminPassword) { $AdminPassword = $env:GT_ADMIN_PASSWORD }
        if (-not $AdminPassword) { $AdminPassword = 'GridTrade#2026' }
        $env:GT_ADMIN_PASSWORD = $AdminPassword
        $agentctl = Get-VenvTool 'agentctl'
        & $agentctl display register @manifests --registry http://127.0.0.1:8130 --app-api http://127.0.0.1:5080/api --user $AdminUser --password-env GT_ADMIN_PASSWORD
        if ($LASTEXITCODE -eq 1) {
            # some manifests were rejected (listed above); the others are registered, so keep going
            Write-Warning 'Some menus/displays were not registered (errors above). Their menu entries stay as they were; fix the manifest and restart, or use UI Forge > Generate > Register.'
        } elseif ($LASTEXITCODE -ne 0) {
            throw "Registration failed (sign-in or connection). Check the admin password (-AdminPassword) and $(Join-Path $state 'display-registry.err.log')."
        }
    }

    if ($Mode -eq 'dev') {
        Assert-PortFree 5173 'Vite dev server'
        $vite = Join-Path (Join-Path (Join-Path (Join-Path $App 'node_modules') 'vite') 'bin') 'vite.js'
        if (-not (Test-Path $vite)) {
            Write-Step 'npm install in the React app'
            Push-Location $App
            try { & (Get-NpmExe) install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm install failed' } } finally { Pop-Location }
        }
        $env:API_TARGET = 'http://127.0.0.1:5080'
        $env:REGISTRY_TARGET = 'http://127.0.0.1:8130'
        Write-Step 'React dev server on :5173'
        $started += Start-Service2 'react-dev' $node @($vite, '--port', '5173', '--strictPort') $App $state
        if (-not (Wait-Http 'http://127.0.0.1:5173/' 60) -and -not (Wait-Http 'http://localhost:5173/' 5)) { throw "Vite did not start; see $(Join-Path $state 'react-dev.err.log')" }
        $urls += 'React app (dev, hot reload): http://localhost:5173/'
    } else {
        $urls += 'React app (served by the API): http://localhost:5080/'
    }
}

if ($WithPlatform -or $Only -eq 'platform') {
    Assert-PortFree 8000 'AI Agent Platform'
    Assert-PortFree 8120 'migration agent'
    Write-Step 'AI Agent Platform on :8000'
    $started += Start-Service2 'platform' $py @('-m', 'uvicorn', 'platform_api.main:app', '--host', '127.0.0.1', '--port', '8000') $PlatformRoot $state
    if (-not (Wait-Http 'http://127.0.0.1:8000/ready' 60)) { throw "The platform did not start; see $(Join-Path $state 'platform.err.log')" }
    Write-Step 'Ext JS migration agent on :8120'
    $env:AGENT_SERVICE_URL = 'http://127.0.0.1:8120'
    $started += Start-Service2 'migration-agent' $py @('-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8120') $AgentDir $state
    if (-not (Wait-Http 'http://127.0.0.1:8120/health' 60)) { throw "The agent did not start; see $(Join-Path $state 'migration-agent.err.log')" }
    $urls += 'AI Agent Platform chat:  http://127.0.0.1:8000/  (pick demo-admin in the identity list)'
}

if ($WithBuilder -or $Only -eq 'builder') {
    Assert-PortFree 8140 'UI Forge'
    if (-not (Test-Path (Join-Path (Join-Path $App 'src') 'displays.ts'))) { throw "No framework-shell React app at $App. Run scripts\migrate-gridtrade.ps1 first." }
    # python -m ui_forge works even when the ui-forge command was not (re)installed into .venv yet
    # UI Forge writes into the React app itself (the one folder you work in), plus an API contract per entity for the
    # backend team. -BuilderBackend also lets it generate GridTrade's Node API routes.
    $forgeArgs = @('-m', 'ui_forge', '--app', $App)
    if ($BuilderBackend) { $forgeArgs += @('--api', $GridTrade); Write-Note "UI Forge may write API routes into $(Join-Path $GridTrade 'server')" }
    $env:PYTHONPATH = Join-Path $PlatformRoot 'src'   # ui_forge from this checkout, even in an older .venv
    $env:UI_FORGE_APP_API_URL = 'http://127.0.0.1:5080/api'
    $env:UI_FORGE_REGISTRY_URL = 'http://127.0.0.1:8130'
    Write-Step 'UI Forge builder on :8140'
    $started += Start-Service2 'ui-forge' $py ($forgeArgs + @('serve', '--port', '8140')) $PlatformRoot $state
    if (-not (Wait-Http 'http://127.0.0.1:8140/api/health' 60)) { throw "UI Forge did not start; see $(Join-Path $state 'ui-forge.err.log')" }
    $urls += 'UI Forge builder:        http://127.0.0.1:8140/'
}

Write-Host ''
Write-Host 'Running:' -ForegroundColor Green
foreach ($u in $urls) { Write-Host "  $u" }
if ($Only -eq 'all') { Write-Host "  Sign in as $AdminUser (or demo.trader, ops.analyst, risk.manager, auditor) with the development password." }
Write-Host "  Logs: $state"
Write-Host '  Stop: scripts\stop-local.ps1'
if ($OnWindows -and -not $NoBrowser -and $urls.Count -gt 0) {
    $m = [regex]::Match($urls[0], 'http\S+')
    if ($m.Success) { Start-Process $m.Value }
}
