<#
.SYNOPSIS
  Install the newest shared React libraries (@extreact/runtime, @extreact/framework) into your React app, without
  converting anything again. Run after an update of ai-agent-platform; update-ai-imp.bat does it for you.

.DESCRIPTION
  Points the app's package.json at the library versions in ai-agent-platform\agents\extjs-migration-agent\packages,
  runs npm install (from the npm cache when possible) and type-checks. Only those two dependency lines change.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\update-app-packages.ps1
#>
param([string]$Workspace, [string]$App)
. (Join-Path $PSScriptRoot 'local-common.ps1')
Assert-NotAdmin 'update-app-packages.ps1'

$ws = Resolve-Workspace $Workspace
if (-not $App) { $App = Join-Path $ws 'gridtrade-react' }
$pkgFile = Join-Path $App 'package.json'
if (-not (Test-Path $pkgFile)) { throw "No React app at $App. Run scripts\migrate-gridtrade.ps1 first." }

$packages = Join-Path $AgentDir 'packages'
$text = Get-Content -Raw -Path $pkgFile
$changed = @()
foreach ($name in @('runtime', 'framework')) {
    $pj = Join-Path (Join-Path $AgentDir $name) 'package.json'
    $ver = (Get-Content -Raw $pj | ConvertFrom-Json).version
    $file = "extreact-$name-$ver.tgz"
    if (-not (Test-Path (Join-Path $packages $file))) { throw "Missing $(Join-Path $packages $file). Apply the latest update zip." }
    $pattern = "extreact-$name-[0-9][0-9A-Za-z.\-]*\.tgz"
    if ($text -notmatch $pattern) { Write-Note "@extreact/$name is not a dependency of this app; skipped"; continue }
    $current = [regex]::Match($text, $pattern).Value
    if ($current -ne $file) { $text = [regex]::Replace($text, $pattern, $file); $changed += "@extreact/$name $current -> $file" }
}
if (-not $changed.Count) {
    Write-Ok 'The app already uses the newest shared libraries.'
    return
}
Write-Step 'Updating package.json'
$changed | ForEach-Object { Write-Ok $_ }
[System.IO.File]::WriteAllText($pkgFile, $text, (New-Object System.Text.UTF8Encoding($false)))

$npm = Get-NpmExe
Push-Location $App
try {
    Write-Step 'npm install (from the npm cache when possible)'
    & $npm install --prefer-offline --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed; see above.' }
    Write-Step 'Type check (tsc)'
    $npx = if ($OnWindows) { 'npx.cmd' } else { 'npx' }
    & $npx tsc --noEmit -p .
    if ($LASTEXITCODE -ne 0) { throw 'Type errors above (file:line) after the library update.' }
} finally { Pop-Location }
Write-Ok 'Shared libraries updated. Restart with scripts\start-local.ps1 to use them.'
