# Kiadás: service worker verzió léptetése, commit, push (GitHub Pages automatikusan frissül)
# Használat: powershell -ExecutionPolicy Bypass -File tools/deploy.ps1 "Üzenet"
param([string]$Message = "Frissítés")

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
$sw = Join-Path $root 'sw.js'
$ver = 'v' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$content = [System.IO.File]::ReadAllText($sw)
$content = [regex]::Replace($content, "const VERSION = '[^']*';", "const VERSION = '$ver';")
[System.IO.File]::WriteAllText($sw, $content, (New-Object System.Text.UTF8Encoding($false)))
git add -A
git commit -m "$Message" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
Write-Host "Kiadva: $ver"
