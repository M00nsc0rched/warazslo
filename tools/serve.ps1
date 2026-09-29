# Egyszerű statikus fájlszerver a helyi fejlesztéshez (Node/Python nélkül).
# Használat: powershell -ExecutionPolicy Bypass -File tools/serve.ps1 [-Port 8123]
param([int]$Port = 8123)

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json'
  '.wasm' = 'application/wasm'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.txt' = 'text/plain; charset=utf-8'; '.ttf' = 'font/ttf'
  '.woff2' = 'font/woff2'; '.step' = 'application/octet-stream'; '.stl' = 'application/octet-stream'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Warázsló dev szerver: http://localhost:$Port/  (gyökér: $root)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request; $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
      if ($path.EndsWith('/')) { $path += 'index.html' }
      $file = Join-Path $root ($path.TrimStart('/').Replace('/', '\'))
      $full = [System.IO.Path]::GetFullPath($file)
      if (-not $full.StartsWith($root) -or -not (Test-Path $full -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes("404: $path")
      } else {
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-store')
        $bytes = [System.IO.File]::ReadAllBytes($full)
      }
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
      Write-Host "Hiba: $_"
    } finally {
      $res.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
}
