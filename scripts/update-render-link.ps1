param(
  [switch]$Publish
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path $projectRoot ".tmp\cloudflare-share.json"
$linkFile = Join-Path $projectRoot "link-site\link.json"

if (-not (Test-Path -LiteralPath $stateFile)) {
  throw "No active tunnel state was found. Run npm run share first."
}

$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$tunnelProcess = Get-Process -Id $state.tunnelPid -ErrorAction SilentlyContinue
if (-not $tunnelProcess -or $tunnelProcess.ProcessName -ne "cloudflared") {
  throw "The saved Cloudflare tunnel is not running. Run npm run share first."
}

$uri = [Uri]$state.url
if ($uri.Scheme -ne "https" -or -not $uri.Host.EndsWith(".trycloudflare.com")) {
  throw "The saved tunnel URL is not a valid Cloudflare HTTPS address."
}

$configuration = [ordered]@{
  url = $state.url
  updatedAt = (Get-Date).ToString("o")
  active = $true
}
$json = $configuration | ConvertTo-Json
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($linkFile, "$json`n", $utf8WithoutBom)

Write-Host "Render portal link updated:" -ForegroundColor Cyan
Write-Host $state.url -ForegroundColor Green

if (-not $Publish) {
  Write-Host "Publish it to Render with: npm run link:publish"
  exit 0
}

$git = (Get-Command "git.exe" -ErrorAction SilentlyContinue).Source
if (-not $git) {
  throw "Git was not found."
}

Push-Location $projectRoot
try {
  & $git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    throw "Other staged Git changes exist. Commit or unstage them before publishing the link."
  }

  & $git add -- "link-site/link.json"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not stage link-site/link.json."
  }

  & $git diff --cached --quiet -- "link-site/link.json"
  if ($LASTEXITCODE -eq 0) {
    Write-Host "The published link is already current." -ForegroundColor DarkGreen
    exit 0
  }

  & $git commit -m "Update ERP access link" -- "link-site/link.json"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not commit the updated link."
  }

  & $git push origin HEAD
  if ($LASTEXITCODE -ne 0) {
    throw "The link was committed locally, but Git push failed. Check your GitHub sign-in."
  }

  Write-Host "Link pushed. Render will deploy the update automatically." -ForegroundColor Green
} finally {
  Pop-Location
}
