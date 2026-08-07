param(
  [ValidateSet("start", "status", "stop")]
  [string]$Action = "start"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$tempDirectory = Join-Path $projectRoot ".tmp"
$stateFile = Join-Path $tempDirectory "cloudflare-share.json"
$localUrl = "http://localhost:5050"

function Test-ErpServer {
  try {
    $health = Invoke-RestMethod -Uri "$localUrl/health" -TimeoutSec 3
    $homeResponse = Invoke-WebRequest -UseBasicParsing -Uri "$localUrl/" -TimeoutSec 3
    return $health.status -eq "ok" -and
      $health.service -eq "erp-financial-backend" -and
      $homeResponse.StatusCode -eq 200 -and
      $homeResponse.Content -match "ERP Financial Control"
  } catch {
    return $false
  }
}

function Test-PublicTunnel($shareUrl) {
  $paths = @("/health", "/", "/exchange-rates")

  try {
    foreach ($path in $paths) {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "$shareUrl$path" -TimeoutSec 10
      if ($response.StatusCode -ne 200) {
        return $false
      }
    }
    return $true
  } catch {
    # Some office DNS servers cache a Quick Tunnel NXDOMAIN briefly. Verify via 1.1.1.1 when that happens.
  }

  try {
    $uri = [Uri]$shareUrl
    $tunnelHost = $uri.DnsSafeHost
    $ipAddress = Resolve-DnsName $tunnelHost -Server "1.1.1.1" -Type A -ErrorAction Stop |
      Where-Object { $_.IPAddress } |
      Select-Object -First 1 -ExpandProperty IPAddress
    $curl = (Get-Command "curl.exe" -ErrorAction Stop).Source

    foreach ($path in $paths) {
      $statusCode = & $curl --silent --show-error --output NUL --write-out "%{http_code}" --resolve "${tunnelHost}:443:${ipAddress}" "$shareUrl$path"
      if ($LASTEXITCODE -ne 0 -or $statusCode -ne "200") {
        return $false
      }
    }
    return $true
  } catch {
    return $false
  }
}

function Get-CloudflaredPath {
  $command = Get-Command "cloudflared.exe" -ErrorAction SilentlyContinue
  $candidates = @(
    $(if ($command) { $command.Source }),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "cloudflared\cloudflared.exe" }),
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles "cloudflared\cloudflared.exe" }),
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\cloudflared.exe" })
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  return $candidates | Select-Object -First 1
}

function Read-TunnelState {
  if (-not (Test-Path -LiteralPath $stateFile)) {
    return $null
  }

  try {
    return Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-ManagedTunnelProcess($state) {
  if (-not $state -or -not $state.tunnelPid) {
    return $null
  }

  $process = Get-Process -Id $state.tunnelPid -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq "cloudflared") {
    return $process
  }

  return $null
}

function Stop-ManagedTunnel {
  $state = Read-TunnelState
  $process = Get-ManagedTunnelProcess $state

  if ($process) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit()
    Write-Host "Cloudflare sharing stopped." -ForegroundColor Yellow
  }

  if (Test-Path -LiteralPath $stateFile) {
    Remove-Item -LiteralPath $stateFile -Force
  }
}

function Show-ShareStatus {
  $state = Read-TunnelState
  $process = Get-ManagedTunnelProcess $state

  if (-not $process) {
    Write-Host "No active managed Cloudflare share link." -ForegroundColor Yellow
    Write-Host "Run: npm run share"
    return
  }

  Write-Host ""
  Write-Host "ACTIVE SHARE LINK" -ForegroundColor Cyan
  Write-Host $state.url -ForegroundColor Green
  Write-Host ""
  Write-Host "Local ERP server: $(if (Test-ErpServer) { 'running' } else { 'offline' })"
  Write-Host "Created: $($state.createdAt)"
  Write-Host "Stop sharing: npm run share:stop"
}

if ($Action -eq "status") {
  Show-ShareStatus
  exit 0
}

if ($Action -eq "stop") {
  Stop-ManagedTunnel
  exit 0
}

New-Item -ItemType Directory -Path $tempDirectory -Force | Out-Null
Stop-ManagedTunnel

$cloudflared = Get-CloudflaredPath
if (-not $cloudflared) {
  throw "cloudflared was not found. Install it with: winget install --id Cloudflare.cloudflared"
}

$npm = (Get-Command "npm.cmd" -ErrorAction SilentlyContinue).Source
if (-not $npm) {
  throw "npm was not found. Install Node.js and reopen PowerShell."
}

Write-Host "Building the production frontend..." -ForegroundColor Cyan
Push-Location $projectRoot
try {
  & $npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "The production build failed."
  }
} finally {
  Pop-Location
}

$serverProcess = $null
if (-not (Test-ErpServer)) {
  $node = (Get-Command "node.exe" -ErrorAction SilentlyContinue).Source
  if (-not $node) {
    throw "Node.js was not found."
  }

  Write-Host "Starting the local ERP production server..." -ForegroundColor Cyan
  $serverEntry = Join-Path $projectRoot "backend\public-server.js"
  $serverProcess = Start-Process -FilePath $node -ArgumentList @($serverEntry) -WorkingDirectory (Join-Path $projectRoot "backend") -WindowStyle Hidden -PassThru
  $serverDeadline = [DateTime]::UtcNow.AddSeconds(30)

  while (-not (Test-ErpServer) -and [DateTime]::UtcNow -lt $serverDeadline) {
    if ($serverProcess.HasExited) {
      throw "The ERP server stopped before it became ready. Confirm that MongoDB is running and backend/.env is valid."
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not (Test-ErpServer)) {
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    throw "The ERP server did not become ready. Confirm that MongoDB is running."
  }
} else {
  Write-Host "The local ERP production server is already running." -ForegroundColor DarkGreen
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tunnelLog = Join-Path $tempDirectory "cloudflared-$timestamp.log"
$tunnelArguments = @(
  "--no-autoupdate",
  "--logfile", $tunnelLog,
  "--loglevel", "info",
  "tunnel",
  "--url", $localUrl
)

Write-Host "Creating a new Cloudflare Quick Tunnel..." -ForegroundColor Cyan
$tunnelProcess = Start-Process -FilePath $cloudflared -ArgumentList $tunnelArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$tunnelDeadline = [DateTime]::UtcNow.AddSeconds(45)
$shareUrl = $null

while (-not $shareUrl -and [DateTime]::UtcNow -lt $tunnelDeadline) {
  if ($tunnelProcess.HasExited) {
    $details = if (Test-Path -LiteralPath $tunnelLog) { Get-Content -LiteralPath $tunnelLog -Tail 20 | Out-String } else { "No tunnel log was created." }
    throw "Cloudflare Tunnel stopped before creating a link.`n$details"
  }

  if (Test-Path -LiteralPath $tunnelLog) {
    $logText = Get-Content -LiteralPath $tunnelLog -Raw
    $match = [regex]::Match($logText, "https://[a-z0-9-]+\.trycloudflare\.com")
    if ($match.Success) {
      $shareUrl = $match.Value
      break
    }
  }

  Start-Sleep -Milliseconds 500
}

if (-not $shareUrl) {
  Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
  throw "Cloudflare did not create a share link within 45 seconds."
}

$state = [PSCustomObject]@{
  url = $shareUrl
  tunnelPid = $tunnelProcess.Id
  serverPid = if ($serverProcess) { $serverProcess.Id } else { $null }
  createdAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")
  logFile = $tunnelLog
}
$state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8

$portalLinkFile = Join-Path $projectRoot "link-site\link.json"
if (Test-Path -LiteralPath (Split-Path -Parent $portalLinkFile)) {
  $portalConfiguration = [ordered]@{
    url = $shareUrl
    updatedAt = (Get-Date).ToString("o")
    active = $true
  }
  $portalJson = $portalConfiguration | ConvertTo-Json
  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($portalLinkFile, "$portalJson`n", $utf8WithoutBom)
}

$publicReady = $false
for ($attempt = 1; $attempt -le 12; $attempt++) {
  if (Test-PublicTunnel $shareUrl) {
    $publicReady = $true
    break
  }
  Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor DarkCyan
Write-Host "NEW CLOUDFLARE SHARE LINK" -ForegroundColor Cyan
Write-Host $shareUrl -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor DarkCyan
Write-Host "Public check: $(if ($publicReady) { 'ready' } else { 'still starting - try the link in a few seconds' })"
Write-Host "Show this link again: npm run share:status"
Write-Host "Stop public sharing:  npm run share:stop"
Write-Host "Publish this link to Render: npm run link:publish"
Write-Host ""
Write-Host "For phones and other computers, share only the green HTTPS link above." -ForegroundColor Cyan
Write-Host "Do not share localhost, port 5050, or a 192.168.x.x address; those work only locally."
Write-Host "If a device reports DNS not found, try mobile data or Cloudflare DNS 1.1.1.1."
Write-Host ""
Write-Host "Keep this PC, MongoDB, and the ERP server running." -ForegroundColor Yellow
Write-Host "The login page is public. Share credentials only with authorized users." -ForegroundColor Yellow
