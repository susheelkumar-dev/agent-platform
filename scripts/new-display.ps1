<#
.SYNOPSIS
  Create a new screen in the React app in one command: a list with an edit form beside it (New, Save, Delete,
  change history), the same kind of screen as Reference Data -> Legal Entities.

.DESCRIPTION
  Writes, in <workspace>\gridtrade-react:
    src\modules\<module>\views\<Name>.ts              the screen (record fields, list columns, form fields)
    src\app-bridge.ts                                  + one line, so the screen loads when first opened
    registration\gridtrade.custom.manifest.json        + the display and its menu entry (version raised)
  then type-checks the app and registers the menu (register-displays.ps1).
  Afterwards you only adjust labels, widths or extra rules in the screen file, if you want to.

.PARAMETER Name
  The screen's name in PascalCase, plural: DeliveryNodes, MarketZones.
.PARAMETER Api
  The API path that lists and saves the records, relative to the app's API: nodes  (= /api/nodes).
.PARAMETER Fields
  The record's fields, comma separated. Add ! for required, :number, :date or :boolean for the type,
  =A|B|C for a fixed list of choices:   "code!,name!,region=North|West|South|East|Central,enabled:boolean"
.PARAMETER Menu
  The menu folder: contracts, trading, data, reference, assets or users.
.PARAMETER Permission
  The permission group: view needs <Permission>.view, saving <Permission>.edit, deleting <Permission>.delete.
  Default: the one that matches the menu folder (reference -> reference, trading -> trades, ...).
.PARAMETER Title
  Menu and screen title. Default: from Name (DeliveryNodes -> "Delivery Nodes").
.PARAMETER Entity
  One record's name. Default: the title without its last "s" ("Delivery Node").
.PARAMETER CreateDemoApi
  Also create the API in GridTrade's demo Node API (gridtrade-contracts-extjs\server\server.js): list, get, create,
  update, delete for -Api, each checking the permissions, with an empty store to start. For your own backend
  (for example .NET) leave this off: the backend team builds the same five endpoints.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\new-display.ps1 -Name DeliveryNodes -Api nodes -Menu reference `
      -Fields "code!,name!,region=North|West|South|East|Central,enabled:boolean"
.EXAMPLE
  # a brand-new kind of record, API included (GridTrade demo API)
  powershell -ExecutionPolicy Bypass -File scripts\new-display.ps1 -Name MeterPoints -Api meter-points -Menu reference `
      -Fields "code!,name!,capacityKw:number,installedOn:date,active:boolean" -CreateDemoApi
#>
param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Api,
    [Parameter(Mandatory = $true)][string]$Fields,
    [Parameter(Mandatory = $true)][ValidateSet('contracts', 'trading', 'data', 'reference', 'assets', 'users')][string]$Menu,
    [string]$Permission,
    [string]$Title,
    [string]$Entity,
    [int]$SortOrder = 90,
    [string]$Workspace,
    [string]$App,
    [switch]$NoRegister,
    [switch]$CreateDemoApi
)
. (Join-Path $PSScriptRoot 'local-common.ps1')
Assert-NotAdmin 'new-display.ps1'

$ws = Resolve-Workspace $Workspace
if (-not $App) { $App = Join-Path $ws 'gridtrade-react' }
if (-not (Test-Path (Join-Path $App 'package.json'))) { throw "No React app at $App. Run scripts\migrate-gridtrade.ps1 first." }

# ---- names ---------------------------------------------------------------------------------------------
if ($Name -notmatch '^[A-Z][A-Za-z0-9]{2,60}$') { throw "-Name must be PascalCase letters and digits, e.g. DeliveryNodes" }
if (-not $Title) { $Title = ($Name -creplace '([a-z0-9])([A-Z])', '$1 $2') }
if (-not $Entity) { $Entity = $(if ($Title -match 'ies$') { $Title -replace 'ies$', 'y' } elseif ($Title -match 's$') { $Title -replace 's$', '' } else { $Title }) }
$single = ($Entity -replace '[^A-Za-z0-9 ]', '' -split ' ' | ForEach-Object { if ($_) { $_.Substring(0, 1).ToUpper() + $_.Substring(1) } }) -join ''
if (-not $Permission) { $Permission = @{ contracts = 'contracts'; trading = 'trades'; data = 'data'; reference = 'reference'; assets = 'assets'; users = 'users' }[$Menu] }
# GridTrade's permission groups: most have view / edit / delete; data has no delete; users uses manage
$editPerm = $(if ($Permission -eq 'users') { 'users.manage' } else { "$Permission.edit" })
$deletePerm = $(if ($Permission -eq 'users') { 'users.manage' } elseif ($Permission -eq 'data') { 'data.edit' } else { "$Permission.delete" })
$ns = 'GT'
$globals = Join-Path (Join-Path $App 'src') 'app-globals.d.ts'
if (Test-Path $globals) { $m = [regex]::Match((Get-Content -Raw $globals), 'declare var (\w+)'); if ($m.Success) { $ns = $m.Groups[1].Value } }
$lower = $Name.ToLower()
$xtype = "$($ns.ToLower())-$lower"
$slug = ($Title.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
$displayId = "$Menu.$slug"
$route = "$Menu/$slug"
$apiPath = 'api/' + $Api.Trim('/').Replace('api/', '')
$moduleDir = Join-Path (Join-Path (Join-Path $App 'src') 'modules') $Menu
$file = Join-Path (Join-Path $moduleDir 'views') "$Name.ts"
$importPath = "./modules/$Menu/views/$Name"

# ---- fields --------------------------------------------------------------------------------------------
$specs = @()
foreach ($raw in ($Fields -split ',')) {
    $t = $raw.Trim(); if (-not $t) { continue }
    $required = $t.Contains('!'); $t = $t.Replace('!', '')
    $choices = $null
    if ($t.Contains('=')) { $parts = $t.Split('=', 2); $t = $parts[0]; $choices = @($parts[1].Split('|') | Where-Object { $_ }) }
    $type = 'string'
    if ($t.Contains(':')) { $parts = $t.Split(':', 2); $t = $parts[0]; $type = $parts[1].ToLower() }
    if ($t -notmatch '^[a-z][A-Za-z0-9]*$') { throw "Field '$raw': use a camelCase name such as code, name, creditLimit" }
    if ($type -notin @('string', 'number', 'date', 'boolean')) { throw "Field '$raw': type must be number, date or boolean (or nothing for text)" }
    $label = ($t -creplace '([a-z0-9])([A-Z])', '$1 $2'); $label = $label.Substring(0, 1).ToUpper() + $label.Substring(1)
    $specs += [pscustomobject]@{ Name = $t; Label = $label; Type = $type; Required = $required; Choices = $choices }
}
if (-not $specs.Count) { throw '-Fields is empty' }
$q = { param($s) "'" + ($s -replace "'", "\'") + "'" }

$modelFields = @(); $formItems = @(); $columns = @()
$first = $true
foreach ($f in $specs) {
    $mt = @{ string = 'string'; number = 'number'; date = 'date'; boolean = 'boolean' }[$f.Type]
    $def = ''
    if ($f.Type -eq 'boolean') { $def = ', defaultValue: true' } elseif ($f.Choices) { $def = ", defaultValue: $(& $q $f.Choices[0])" }
    $modelFields += "        { name: $(& $q $f.Name), type: '$mt'$(if ($f.Type -eq 'date') { ", dateFormat: 'Y-m-d'" })$def },"
    $req = $(if ($f.Required) { ', allowBlank: false' } else { '' })
    if ($f.Type -eq 'boolean') {
        $formItems += "                { xtype: 'checkbox', name: $(& $q $f.Name), fieldLabel: $(& $q $f.Label), inputValue: true, uncheckedValue: false },"
        $columns += "            { text: $(& $q $f.Label), dataIndex: $(& $q $f.Name), xtype: 'booleancolumn', trueText: 'Yes', falseText: 'No', width: 90, align: 'center', filter: 'boolean' },"
    } elseif ($f.Choices) {
        $list = ($f.Choices | ForEach-Object { & $q $_ }) -join ', '
        $formItems += "                { xtype: 'combobox', name: $(& $q $f.Name), fieldLabel: $(& $q $f.Label), store: [$list], forceSelection: true, editable: false$req },"
        $columns += "            { text: $(& $q $f.Label), dataIndex: $(& $q $f.Name), width: 130, filter: 'list' },"
    } elseif ($f.Type -eq 'number') {
        $formItems += "                { xtype: 'numberfield', name: $(& $q $f.Name), fieldLabel: $(& $q $f.Label)$req },"
        $columns += "            { text: $(& $q $f.Label), dataIndex: $(& $q $f.Name), width: 130, align: 'right', filter: 'number' },"
    } elseif ($f.Type -eq 'date') {
        $formItems += "                { xtype: 'datefield', name: $(& $q $f.Name), fieldLabel: $(& $q $f.Label), format: 'd-M-Y', submitFormat: 'Y-m-d'$req },"
        $columns += "            { text: $(& $q $f.Label), dataIndex: $(& $q $f.Name), xtype: 'datecolumn', format: 'd-M-Y', width: 130, filter: 'date' },"
    } else {
        $formItems += "                { xtype: 'textfield', name: $(& $q $f.Name), fieldLabel: $(& $q $f.Label)$req },"
        $width = $(if ($first) { 'width: 130' } else { 'flex: 1, minWidth: 180' })
        $columns += "            { text: $(& $q $f.Label), dataIndex: $(& $q $f.Name), $width, filter: 'string' },"
    }
    $first = $false
}
$sortField = $specs[0].Name

# ---- checks before writing anything --------------------------------------------------------------------
if (Test-Path $file) { throw "$file already exists. Pick another -Name, or delete that file first." }
$bridge = Join-Path (Join-Path $App 'src') 'app-bridge.ts'
$bridgeText = Get-Content -Raw $bridge
if ($bridgeText -match [regex]::Escape("'widget.$xtype'")) { throw "src\app-bridge.ts already registers widget.$xtype." }
$manifestFile = Join-Path (Join-Path $App 'registration') 'gridtrade.custom.manifest.json'
foreach ($mf in Get-ChildItem (Join-Path $App 'registration') -Filter '*.manifest.json') {
    $m = Get-Content -Raw $mf.FullName | ConvertFrom-Json
    if (@($m.displays | Where-Object { $_.id -eq $displayId -or $_.route -eq $route }).Count) { throw "A display with id $displayId or route $route already exists in $($mf.Name). Pick another -Name or -Title." }
    if (@($m.displays | Where-Object { $_.config -and $_.config.xtype -eq $xtype }).Count) { throw "xtype $xtype is already used in $($mf.Name)." }
}

$server = Join-Path (Join-Path (Join-Path $ws 'gridtrade-contracts-extjs') 'server') 'server.js'
$apiRoute = '/' + $apiPath
if ($CreateDemoApi) {
    if (-not (Test-Path $server)) { throw "-CreateDemoApi needs GridTrade's demo API at $server." }
    if ((Get-Content -Raw $server) -match [regex]::Escape("'$apiRoute'")) { throw "The demo API already has $apiRoute. Leave out -CreateDemoApi to use it." }
}

# ---- 1. the screen file --------------------------------------------------------------------------------
Write-Step "Creating $file"
$content = @"
/*
 * $Menu -> $Title. Created by scripts\new-display.ps1 from the pattern of Reference Data -> Legal Entities:
 * a list with an edit form beside it (New, Save, Delete, change history). Ext JS style on @extreact/runtime.
 * Change labels, widths and form fields below as you like; keep the names in the three Ext.define lines.
 */
import { Ext } from '@extreact/runtime';

// The record: its fields, and the API it is read from and saved to
Ext.define('$ns.model.$single', {
    extend: '$ns.core.BaseModel',
    fields: [
$($modelFields -join "`n")
        { name: 'isSystem', type: 'boolean', persist: false }
    ],
    proxy: { type: 'gt-rest', url: '$apiPath' }
});

// The list's data
Ext.define('$ns.store.$Name', {
    extend: '$ns.core.BaseStore',
    alias: 'store.$xtype',
    model: '$ns.model.$single'
});

// The screen
Ext.define('$ns.view.$Menu.$Name', {
    extend: '$ns.ux.panel.MasterDetail',
    xtype: '$xtype',

    modelName: '$ns.model.$single',
    entityName: $(& $q $Entity),
    listTitle: $(& $q $Title),
    editPermission: '$editPerm',
    deletePermission: '$deletePerm',
    auditEntityType: $(& $q $Entity),

    statics: {
        // the entry form on the right
        formItems: function () {
            return [
$($formItems -join "`n")
            ];
        }
    },

    initComponent: function () {
        this.store = { type: '$xtype', sorters: ['$sortField'] };
        // the list's columns
        this.columns = [
$($columns -join "`n")
        ];
        this.formItems = this.self.formItems();
        this.callParent(arguments);
    }
});
"@
New-Item -ItemType Directory -Force -Path (Split-Path $file) | Out-Null
[System.IO.File]::WriteAllText($file, ($content -replace "`r`n", "`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Ok "screen class $ns.view.$Menu.$Name, xtype $xtype, API /$apiPath"

# ---- 2. app-bridge.ts: load it on first use ------------------------------------------------------------
Write-Step 'Adding the loader line to src\app-bridge.ts'
$line = "  'widget.$xtype': () => import('$importPath'),"
if ($bridgeText -match 'Ext\.Loader\.register\(\{') {
    $bridgeText = [regex]::Replace($bridgeText, 'Ext\.Loader\.register\(\{\r?\n', { param($m) $m.Value + $line + "`n" }, 1)
} else {
    $block = "// ---- Screens you add in the Ext JS style: their xtype -> the file that defines it (downloaded on first use) ----`nExt.Loader.register({`n$line`n});`n`n"
    $idx = $bridgeText.IndexOf('export const screens')
    if ($idx -lt 0) { throw 'src\app-bridge.ts has no "export const screens"; add the loader line by hand (see the guide).' }
    $bridgeText = $bridgeText.Substring(0, $idx) + $block + $bridgeText.Substring($idx)
}
[System.IO.File]::WriteAllText($bridge, $bridgeText, (New-Object System.Text.UTF8Encoding($false)))
Write-Ok $line.Trim()

# ---- 3. the menu entry ---------------------------------------------------------------------------------
Write-Step 'Adding the display and menu entry to registration\gridtrade.custom.manifest.json'
if (Test-Path $manifestFile) {
    $man = Get-Content -Raw $manifestFile | ConvertFrom-Json
    $v = $man.module.version.Split('.'); $v[2] = [string]([int]$v[2] + 1); $man.module.version = $v -join '.'
} else {
    $man = [pscustomobject]@{ schemaVersion = 1; app = 'gridtrade'
        module = [pscustomobject]@{ id = 'gridtrade.custom'; version = '1.0.0'; title = 'Screens added after the migration'; owner = 'GridTrade' }
        displays = @(); menus = @() }
}
$display = [pscustomobject]@{ id = $displayId; title = $Title; type = 'custom'; key = 'ExtScreen'; route = $route; icon = 'x-fa fa-list'
    requiredPermissions = @("$Permission.view"); config = [pscustomobject]@{ xtype = $xtype } }
$menuItem = [pscustomobject]@{ id = $displayId; title = $Title; parent = $Menu; display = $displayId; icon = 'x-fa fa-list'; sortOrder = $SortOrder }
$man.displays = @($man.displays) + $display
$man.menus = @($man.menus) + $menuItem
[System.IO.File]::WriteAllText($manifestFile, ($man | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
Write-Ok "display $displayId, menu $Menu -> $Title, needs $Permission.view (manifest version $($man.module.version))"

# ---- 4. the demo API (GridTrade's Node API only) ----------------------------------------------------------
if ($CreateDemoApi) {
    Write-Step "Adding the API $apiRoute to the demo API ($server)"
    $coll = $Name.Substring(0, 1).ToLower() + $Name.Substring(1)
    $fieldList = ($specs | ForEach-Object { "'$($_.Name)'" }) -join ', '
    $requiredList = ($specs | Where-Object { $_.Required } | ForEach-Object { "'$($_.Name)'" }) -join ', '
    $numeric = ($specs | Where-Object { $_.Type -eq 'number' } | ForEach-Object { "'$($_.Name)'" }) -join ', '
    $js = @"

// ---- $Title API, created by new-display.ps1 -CreateDemoApi: list, get, create, update, delete ----------------
(() => {
  const coll = '$coll', base = '$apiRoute', entityType = $(& $q $Entity);
  const FIELDS = [$fieldList], REQUIRED = [$requiredList], NUMBERS = [$numeric];
  const PERM = { view: '$Permission.view', edit: '$editPerm', remove: '$deletePerm' };
  const rows = () => (D()[coll] = D()[coll] || []);   // the records, kept in server/data/db.json
  const pick = body => {
    const d = {};
    FIELDS.forEach(f => { if (body[f] !== undefined) d[f] = NUMBERS.includes(f) && body[f] !== null && body[f] !== '' ? Number(body[f]) : body[f]; });
    return d;
  };
  const check = d => {
    const errors = {};
    REQUIRED.forEach(f => { if (d[f] === undefined || d[f] === null || d[f] === '') errors[f] = 'Required'; });
    if (Object.keys(errors).length) bad('Please correct the highlighted fields', errors);
  };
  route('GET', base, (req, p, q, ctx) => {
    need(ctx, PERM.view);
    let list = rows();
    if (q.query) list = list.filter(r => JSON.stringify(r).toLowerCase().includes(String(q.query).toLowerCase()));
    return listResult(list, q);
  });
  route('GET', base + '/:id', (req, p, q, ctx) => { need(ctx, PERM.view); rows(); return ok(store.get(coll, p.id) || notFound(entityType)); });
  route('POST', base, async (req, p, q, ctx) => {
    need(ctx, PERM.edit);
    const d = pick(await readBody(req)); check(d); rows();
    return ok(store.insert(coll, entityType, d, ctx));
  });
  route('PUT', base + '/:id', async (req, p, q, ctx) => {
    need(ctx, PERM.edit);
    rows(); const r = store.get(coll, p.id) || notFound(entityType);
    const d = pick(await readBody(req)); check(Object.assign({}, r, d));
    return ok(store.update(coll, entityType, r.id, d, ctx));
  });
  route('DELETE', base + '/:id', (req, p, q, ctx) => {
    need(ctx, PERM.remove);
    rows(); const r = store.get(coll, p.id) || notFound(entityType);
    store.remove(coll, entityType, r.id, ctx);
    return ok(null);
  });
})();
"@
    $serverText = Get-Content -Raw $server
    $marker = '// ---------- modules generated by UI Forge'
    $idx = $serverText.IndexOf($marker)
    if ($idx -lt 0) { $serverText = $serverText.TrimEnd() + "`n" + $js } else { $serverText = $serverText.Substring(0, $idx) + $js.TrimStart("`r", "`n") + "`n" + $serverText.Substring($idx) }
    $bak = "$server.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $server $bak
    [System.IO.File]::WriteAllText($server, ($serverText -replace "`r`n", "`n"), (New-Object System.Text.UTF8Encoding($false)))
    $node = Get-NodeExe
    & $node --check $server
    if ($LASTEXITCODE -ne 0) { Copy-Item $bak $server -Force; throw "The API code did not compile; server.js was restored from $bak." }
    Write-Ok "GET/POST $apiRoute, GET/PUT/DELETE $apiRoute/{id}: needs $Permission.view to read, $editPerm to save, $deletePerm to delete (backup: $bak)"
    if (Wait-Http 'http://127.0.0.1:5080/api/health' 1) {
        Write-Step 'Restarting the services so the API is live'
        $startArgs = @{ Workspace = $ws; NoBrowser = $true }
        if (Wait-Http 'http://127.0.0.1:8140/' 1) { $startArgs.WithBuilder = $true }   # UI Forge was running: keep it
        & (Join-Path $PSScriptRoot 'start-local.ps1') @startArgs | Out-Host
    } else {
        Write-Note 'Start the services (scripts\start-local.ps1) to use the new API.'
    }
}

# ---- 5. check and register -----------------------------------------------------------------------------
if (-not $NoRegister) {
    & (Join-Path $PSScriptRoot 'register-displays.ps1') -Workspace $ws -App $App
}
Write-Host ''
Write-Ok "Created. Sign out and in again in the app, then open $Menu -> $Title."
if ($CreateDemoApi) { Write-Host "    Its API $apiRoute is in the demo API; records start empty and are kept in gridtrade-contracts-extjs\server\data." }
else { Write-Host "    The screen needs the API /$apiPath (list, get, create, update, delete), checking $Permission.view, $editPerm and $deletePerm." }
Write-Host "    To change labels, widths or form fields: edit $file (the page reloads by itself)."
