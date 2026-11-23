# Shared helpers for setup-local.ps1, migrate-gridtrade.ps1, start-local.ps1 and stop-local.ps1.
# Works in Windows PowerShell 5.1 and PowerShell 7 (Windows, macOS, Linux).

$ErrorActionPreference = 'Stop'

$script:OnWindows = ($env:OS -eq 'Windows_NT')
$script:PlatformRoot = Split-Path -Parent $PSScriptRoot
$script:AgentDir = Join-Path $PlatformRoot 'agents\extjs-migration-agent'
if (-not $OnWindows) { $script:AgentDir = Join-Path (Join-Path $PlatformRoot 'agents') 'extjs-migration-agent' }

function Resolve-Workspace([string]$Workspace) {
    if ($Workspace) { return (Resolve-Path $Workspace).Path }
    return (Split-Path -Parent $PlatformRoot)   # the folder that holds ai-agent-platform
}

function Get-LegacyAppFiles([string]$ws, [string]$gridtrade) {
    # Older setups kept the app's own files (displays, menus, UI Forge screens) in a separate folder. Now the React app
    # folder itself holds them. Returns that old folder when there is one still to merge, else $null.
    foreach ($old in @((Join-Path $ws 'gridtrade-react-app'), (Join-Path $gridtrade 'react-app'))) {
        if (Test-Path (Join-Path $old 'src')) { return $old }
    }
    return $null
}

function Merge-LegacyAppFiles([string]$ws, [string]$gridtrade, [string]$app) {
    # One time: copy an older separate app-files folder into the React app (its files win; what they replace is
    # backed up), then retire it, so the React app folder is the only place you work in.
    $old = Get-LegacyAppFiles $ws $gridtrade
    if (-not $old -or -not (Test-Path (Join-Path $app 'package.json'))) { return }
    $marker = Join-Path $app '.app-files-merged'
    if (Test-Path $marker) { return }   # merged once already: never again (an older folder would hold stale files)
    Write-Step "Merging $old into $app (one time: you now work in $app only)"
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = Join-Path (Join-Path $app '.migration-backups') "merge-$stamp"
    $n = 0
    foreach ($f in Get-ChildItem -Path $old -Recurse -File) {
        $rel = $f.FullName.Substring($old.Length).TrimStart('\', '/')
        $dest = Join-Path $app $rel
        if (Test-Path $dest) {
            if ((Get-FileHash $dest).Hash -eq (Get-FileHash $f.FullName).Hash) { continue }
            $b = Join-Path $backup $rel
            New-Item -ItemType Directory -Force -Path (Split-Path $b) | Out-Null
            Copy-Item -LiteralPath $dest -Destination $b -Force
        }
        New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
        Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
        $n++
    }
    Add-Content -Path $marker -Value $old
    Write-Ok "$n file(s) merged$(if (Test-Path $backup) { "; files they replaced are in $backup" })"
    if ($old -like (Join-Path $ws 'gridtrade-react-app*')) {
        $retired = "$old.merged-$stamp"
        try { Rename-Item -Path $old -NewName (Split-Path $retired -Leaf); Write-Note "Renamed the old folder to $retired; delete it once you have checked the app." }
        catch { Write-Note "$old is no longer used; delete it once you have checked the app." }
    } else {
        Write-Note "$old is no longer used (the Ext JS folder stays as it was); you may delete that react-app folder."
    }
}

function Get-VenvPython {
    $win = Join-Path $PlatformRoot '.venv\Scripts\python.exe'
    $nix = Join-Path (Join-Path (Join-Path $PlatformRoot '.venv') 'bin') 'python'
    if (Test-Path $win) { return $win }
    if (Test-Path $nix) { return $nix }
    return $null
}

function Get-VenvTool([string]$name) {
    $win = Join-Path $PlatformRoot ".venv\Scripts\$name.exe"
    $nix = Join-Path (Join-Path (Join-Path $PlatformRoot '.venv') 'bin') $name
    if (Test-Path $win) { return $win }
    if (Test-Path $nix) { return $nix }
    throw "$name is not installed in .venv. Run scripts\setup-local.ps1 first."
}

function Get-NodeExe {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { throw 'Node.js is not on PATH. Install Node.js 20 LTS (18 or later works) from https://nodejs.org and open a new terminal.' }
    return $node.Source
}

function Get-NpmExe {
    # npm.cmd on Windows: Start-Process and & on npm.ps1 behave differently, so name the .cmd explicitly.
    if ($OnWindows) { return 'npm.cmd' }
    return 'npm'
}

$script:LocalPorts = @(5080, 8130, 5173, 4173, 8140)

function Test-IsAdmin {
    if (-not $OnWindows) { return $false }
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { return $false }
}

function Assert-NotAdmin([string]$what) {
    # Services started from an Administrator window can only be stopped from one, and test/temp folders they create
    # become unreadable for the normal account. Everything here runs fine as a normal user.
    if (Test-IsAdmin) {
        throw "$what must not run from an Administrator window: anything it starts or creates would then only be stoppable or readable as Administrator. Close this window and use a normal PowerShell window (Start > PowerShell, not 'Run as administrator')."
    }
}

function Get-PortOwners([int[]]$ports = $LocalPorts) {
    # @{ port; pid; name; path } for every local port in use, Windows only
    if (-not $OnWindows) { return @() }
    $rows = @()
    foreach ($c in @(Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess -Unique)) {
        $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        $path = $null; try { $path = $p.Path } catch { }
        $rows += [pscustomobject]@{ Port = $c.LocalPort; Pid = $c.OwningProcess; Name = $(if ($p) { $p.ProcessName } else { '?' }); Path = $path }
    }
    return $rows
}

function Write-Step([string]$text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Ok([string]$text) { Write-Host "    $text" -ForegroundColor Green }
function Write-Note([string]$text) { Write-Host "    $text" -ForegroundColor Yellow }

function Wait-Http([string]$url, [int]$seconds = 60) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -lt 500) { return $true }
        } catch {
            if ($_.Exception.Response) { return $true }   # any HTTP answer means the server is up
        }
        Start-Sleep -Milliseconds 700
    }
    return $false
}

function Get-StateDir([string]$workspace) {
    $dir = Join-Path $workspace '.local-run'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    return $dir
}

function Start-Service2([string]$name, [string]$exe, [string[]]$arguments, [string]$cwd, [string]$stateDir) {
    $out = Join-Path $stateDir "$name.log"
    $err = Join-Path $stateDir "$name.err.log"
    # Start-Process joins arguments with spaces and does not quote them, so quote any that contain a space.
    $quoted = @($arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } })
    $p = @{ FilePath = $exe; ArgumentList = $quoted; WorkingDirectory = $cwd; RedirectStandardOutput = $out; RedirectStandardError = $err; PassThru = $true }
    if ($OnWindows) { $p['WindowStyle'] = 'Hidden' }
    $proc = Start-Process @p
    Set-Content -Path (Join-Path $stateDir "$name.pid") -Value $proc.Id
    return $proc
}

function Get-GridTradeSecret([string]$gridtrade) {
    if ($env:GT_JWT_SECRET) { return $env:GT_JWT_SECRET }
    $dataDir = Join-Path (Join-Path $gridtrade 'server') 'data'
    $file = Join-Path $dataDir 'jwt-secret'
    if (Test-Path $file) { return (Get-Content -Raw $file).Trim() }
    # Create it the way the API would, so the API and the display registry share one value.
    if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLower()
    Set-Content -Path $file -Value $secret -NoNewline
    return $secret
}
