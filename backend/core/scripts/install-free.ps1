$ErrorActionPreference = 'Stop'
$coreRoot = Split-Path -Parent $PSScriptRoot
$privateRoot = Join-Path $coreRoot '.local'
New-Item -ItemType Directory -Force -Path $privateRoot | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $privateRoot /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot protect local credentials directory' }
function Install-Archive([string]$Url, [string]$Folder, [string]$ExpectedHash, [string]$RequiredFile) {
  $destination = Join-Path $privateRoot $Folder
  if (Test-Path -LiteralPath (Join-Path $destination "runtime\$RequiredFile")) { return }
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  $archive = Join-Path $destination 'runtime.zip'
  & curl.exe --fail --location --silent --show-error $Url --output $archive
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $Folder" }
  if ($ExpectedHash -and (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne $ExpectedHash) { throw "Archive checksum mismatch: $Folder" }
  Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $destination 'runtime') -Force
  if (-not (Test-Path -LiteralPath (Join-Path $destination "runtime\$RequiredFile"))) { throw "Required runtime file missing: $Folder" }
}
Install-Archive 'https://get.enterprisedb.com/postgresql/postgresql-18.4-1-windows-x64-binaries.zip' 'postgresql' '' 'pgsql\bin\pg_dump.exe'
Install-Archive 'https://github.com/ollama/ollama/releases/download/v0.34.0/ollama-windows-amd64.zip' 'ollama' 'a7dd1b174f39d3d1b8a25d4cbc86045d0e190b17187bfdcbe2f2ee3b5a11470e' 'ollama.exe'
Push-Location $coreRoot
try {
  & npm.cmd run local:setup
  if ($LASTEXITCODE -ne 0) { throw 'Database setup failed' }
  $env:OLLAMA_HOST = '127.0.0.1:11434'
  $env:OLLAMA_MODELS = Join-Path $privateRoot 'ollama\models'
  $env:OLLAMA_NO_CLOUD = '1'
  $env:OLLAMA_CONTEXT_LENGTH = '2048'
  $ollama = Join-Path $privateRoot 'ollama\runtime\ollama.exe'
  $started = $null
  try { Invoke-RestMethod 'http://127.0.0.1:11434/api/version' -TimeoutSec 2 | Out-Null }
  catch {
    $started = Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $privateRoot 'ollama\server.out.log') -RedirectStandardError (Join-Path $privateRoot 'ollama\server.err.log')
    Start-Sleep -Seconds 2
  }
  try {
    & $ollama pull qwen3.5:0.8b
    if ($LASTEXITCODE -ne 0) { throw 'Local model download failed' }
    $configPath = Join-Path $privateRoot 'runtime.json'
    $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    $config.env | Add-Member -Force -NotePropertyName 'OLLAMA_URL' -NotePropertyValue 'http://127.0.0.1:11434'
    $config.env | Add-Member -Force -NotePropertyName 'OLLAMA_MODEL' -NotePropertyValue 'qwen3.5:0.8b'
    [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
  } finally { if ($started -and -not $started.HasExited) { Stop-Process -Id $started.Id } }
} finally { Pop-Location }
Write-Output 'Installed PostgreSQL and local AI. No cloud AI or paid service was enabled.'
