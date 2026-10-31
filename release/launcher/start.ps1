# Serves the site folder next to this script to the browser on this computer only, so the app can run
# with no internet. It uses only what Windows already has. It makes no outside connection, writes no
# file and changes no setting. Stop it with Ctrl+C or by closing this window.
#
#   start.ps1 [--no-open] [--port N]
#
# Exit codes: 0 stopped, 2 no free port (or the one asked for is taken), 3 the site folder is missing.

$ErrorActionPreference = 'Stop'

$noOpen = $false
$wanted = 0
for ($i = 0; $i -lt $args.Count; $i++) {
    if ($args[$i] -eq '--no-open') { $noOpen = $true }
    elseif ($args[$i] -eq '--port' -and $i + 1 -lt $args.Count) { $wanted = [int]$args[$i + 1]; $i++ }
}

$root = Join-Path $PSScriptRoot 'site'
if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    Write-Host "The 'site' folder was not found next to this script. Unzip the whole release and run this again."
    exit 3
}
$rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'

$types = @{
    '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
    '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.wasm' = 'application/wasm'
    '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.woff' = 'font/woff'; '.woff2' = 'font/woff2'
    '.txt' = 'text/plain; charset=utf-8'; '.ico' = 'image/x-icon'
}

function Open-Listener([int]$port) {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://127.0.0.1:$port/")
    try { $l.Start(); return $l } catch { return $null }
}

$listener = $null
$port = 0
if ($wanted -gt 0) {
    $listener = Open-Listener $wanted
    $port = $wanted
} else {
    foreach ($p in 8731..8800) {
        $listener = Open-Listener $p
        if ($listener) { $port = $p; break }
    }
}
if (-not $listener) {
    Write-Host 'No free port was found (or the port asked for is in use). Close the other copy and run this again.'
    exit 2
}

function Send-Status($ctx, [int]$code, [string]$text) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $ctx.Response.StatusCode = $code
    $ctx.Response.ContentType = 'text/plain; charset=utf-8'
    $ctx.Response.Headers.Add('Cache-Control', 'no-store')
    $ctx.Response.ContentLength64 = $bytes.Length
    if ($ctx.Request.HttpMethod -ne 'HEAD') { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
    $ctx.Response.Close()
}

function Handle($ctx) {
    $req = $ctx.Request
    # Only this computer may be served, whatever name the request used.
    if (-not [System.Net.IPAddress]::IsLoopback($req.RemoteEndPoint.Address)) { Send-Status $ctx 403 'Forbidden'; return }
    if ($req.HttpMethod -ne 'GET' -and $req.HttpMethod -ne 'HEAD') { $ctx.Response.AddHeader('Allow', 'GET, HEAD'); Send-Status $ctx 405 'Method not allowed'; return }

    $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
    if ($path -eq '/') {
        $ctx.Response.StatusCode = 302
        $ctx.Response.Headers.Add('Location', '/APP-synthetic-data-generator/')
        $ctx.Response.Headers.Add('Cache-Control', 'no-store')
        $ctx.Response.Close()
        return
    }
    if ($path.Contains('\') -or $path.Contains([string][char]0) -or (($path -split '/') -contains '..')) { Send-Status $ctx 404 'Not found'; return }

    $relative = $path.TrimStart('/').Replace('/', '\')
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
    if (Test-Path -LiteralPath $full -PathType Container) { $full = Join-Path $full 'index.html' }
    if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Send-Status $ctx 404 'Not found'
        return
    }

    $bytes = [System.IO.File]::ReadAllBytes($full)
    $type = $types[[System.IO.Path]::GetExtension($full).ToLowerInvariant()]
    if (-not $type) { $type = 'application/octet-stream' }
    $ctx.Response.StatusCode = 200
    $ctx.Response.ContentType = $type
    $ctx.Response.Headers.Add('Cache-Control', 'no-store')
    $ctx.Response.Headers.Add('X-Content-Type-Options', 'nosniff')
    $ctx.Response.ContentLength64 = $bytes.Length
    if ($req.HttpMethod -ne 'HEAD') { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
    $ctx.Response.Close()
}

$url = "http://127.0.0.1:$port/APP-synthetic-data-generator/"
Write-Host "URL: $url"
Write-Host 'Serving this folder on this computer only. Nothing is sent anywhere.'
Write-Host 'Press Ctrl+C or close this window to stop.'
if (-not $noOpen) { Start-Process $url }

try {
    while ($listener.IsListening) {
        $task = $listener.GetContextAsync()
        # Waiting in short steps keeps Ctrl+C working.
        while (-not $task.AsyncWaitHandle.WaitOne(200)) { }
        try { Handle $task.Result } catch { try { $task.Result.Response.Abort() } catch { } }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
