# Start the platform and both example agents on Windows (PowerShell). Close the windows to stop.
#   .\.venv\Scripts\Activate.ps1 ; .\scripts\dev.ps1
$root = Split-Path -Parent $PSScriptRoot
$py = (Get-Command python).Source

Start-Process -FilePath $py -ArgumentList "-m uvicorn platform_api.main:app --port 8000" -WorkingDirectory $root
for ($i = 0; $i -lt 30; $i++) {
    try { Invoke-RestMethod http://127.0.0.1:8000/ready | Out-Null; break } catch { Start-Sleep -Milliseconds 500 }
}
$env:AGENT_SERVICE_URL = "http://127.0.0.1:8101"
Start-Process -FilePath $py -ArgumentList "main.py" -WorkingDirectory "$root\examples\agents\inventory_agent"
$env:AGENT_SERVICE_URL = "http://127.0.0.1:8102"
Start-Process -FilePath $py -ArgumentList "main.py" -WorkingDirectory "$root\examples\agents\exposure_agent"
Remove-Item Env:\AGENT_SERVICE_URL
Write-Host "Platform: http://127.0.0.1:8000  (agents on :8101, :8102)"
