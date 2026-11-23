<#
.SYNOPSIS
  Rebuild the shared React libraries the migrated applications install: @extreact/runtime and @extreact/framework.
  Output: agents\extjs-migration-agent\packages\extreact-<name>-<version>.tgz (prebuilt; applications depend on these).

.DESCRIPTION
  Only needed after changing agents\extjs-migration-agent\runtime or \framework. Bump "version" in that package.json
  first, so applications see a new version (npm does not reinstall a .tgz with the same version), then run this and
  re-run the migration (or `npm install` in the app after updating its package.json).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-packages.ps1
#>
param([switch]$SkipTests)
. (Join-Path $PSScriptRoot 'local-common.ps1')

$npm = Get-NpmExe
foreach ($pkg in @('runtime', 'framework')) {
    Write-Step "@extreact/$pkg"
    Push-Location (Join-Path $AgentDir $pkg)
    try {
        if (-not (Test-Path 'node_modules')) { & $npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw "npm ci failed in $pkg" } }
        if (-not $SkipTests) { & $npm test; if ($LASTEXITCODE -ne 0) { throw "$pkg tests failed" } }
        & $npm run pack:local
        if ($LASTEXITCODE -ne 0) { throw "packing $pkg failed" }
    } finally { Pop-Location }
}
Write-Ok "Packages: $(Join-Path $AgentDir 'packages')"
Get-ChildItem (Join-Path $AgentDir 'packages') -Filter '*.tgz' | ForEach-Object { Write-Host "    $($_.Name)" }
