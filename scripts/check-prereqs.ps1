<#
.SYNOPSIS
  Pre-flight check before setup, migration or start: finds the problems that otherwise stop a run half-way
  (wrong window, missing tools, blocked files, busy ports, an unreadable temp folder) and says how to fix each.

.EXAMPLE
  cd D:\AI-Imp\ai-agent-platform
  powershell -ExecutionPolicy Bypass -File scripts\check-prereqs.ps1

.PARAMETER Workspace
  Folder that holds ai-agent-platform and gridtrade-contracts-extjs. Default: the parent of this repo.
.PARAMETER NoFix
  Only report. By default it also unblocks downloaded files and stops services this setup left running.
#>
param([string]$Workspace, [switch]$NoFix)
. (Join-Path $PSScriptRoot 'local-common.ps1')
$ErrorActionPreference = 'Continue'   # a check that fails is reported, not fatal

$ws = Resolve-Workspace $Workspace
$results = New-Object System.Collections.ArrayList
function Add-Result([string]$check, [string]$status, [string]$detail, [string]$fix = '') {
    [void]$results.Add([pscustomobject]@{ Check = $check; Status = $status; Detail = $detail; Fix = $fix })
}

Write-Step "Checking $ws"

# ---- window --------------------------------------------------------------------------------------------
if (Test-IsAdmin) {
    Add-Result 'Normal (not Administrator) window' 'FAIL' 'this window runs as Administrator' 'Close it; open PowerShell normally (Start > PowerShell, not "Run as administrator").'
} else { Add-Result 'Normal (not Administrator) window' 'OK' 'yes' }
Add-Result 'PowerShell' 'OK' "$($PSVersionTable.PSVersion)"

# ---- folders -------------------------------------------------------------------------------------------
$platform = Join-Path $ws 'ai-agent-platform'
$gridtrade = Join-Path $ws 'gridtrade-contracts-extjs'
if (Test-Path (Join-Path $platform 'pyproject.toml')) { Add-Result 'ai-agent-platform folder' 'OK' $platform }
else { Add-Result 'ai-agent-platform folder' 'FAIL' "not found in $ws" 'Put ai-agent-platform in the workspace folder (or pass -Workspace).' }
if (Test-Path (Join-Path (Join-Path $gridtrade 'web') 'app.json')) { Add-Result 'Ext JS source (web\app.json)' 'OK' $gridtrade }
else { Add-Result 'Ext JS source (web\app.json)' 'FAIL' "not found in $gridtrade" 'Put gridtrade-contracts-extjs next to ai-agent-platform.' }
if (Test-Path (Join-Path (Join-Path $gridtrade 'server') 'server.js')) { Add-Result 'GridTrade API (server\server.js)' 'OK' 'found' }
else { Add-Result 'GridTrade API (server\server.js)' 'FAIL' 'missing' 'The gridtrade-contracts-extjs folder is incomplete; copy it again.' }
$drive = (Get-Item $ws).PSDrive
if ($drive -and $drive.Free) {
    $gb = [math]::Round($drive.Free / 1GB, 1)
    if ($gb -lt 1) { Add-Result 'Free disk space' 'FAIL' "$gb GB" 'Free at least 1 GB on this drive.' } else { Add-Result 'Free disk space' 'OK' "$gb GB" }
}

# ---- tools ---------------------------------------------------------------------------------------------
$pyFound = $null
$candidates = @()
if ($OnWindows) { $candidates += , @('py', '-3.12'); $candidates += , @('py', '-3.13'); $candidates += , @('py', '-3.11') }
$candidates += , @('python3'); $candidates += , @('python')
foreach ($c in $candidates) {
    try {
        $exe = $c[0]; $rest = @(); if ($c.Length -gt 1) { $rest = $c[1..($c.Length - 1)] }
        $v = & $exe @rest -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
        if ($LASTEXITCODE -eq 0 -and $v) {
            $parts = "$v".Trim().Split('.')
            if ([int]$parts[0] -eq 3 -and [int]$parts[1] -ge 11) { $pyFound = "$($c -join ' ') -> Python $("$v".Trim())"; break }
        }
    } catch { }
}
if ($pyFound) { Add-Result 'Python 3.11+' 'OK' $pyFound }
else { Add-Result 'Python 3.11+' 'FAIL' 'not found' 'Install Python 3.12 from python.org, tick "Add python.exe to PATH", open a new window.' }

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $nv = (& $node.Source --version).Trim(); $major = [int]($nv.TrimStart('v').Split('.')[0])
    if ($major -ge 18) { Add-Result 'Node.js 18+' 'OK' $nv } else { Add-Result 'Node.js 18+' 'FAIL' $nv 'Install Node.js 20 LTS from nodejs.org.' }
} else { Add-Result 'Node.js 18+' 'FAIL' 'not found' 'Install Node.js 20 LTS from nodejs.org, open a new window.' }
if (Get-Command npm -ErrorAction SilentlyContinue) { Add-Result 'npm' 'OK' 'found' } else { Add-Result 'npm' 'FAIL' 'not found' 'Reinstall Node.js (npm comes with it).' }

# ---- shared React packages ----------------------------------------------------------------------------
$agent = Join-Path (Join-Path $platform 'agents') 'extjs-migration-agent'
foreach ($name in @('runtime', 'framework')) {
    $pj = Join-Path (Join-Path $agent $name) 'package.json'
    if (-not (Test-Path $pj)) { continue }
    $ver = (Get-Content $pj -Raw | ConvertFrom-Json).version
    $tgz = Join-Path (Join-Path $agent 'packages') "extreact-$name-$ver.tgz"
    if (Test-Path $tgz) { Add-Result "@extreact/$name package" 'OK' $ver }
    else { Add-Result "@extreact/$name package" 'FAIL' "extreact-$name-$ver.tgz missing" 'Apply the latest update zip (it carries the packages).' }
}

# ---- blocked files (downloaded zips) ------------------------------------------------------------------
if ($OnWindows) {
    $blocked = @(Get-ChildItem -Recurse -File -Path $platform, $gridtrade -ErrorAction SilentlyContinue |
                 Where-Object { $_.FullName -notmatch '\\(node_modules|\.venv)\\' } |
                 Where-Object { Get-Item -LiteralPath $_.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue })
    if ($blocked.Count -and -not $NoFix) {
        $blocked | ForEach-Object { try { Unblock-File -LiteralPath $_.FullName } catch { } }
        Add-Result 'Downloaded files unblocked' 'FIXED' "$($blocked.Count) file(s) unblocked"
    } elseif ($blocked.Count) {
        Add-Result 'Downloaded files unblocked' 'FAIL' "$($blocked.Count) blocked file(s)" 'Run without -NoFix, or: Get-ChildItem -Recurse <folder> | Unblock-File'
    } else { Add-Result 'Downloaded files unblocked' 'OK' 'none blocked' }
}

# ---- temp folder used by the tests --------------------------------------------------------------------
$pyTemp = Join-Path ([System.IO.Path]::GetTempPath()) "pytest-of-$env:USERNAME"
if (Test-Path $pyTemp) {
    try { Get-ChildItem -LiteralPath $pyTemp -ErrorAction Stop | Out-Null; Add-Result 'Temp folder readable' 'OK' 'yes' }
    catch { Add-Result 'Temp folder readable' 'WARN' "$pyTemp is locked (made by an Administrator run)" ("Harmless for setup (it uses its own folder). To remove it: in an Administrator window, Remove-Item -Recurse -Force '$pyTemp'") }
} else { Add-Result 'Temp folder readable' 'OK' 'yes' }

# ---- ports --------------------------------------------------------------------------------------------
$owners = @(Get-PortOwners)
if ($owners.Count -and -not $NoFix) {
    & (Join-Path $PSScriptRoot 'stop-local.ps1') -Workspace $ws | Out-Null
    $owners = @(Get-PortOwners)
}
if (-not $OnWindows) { Add-Result 'Ports 5080 8130 5173 8140 free' 'OK' 'not checked on this OS' }
elseif ($owners.Count) {
    $list = ($owners | ForEach-Object { "$($_.Port): $($_.Name) pid $($_.Pid)" }) -join '; '
    $ids = ($owners | Select-Object -ExpandProperty Pid -Unique) -join ', '
    Add-Result 'Ports 5080 8130 5173 8140 free' 'FAIL' $list "Started as Administrator or by another program. Task Manager > Details > end pid $ids (or restart Windows)."
} else { Add-Result 'Ports 5080 8130 5173 8140 free' 'OK' 'free' }

# ---- optional -----------------------------------------------------------------------------------------
if (Get-Command ollama -ErrorAction SilentlyContinue) { Add-Result 'Ollama (optional, offline LLM)' 'OK' 'installed' }
else { Add-Result 'Ollama (optional, offline LLM)' 'INFO' 'not installed' 'Only needed for migrate-gridtrade.ps1 -Llm ollama (ollama.com).' }

# ---- report -------------------------------------------------------------------------------------------
Write-Host ''
foreach ($r in $results) {
    $color = @{ OK = 'Green'; FIXED = 'Green'; INFO = 'Gray'; WARN = 'Yellow'; FAIL = 'Red' }[$r.Status]
    Write-Host ('  [{0,-5}] {1,-34} {2}' -f $r.Status, $r.Check, $r.Detail) -ForegroundColor $color
    if ($r.Fix -and $r.Status -ne 'OK' -and $r.Status -ne 'FIXED') { Write-Host ("          -> " + $r.Fix) -ForegroundColor $color }
}
$fails = @($results | Where-Object { $_.Status -eq 'FAIL' })
Write-Host ''
if ($fails.Count) {
    Write-Host "  $($fails.Count) problem(s) to fix first (see -> above), then run this again." -ForegroundColor Red
    exit 1
}
Write-Host '  All checks passed.' -ForegroundColor Green
exit 0
