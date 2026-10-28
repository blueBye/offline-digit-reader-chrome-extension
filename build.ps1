$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Write-Host 'Installing pinned dependencies ...'
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
Write-Host 'Checking offline model assets ...'
npm run check:models
if ($LASTEXITCODE -ne 0) { throw 'Model archives missing/incompatible. Read README.md.' }
Write-Host 'Building Chrome extension ...'
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
Write-Host 'Success. In chrome://extensions use Load unpacked -> dist/'
