# run-record-export.ps1 — scheduled wrapper for tools/export-records.mjs
#
# WHY THIS EXISTS (2026-08-02)
# export-records.mjs was written on 2026-07-26 to solve a real problem: the customer record — who
# agreed to what, when, what they paid for — lives ONLY in a free-tier Supabase with no
# owner-controlled copy. It was written correctly, hash-verifies its own writes, and was documented
# in OPEN-LOOPS.
#
# It had never been run. Not once, in seven days. E:\UND-Records did not exist.
#
# The reason is dull and worth recording: the tool takes its credential from the ENVIRONMENT ONLY
# (deliberately — so the key is never coupled to a dev file), and nothing in the environment
# supplied it. There was no scheduled task, no persisted variable and no vault entry. A correct
# tool with no way to be invoked is indistinguishable from no tool at all, and it sat behind a
# "solved" checkbox the whole time.
#
# CREDENTIAL RESOLUTION mirrors the chain already used across this ecosystem (see
# E:\UND-Nexus\tests\qa.js loadVault): the sealed vault first, the local dev file as a legacy
# fallback. That means this works TODAY without anyone touching a secret, and upgrades itself the
# moment E:\UND-Keys\website.env exists. The key is passed to the child process in memory and is
# never logged, echoed or written anywhere.
#
# INVOCATION (hidden — nothing appears on screen):
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File <this file>

$ErrorActionPreference = 'Stop'
$REPO    = 'E:\und-industries-website'
$LOG     = 'E:\UND-Records\export-run.log'
$STATUS  = 'E:\UND-Records\_export-status.json'

function Write-Log($msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
  try {
    $dir = Split-Path $LOG -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Add-Content -Path $LOG -Value $line -Encoding utf8
  } catch { }
}

# Pull KEY=VALUE out of a file without ever emitting the value.
function Get-KeyFromFile($path, $name) {
  if (-not (Test-Path $path)) { return $null }
  try {
    foreach ($line in [IO.File]::ReadAllLines($path, [Text.Encoding]::UTF8)) {
      if ($line -match "^\s*$name\s*=\s*(.+?)\s*$") {
        return $Matches[1].Trim().Trim('"').Trim("'")
      }
    }
  } catch { }
  return $null
}

$KEYNAME = 'SUPABASE_SERVICE_ROLE_KEY'
$key = $env:SUPABASE_SERVICE_ROLE_KEY
$src = 'inherited environment'
if (-not $key) { $key = Get-KeyFromFile 'E:\UND-Keys\website.env' $KEYNAME; if ($key) { $src = 'vault (E:\UND-Keys\website.env)' } }
if (-not $key) { $key = Get-KeyFromFile (Join-Path $REPO '.dev.vars') $KEYNAME; if ($key) { $src = 'legacy .dev.vars' } }

if (-not $key) {
  # A missing credential must be LOUD. Silently exporting nothing is the exact failure this whole
  # tool exists to prevent, and it would look identical to success in the task scheduler.
  Write-Log "FAILED - $KEYNAME not found in environment, E:\UND-Keys\website.env, or .dev.vars. NOTHING WAS EXPORTED."
  try {
    @{ ts = (Get-Date).ToString('o'); ok = $false; reason = 'credential not found'; rows = 0 } |
      ConvertTo-Json | Set-Content -Path $STATUS -Encoding utf8
  } catch { }
  exit 1
}

Write-Log "starting record export (credential from $src)"

$env:SUPABASE_SERVICE_ROLE_KEY = $key
Push-Location $REPO
try {
  $out = & node 'tools\export-records.mjs' 2>&1
  $code = $LASTEXITCODE
} finally {
  Pop-Location
  # Do not leave the key sitting in this process's environment any longer than the run needs it.
  Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
}

$summary = ($out | Where-Object { $_ -match 'EXPORT (OK|FAILED|INCOMPLETE)' } | Select-Object -Last 1)
if (-not $summary) { $summary = ($out | Select-Object -Last 1) }
$rows = 0
if ($summary -match 'EXPORT OK - (\d+) rows') { $rows = [int]$Matches[1] }

Write-Log "exit=$code  $summary"
try {
  @{ ts = (Get-Date).ToString('o'); ok = ($code -eq 0); exitCode = $code; rows = $rows; summary = "$summary" } |
    ConvertTo-Json | Set-Content -Path $STATUS -Encoding utf8
} catch { }

exit $code
