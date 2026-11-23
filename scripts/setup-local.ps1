<#
.SYNOPSIS
  One-time local setup: Python venv with the platform and the Ext JS migration agent, config files, checks.

.EXAMPLE
  cd D:\AI-Imp\ai-agent-platform
  powershell -ExecutionPolicy Bypass -File scripts\setup-local.ps1

.PARAMETER Workspace
  Folder that holds ai-agent-platform and gridtrade-contracts-extjs side by side. Default: the parent of this repo.
.PARAMETER Recreate
  Delete and rebuild .venv even if it works.
.PARAMETER RuntimeTests
  Also npm-install and test the React runtime and framework (needs the internet once).
.PARAMETER Builder
  Rebuild the UI Forge builder (ui-forge-web -> src\ui_forge\static) and run its tests. The repository ships a
  built copy, so this is only needed after changing ui-forge-web.
#>
param(
    [string]$Workspace,
    [string]$GridTrade,
    [switch]$Recreate,
    [switch]$RuntimeTests,
    [switch]$Builder
)
. (Join-Path $PSScriptRoot 'local-common.ps1')
Assert-NotAdmin 'setup-local.ps1'

$ws = Resolve-Workspace $Workspace
if (-not $GridTrade) { $GridTrade = Join-Path $ws 'gridtrade-contracts-extjs' }
Write-Step "Workspace: $ws"

# ---- Python -------------------------------------------------------------------------------------------
Write-Step 'Python'
function Test-PyVersion([string[]]$cmd) {
    try {
        $exe = $cmd[0]; $rest = @(); if ($cmd.Length -gt 1) { $rest = $cmd[1..($cmd.Length - 1)] }
        $v = & $exe @rest -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $v) { return $null }
        $parts = $v.Trim().Split('.')
        if ([int]$parts[0] -eq 3 -and [int]$parts[1] -ge 11) { return $v.Trim() }
    } catch { }
    return $null
}
$candidates = @()
if ($OnWindows) { $candidates += , @('py', '-3.12'); $candidates += , @('py', '-3.13'); $candidates += , @('py', '-3.11') }
$candidates += , @('python3.12'); $candidates += , @('python3'); $candidates += , @('python'); if ($OnWindows) { $candidates += , @('py', '-3') }
$py = $null
foreach ($c in $candidates) {
    $ver = Test-PyVersion $c
    if ($ver) { $py = $c; Write-Ok "Using $($c -join ' ') (Python $ver)"; break }
}
if (-not $py) { throw 'Python 3.11 or later was not found. Install Python 3.12 from https://www.python.org/downloads/ (tick "Add to PATH") and run this again.' }

$venvPy = Get-VenvPython
$healthy = $false
if ($venvPy -and -not $Recreate) {
    try {
        & $venvPy -c "import platform_api, display_registry, extjs_migrator, ui_forge, pytest" 2>$null
        $healthy = ($LASTEXITCODE -eq 0)
    } catch { $healthy = $false }   # Windows PowerShell 5.1 turns redirected stderr into an exception
}
if (-not $healthy) {
    $venvDir = Join-Path $PlatformRoot '.venv'
    if (Test-Path $venvDir) { Write-Note 'Rebuilding .venv (missing, broken, moved, or -Recreate)'; Remove-Item -Recurse -Force $venvDir }
    $exe = $py[0]; $rest = @(); if ($py.Length -gt 1) { $rest = $py[1..($py.Length - 1)] }
    & $exe @rest -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { throw 'python -m venv failed' }
    $venvPy = Get-VenvPython
    & $venvPy -m pip install --upgrade pip --quiet
    Write-Step 'Installing the platform and the migration agent (a few minutes the first time)'
    Push-Location $PlatformRoot
    try {
        & $venvPy -m pip install --quiet -e ".[dev]"
        if ($LASTEXITCODE -ne 0) { throw 'pip install -e .[dev] failed' }
        & $venvPy -m pip install --quiet -e $AgentDir
        if ($LASTEXITCODE -ne 0) { throw 'pip install of the migration agent failed' }
    } finally { Pop-Location }
}
else {
    # An existing venv imports new packages from src (editable install) but only gets new commands such as
    # ui-forge when the package is installed again: refresh it when one is missing.
    $scripts = Split-Path $venvPy -Parent
    $missing = @('ui-forge', 'extjs-migrate', 'agentctl') | Where-Object { -not (Test-Path (Join-Path $scripts $_)) -and -not (Test-Path (Join-Path $scripts "$_.exe")) }
    if ($missing) {
        Write-Step "Refreshing the install (new commands: $($missing -join ', '))"
        Push-Location $PlatformRoot
        try {
            & $venvPy -m pip install --quiet -e ".[dev]"
            if ($LASTEXITCODE -ne 0) { throw 'pip install -e .[dev] failed' }
            & $venvPy -m pip install --quiet -e $AgentDir
            if ($LASTEXITCODE -ne 0) { throw 'pip install of the migration agent failed' }
        } finally { Pop-Location }
    }
}
Write-Ok ".venv ready: $venvPy"
$old = Join-Path $PlatformRoot '.venv-old'
if (Test-Path $old) { Write-Note '.venv-old is a leftover from another folder and Python 3.12; it is not used. Delete it to save ~160 MB.' }

# ---- Config files -------------------------------------------------------------------------------------
Write-Step 'Config'
$envFile = Join-Path $PlatformRoot '.env'
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $PlatformRoot '.env.example') $envFile; Write-Ok 'Created .env from .env.example' } else { Write-Ok '.env exists (kept)' }
$dataDir = Join-Path $PlatformRoot 'data'
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

$agentEnv = Join-Path $AgentDir '.env'
$migrations = Join-Path $ws 'migrations'
if (-not (Test-Path $agentEnv)) {
    $lines = @(
        '# Written by scripts\setup-local.ps1. Real environment variables win over these.',
        'PORT=8120',
        'AGENT_SERVICE_URL=http://127.0.0.1:8120',
        "EXTJS_MIGRATE_ROOTS=$ws",
        "EXTJS_MIGRATE_OUTPUT=$migrations",
        'EXTJS_MIGRATE_LLM=none',
        'OLLAMA_URL=http://localhost:11434',
        'EXTJS_MIGRATE_MODEL=qwen2.5-coder:3b'
    )
    Set-Content -Path $agentEnv -Value $lines -Encoding ASCII
    Write-Ok "Created the agent's .env (reads under $ws, writes to $migrations)"
} else { Write-Ok "Agent .env exists (kept): $agentEnv" }

# ---- Node ---------------------------------------------------------------------------------------------
Write-Step 'Node.js'
$node = Get-NodeExe
$nv = (& $node --version).Trim()
$major = [int]($nv.TrimStart('v').Split('.')[0])
if ($major -lt 18) { throw "Node $nv is too old; install Node.js 20 LTS." }
Write-Ok "Node $nv"

# ---- GridTrade ----------------------------------------------------------------------------------------
Write-Step 'GridTrade source'
if (Test-Path (Join-Path (Join-Path $GridTrade 'web') 'app.json')) {
    Write-Ok "Found $GridTrade"
    Merge-LegacyAppFiles $ws $GridTrade (Join-Path $ws 'gridtrade-react')
} else {
    Write-Note "GridTrade not found at $GridTrade. Put gridtrade-contracts-extjs next to ai-agent-platform, or pass -GridTrade <folder>."
}

# ---- Tests --------------------------------------------------------------------------------------------
Write-Step 'Python tests (platform + migration agent)'
$env:GRIDTRADE_WEB = Join-Path $GridTrade 'web'
# Test scratch files go in our own folder, not %TEMP%\pytest-of-<user>: that folder is unreadable when an earlier run
# was started from an Administrator window ("PermissionError: [WinError 5] Access is denied" in every test).
$testTmp = Join-Path $PlatformRoot '.pytest-tmp'
New-Item -ItemType Directory -Force -Path $testTmp | Out-Null
Push-Location $PlatformRoot
try { & $venvPy -m pytest -q -p no:cacheprovider --basetemp (Join-Path $testTmp 'platform'); $t1 = $LASTEXITCODE } finally { Pop-Location }
Push-Location $AgentDir
try { & $venvPy -m pytest -q -p no:cacheprovider --basetemp (Join-Path $testTmp 'agent'); $t2 = $LASTEXITCODE } finally { Pop-Location }
if ($t1 -ne 0 -or $t2 -ne 0) { throw 'Some tests failed; see the output above.' }
Write-Ok 'All Python tests passed'

if ($RuntimeTests) {
    $npm = Get-NpmExe
    foreach ($pkg in @('runtime', 'framework')) {
        Write-Step "React $pkg tests"
        Push-Location (Join-Path $AgentDir $pkg)
        try {
            & $npm ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw "npm ci failed in $pkg" }
            & $npm test
            if ($LASTEXITCODE -ne 0) { throw "$pkg tests failed" }
        } finally { Pop-Location }
    }
}

if ($Builder) {
    $npm = Get-NpmExe
    Write-Step 'UI Forge builder (ui-forge-web)'
    Push-Location (Join-Path $PlatformRoot 'ui-forge-web')
    try {
        & $npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed in ui-forge-web' }
        & $npm test
        if ($LASTEXITCODE -ne 0) { throw 'ui-forge-web tests failed' }
        & $npm run build
        if ($LASTEXITCODE -ne 0) { throw 'ui-forge-web build failed' }
    } finally { Pop-Location }
    Write-Ok 'Builder built into src\ui_forge\static'
}
if (-not (Test-Path (Join-Path (Join-Path (Join-Path (Join-Path $PlatformRoot 'src') 'ui_forge') 'static') 'index.html'))) {
    Write-Note 'The UI Forge builder is not built yet: run scripts\setup-local.ps1 -Builder (needs the internet once).'
}

Write-Host ''
Write-Host 'Setup complete. Next:' -ForegroundColor Green
Write-Host '  scripts\migrate-gridtrade.ps1      # Ext JS -> React (framework shell), with a build check'
Write-Host '  scripts\start-local.ps1            # GridTrade API + display registry + React app'
Write-Host '  scripts\start-local.ps1 -WithBuilder   # ... plus the UI Forge builder on http://127.0.0.1:8140'
