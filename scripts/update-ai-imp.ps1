<#
.SYNOPSIS
  One-click update of the local AI-Imp setup from an update zip: stop, extract (with backups), reinstall, update the app's
  shared libraries, start. Run it through update-ai-imp.bat (double-click, or drag a zip onto it).

.DESCRIPTION
  - The zip is the one given on the command line, else the newest *.zip in this folder's "updates" subfolder, this
    folder, or your Downloads folder whose name contains "update".
  - Every file the zip replaces is copied first to .update-backups\<date-time>\ (same folder layout).
  - Your project's own UI Forge files are never overwritten: gridtrade-contracts-extjs\react-app\** and
    gridtrade-contracts-extjs\server\generated\** are skipped (use -IncludeProjectFiles to take them anyway).
  - Stops at the first failing step and says which one.

.EXAMPLE
  update-ai-imp.bat                                    # newest update zip
  update-ai-imp.bat C:\Users\me\Downloads\x.zip         # this zip
  powershell -ExecutionPolicy Bypass -File update-ai-imp.ps1 -Zip x.zip -NoStart
#>
param(
    [string]$Zip,
    [switch]$IncludeProjectFiles,
    [switch]$NoMigrate,
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Platform = Join-Path $Root 'ai-agent-platform'
$Scripts = Join-Path $Platform 'scripts'
$AllowedTop = @('ai-agent-platform', 'gridtrade-contracts-extjs')
$Protected = @('gridtrade-react/', 'gridtrade-react-app/', 'gridtrade-contracts-extjs/react-app/', 'gridtrade-contracts-extjs/server/generated/')

function Step($n, $text) { Write-Host ''; Write-Host "==> [$n] $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    $text" -ForegroundColor Green }
function Note($text) { Write-Host "    $text" -ForegroundColor Yellow }
function Fail($text) { throw $text }
function Run-Ps($file, [string[]]$arguments) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $file @arguments
    if ($LASTEXITCODE -ne 0) { Fail "$(Split-Path $file -Leaf) failed (exit $LASTEXITCODE)." }
}

try {
    if (-not (Test-Path (Join-Path $Platform 'pyproject.toml'))) {
        Fail "Put this file in the folder that contains ai-agent-platform (expected $Platform)."
    }
    $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Fail 'Run this from a normal window, not as Administrator: services it starts would otherwise only be stoppable as Administrator.'
    }

    # ---------------------------------------------------------------- 1. which zip
    Step 1 'Finding the update zip'
    if (-not $Zip) {
        $places = @((Join-Path $Root 'updates'), $Root, (Join-Path $env:USERPROFILE 'Downloads'))
        $found = foreach ($p in $places) {
            if (Test-Path $p) { Get-ChildItem -Path $p -Filter '*.zip' -File | Where-Object { $_.Name -match 'update' } }
        }
        $pick = $found | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $pick) { Fail "No update zip found. Drag the zip onto update-ai-imp.bat, or put it in $Root." }
        $Zip = $pick.FullName
    }
    $Zip = (Resolve-Path $Zip).Path
    Ok "$Zip  ($([math]::Round((Get-Item $Zip).Length / 1MB, 1)) MB, $((Get-Item $Zip).LastWriteTime))"

    # ---------------------------------------------------------------- 2. stop
    Step 2 'Stopping running services'
    $stop = Join-Path $Scripts 'stop-local.ps1'
    if (Test-Path $stop) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stop } else { Note 'stop-local.ps1 not found; skipped' }
    # Check here rather than fail at the very end: a service still running would block the start (and can lock files)
    if (-not $NoStart -and (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
        $busy = @(Get-NetTCPConnection -State Listen -LocalPort 5080, 8130, 5173, 8140 -ErrorAction SilentlyContinue)
        if ($busy.Count) {
            $list = ($busy | ForEach-Object { "port $($_.LocalPort): pid $($_.OwningProcess) $((Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName)" }) -join '; '
            Fail "Services are still running ($list). End them in Task Manager > Details (by pid), or run this .bat as Administrator if you started them from an Administrator window, then run the update again. Nothing has been changed yet."
        }
    }

    # ---------------------------------------------------------------- 3. extract with backups
    Step 3 'Extracting (backing up every file it replaces)'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupRoot = Join-Path (Join-Path $Root '.update-backups') $stamp
    $written = 0; $backedUp = 0; $skipped = @()
    $archive = [System.IO.Compression.ZipFile]::OpenRead($Zip)
    try {
        foreach ($e in $archive.Entries) {
            $rel = $e.FullName -replace '\\', '/'
            if ($rel.EndsWith('/') -or -not $e.Name) { continue }                 # folder entry
            $top = $rel.Split('/')[0]
            if ($AllowedTop -notcontains $top -or $rel -match '(^|/)\.\.(/|$)' -or $rel -match '^[A-Za-z]:|^/') {
                Fail "The zip contains an unexpected path: $rel. Nothing more was extracted; check the zip."
            }
            if (-not $IncludeProjectFiles -and ($Protected | Where-Object { $rel.StartsWith($_) })) { $skipped += $rel; continue }
            $dest = Join-Path $Root ($rel -replace '/', '\')
            if (Test-Path $dest) {
                $bak = Join-Path $backupRoot ($rel -replace '/', '\')
                New-Item -ItemType Directory -Force -Path (Split-Path $bak) | Out-Null
                Copy-Item -LiteralPath $dest -Destination $bak -Force
                $backedUp++
            }
            New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
            try { Unblock-File -LiteralPath $dest -ErrorAction Stop } catch { }   # downloaded files are blocked by Windows
            $written++
        }
    } finally { $archive.Dispose() }
    Ok "$written file(s) written, $backedUp replaced file(s) backed up to $backupRoot"
    # scripts an update retired (backed up like any replaced file)
    foreach ($rel in @('ai-agent-platform/scripts/apply-app-files.ps1')) {
        $p = Join-Path $Root ($rel -replace '/', '\')
        if (Test-Path $p) {
            $bak = Join-Path $backupRoot ($rel -replace '/', '\')
            New-Item -ItemType Directory -Force -Path (Split-Path $bak) | Out-Null
            Move-Item -LiteralPath $p -Destination $bak -Force
            Note "Removed $rel (no longer used)"
        }
    }
    if ($skipped.Count) {
        Note "$($skipped.Count) file(s) of your project were NOT overwritten (react-app / server\generated):"
        $skipped | Select-Object -First 8 | ForEach-Object { Write-Host "      $_" }
        if ($skipped.Count -gt 8) { Write-Host "      ... and $($skipped.Count - 8) more" }
        Note 'That is normal: UI Forge regenerates them. Use -IncludeProjectFiles only if you were told to.'
    }

    # ---------------------------------------------------------------- 4. packages present?
    Step 4 'Checking the shared React packages'
    $agent = Join-Path $Platform 'agents\extjs-migration-agent'
    foreach ($name in @('runtime', 'framework')) {
        $pj = Join-Path $agent "$name\package.json"
        if (-not (Test-Path $pj)) { continue }
        $ver = (Get-Content $pj -Raw | ConvertFrom-Json).version
        $tgz = Join-Path $agent "packages\extreact-$name-$ver.tgz"
        if (-not (Test-Path $tgz)) { Fail "Missing $tgz. The zip did not contain it; ask for a zip that includes the packages." }
        Ok "@extreact/$name $ver"
    }

    # ---------------------------------------------------------------- 5. python install
    Step 5 'Refreshing the Python install'
    $py = Join-Path $Platform '.venv\Scripts\python.exe'
    if (-not (Test-Path $py)) {
        Note 'No .venv yet: running setup-local.ps1'
        Run-Ps (Join-Path $Scripts 'setup-local.ps1') @()
    } else {
        Push-Location $Platform
        try {
            & $py -m pip install --disable-pip-version-check -q -e '.[dev]'
            if ($LASTEXITCODE -ne 0) { Fail 'pip install of the platform failed.' }
            & $py -m pip install --disable-pip-version-check -q -e 'agents\extjs-migration-agent'
            if ($LASTEXITCODE -ne 0) { Fail 'pip install of the migration agent failed.' }
        } finally { Pop-Location }
    }
    Ok 'platform and migration agent installed'

    # ---------------------------------------------------------------- 6. app
    # The React app is yours after the first conversion: an update only refreshes its shared libraries.
    if ($NoMigrate) { Step 6 'React app: skipped (-NoMigrate)' }
    elseif (Test-Path (Join-Path (Join-Path $Root 'gridtrade-react') 'package.json')) {
        Step 6 'Updating the shared React libraries in gridtrade-react (your code is not touched)'
        Run-Ps (Join-Path $Scripts 'update-app-packages.ps1') @()
    } else {
        Step 6 'Converting GridTrade to React (first time: install, type-check, build)'
        Run-Ps (Join-Path $Scripts 'migrate-gridtrade.ps1') @()
    }

    # ---------------------------------------------------------------- 7. start
    if ($NoStart) { Step 7 'Starting: skipped (-NoStart)' }
    else {
        Step 7 'Starting API, registry, React app and UI Forge'
        Run-Ps (Join-Path $Scripts 'start-local.ps1') @('-WithBuilder')
    }

    Write-Host ''
    Write-Host 'Update finished.' -ForegroundColor Green
    Write-Host "Backups of replaced files: $backupRoot"
    exit 0
} catch {
    Write-Host ''
    Write-Host "UPDATE STOPPED: $($_.Exception.Message)" -ForegroundColor Red
    if ($backupRoot -and (Test-Path $backupRoot)) { Write-Host "Files replaced so far were backed up to $backupRoot" }
    exit 1
}
