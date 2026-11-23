<#
.SYNOPSIS
  Stop the services started by start-local.ps1 (process ids are kept in <workspace>\.local-run), then make sure
  nothing is left listening on the local ports (API 5080, registry 8130, React app 5173/4173, UI Forge 8140).
#>
param([string]$Workspace)
. (Join-Path $PSScriptRoot 'local-common.ps1')

$ws = Resolve-Workspace $Workspace
$state = Join-Path $ws '.local-run'
$ports = $LocalPorts

function Stop-Tree([int]$procId) {
    # returns $true when the process is gone afterwards
    if ($OnWindows) {
        # /T ends the child processes too. A child that is already exiting makes taskkill print "Access is denied";
        # that is noise, so the output is dropped (inside cmd: Windows PowerShell 5.1 would turn taskkill's error
        # text into a script-stopping error) and the ports are checked below instead.
        & cmd.exe /d /c "taskkill /PID $procId /T /F >nul 2>&1"
        if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
            try { Stop-Process -Id $procId -Force -ErrorAction Stop } catch { }
        }
    } else {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
    for ($i = 0; $i -lt 10 -and (Get-Process -Id $procId -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 200 }
    return -not (Get-Process -Id $procId -ErrorAction SilentlyContinue)
}
$denied = @()

if (Test-Path $state) {
    foreach ($f in Get-ChildItem -Path $state -Filter '*.pid') {
        $procId = [int](Get-Content $f.FullName | Select-Object -First 1)
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($p) {
            if (Stop-Tree $procId) { Write-Ok "Stopped $($f.BaseName) (pid $procId)" }
            else { $denied += $procId; Write-Warning "Could not stop $($f.BaseName) (pid $procId): access denied" }
        }
        Remove-Item $f.FullName
    }
}

if (-not $OnWindows) { return }

# Anything still listening on our ports: a service started by hand, or a child that outlived its parent
Start-Sleep -Milliseconds 800
$left = @(Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue |
          Select-Object -Property LocalPort, OwningProcess -Unique)
foreach ($c in $left) {
    $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -match '^(python|node)') {
        if ($denied -contains $c.OwningProcess) { continue }
        if (Stop-Tree $c.OwningProcess) { Write-Ok "Stopped $($p.ProcessName) on port $($c.LocalPort) (pid $($c.OwningProcess))" }
        else { $denied += $c.OwningProcess }
    }
}
Start-Sleep -Milliseconds 500
$still = @(Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue)
if ($still.Count) {
    foreach ($c in $still) {
        $name = (Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).ProcessName
        Write-Warning "Port $($c.LocalPort) is still in use by $name (pid $($c.OwningProcess)). End it in Task Manager (Details tab, pid $($c.OwningProcess)), or: Stop-Process -Id $($c.OwningProcess) -Force"
    }
    $ids = ($still | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
    Write-Warning "These were probably started from an Administrator window, so only an Administrator can stop them. In PowerShell run as Administrator: Stop-Process -Id $ids -Force"
    exit 1
} else {
    Write-Ok 'All local ports are free (5080, 8130, 5173, 4173, 8140).'
}
