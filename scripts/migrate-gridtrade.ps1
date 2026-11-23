<#
.SYNOPSIS
  Convert the GridTrade Ext JS app to React (one time) with the extjs-migrate CLI, and build-check the result.

.DESCRIPTION
  The migration is a one-time step. Its output, <workspace>\gridtrade-react, is from then on your React app: you add
  and change displays there (by hand or with UI Forge), and nothing regenerates it.

  - No React app yet: converts the Ext JS app into it (and brings in the displays of an older setup, if any).
  - The React app exists: does nothing and says so (-IfMissing: silently), so it can never overwrite your work.
  - -Refresh: re-runs the conversion into the existing app, for example after a migration-agent fix. It rewrites only
    the converted Ext JS code (src\app, src\overrides, src\ext-modules.ts, src\ext-screens) and the project files
    (package.json, vite.config.ts, ...); your displays, menus, bridge and UI Forge screens are kept. A backup of the
    converted code is made first in gridtrade-react\.migration-backups.

.EXAMPLE
  scripts\migrate-gridtrade.ps1                      # first conversion -> <workspace>\gridtrade-react
  scripts\migrate-gridtrade.ps1 -Llm ollama          # send flagged code to a local Ollama model
  scripts\migrate-gridtrade.ps1 -Refresh             # convert again into the existing app (see above)
#>
param(
    [string]$Workspace,
    [string]$GridTrade,
    [string]$Out,
    [ValidateSet('framework', 'compat')][string]$Shell = 'framework',
    [ValidateSet('none', 'ollama')][string]$Llm = 'none',
    [switch]$NoVerify,
    [switch]$Refresh,
    [switch]$IfMissing
)
. (Join-Path $PSScriptRoot 'local-common.ps1')
Assert-NotAdmin 'migrate-gridtrade.ps1'

$ws = Resolve-Workspace $Workspace
if (-not $GridTrade) { $GridTrade = Join-Path $ws 'gridtrade-contracts-extjs' }
if (-not $Out) { $Out = Join-Path $ws ($(if ($Shell -eq 'framework') { 'gridtrade-react' } else { 'gridtrade-react-compat' })) }
$web = Join-Path $GridTrade 'web'
if (-not (Test-Path (Join-Path $web 'app.json'))) { throw "No Ext JS app at $web (app.json not found). Pass -GridTrade <folder>." }

$exists = Test-Path (Join-Path $Out 'package.json')
if ($exists -and -not $Refresh) {
    if ($IfMissing) { Write-Ok "Already converted: $Out is your React app (nothing to do)."; return }
    Write-Ok "$Out already exists: it is your React app now, so the conversion is not run again."
    Write-Host '    Add or change displays there directly. To convert again anyway (keeps your displays, backs up the'
    Write-Host '    converted code first): scripts\migrate-gridtrade.ps1 -Refresh'
    return
}
$null = Get-NodeExe
$cli = Get-VenvTool 'extjs-migrate'

$cliArgs = @('migrate', $web, '-o', $Out, '--shell', $Shell, '--llm', $Llm)
if ($exists) {
    Merge-LegacyAppFiles $ws $GridTrade $Out
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = Join-Path (Join-Path $Out '.migration-backups') "converted-$stamp"
    Write-Step "Backing up the converted code before refreshing it: $backup"
    foreach ($rel in @('src\app', 'src\overrides', 'src\ext-modules.ts', 'src\ext-screens', 'package.json')) {
        $p = Join-Path $Out $rel
        if (Test-Path $p) {
            $dest = Join-Path $backup $rel
            New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
            Copy-Item -Path $p -Destination $dest -Recurse -Force
        }
    }
} elseif ($Shell -eq 'framework') {
    # first conversion: bring in the displays and menus of an older setup, if there is one
    $legacy = Get-LegacyAppFiles $ws $GridTrade
    if ($legacy) { $cliArgs += @('--app-files', $legacy) }
}
if (-not $NoVerify) { $cliArgs += '--verify' }

Write-Step "extjs-migrate $($cliArgs -join ' ')"
& $cli @cliArgs
if ($LASTEXITCODE -ne 0) { throw "Migration failed (exit $LASTEXITCODE). See $(Join-Path $Out 'MIGRATION_REPORT.md')." }
if (-not $exists -and $Shell -eq 'framework' -and (Get-LegacyAppFiles $ws $GridTrade)) { Merge-LegacyAppFiles $ws $GridTrade $Out }

Write-Host ''
Write-Ok "React project: $Out   (your app from now on: add and change displays here)"
Write-Ok "Report:        $(Join-Path $Out 'MIGRATION_REPORT.md')"
if ($Shell -eq 'framework') { Write-Host 'Next: scripts\start-local.ps1   (API + display registry + menus registered + React app)' -ForegroundColor Green }
else { Write-Host "Next: start the API with 'npm run start:demo' in $GridTrade, then 'npm run dev' in $Out" -ForegroundColor Green }
