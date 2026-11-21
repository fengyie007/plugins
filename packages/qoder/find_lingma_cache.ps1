<#
.SYNOPSIS
  Finds where the Lingma (通义灵码) IDE plugin keeps its cache on this machine.

.DESCRIPTION
  The plugin (and magpie's qoder package) reads <cosyHome>\cache\user, whose
  AES key is <cosyHome>\cache\id's first 16 characters — or, when the IDE
  never wrote one, a machine id derived from the volume serial and a MAC.
  This looks for those folders instead of guessing, because COSY_HOME differs
  per install: the IDE plugin passes it to its worker, and a process started
  outside the IDE does not inherit it.

  Every candidate it prints can be handed to magpie as COSY_HOME.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File find_lingma_cache.ps1
#>
[CmdletBinding()]
param(
  [string]$Under = "",
  [int]$Depth = 6
)

$ErrorActionPreference = "SilentlyContinue"

$roots = if ($Under) { @($Under) } else {
  @($env:USERPROFILE, $env:APPDATA, $env:LOCALAPPDATA, $env:PROGRAMDATA) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
}

Write-Host "COSY_HOME in this shell : $(if ($env:COSY_HOME) { $env:COSY_HOME } else { '(unset)' })"
Write-Host "searching               : $($roots -join '; ')"
Write-Host ""

$found = @()
foreach ($r in $roots) {
  Get-ChildItem -LiteralPath $r -Recurse -Force -Filter user -Depth $Depth |
    Where-Object { $_.Name -eq "user" -and $_.Directory.Name -eq "cache" } |
    ForEach-Object {
      $cache = $_.Directory.FullName
      $home_ = Split-Path -Parent $cache
      $id = Join-Path $cache "id"
      $found += [pscustomobject]@{
        cosyHome  = $home_
        cacheUser = $_.FullName
        bytes     = $_.Length
        written   = $_.LastWriteTime.ToString("s")
        cacheId   = if (Test-Path -LiteralPath $id) { "yes ($(([System.IO.File]::ReadAllText($id, [System.Text.Encoding]::UTF8)).Trim()))" } else { "no" }
        version   = if (Test-Path -LiteralPath (Join-Path $home_ "config.json")) { "config.json" } else { "" }
      }
    }
}

$found = $found | Sort-Object cosyHome -Unique
if (-not $found) {
  Write-Host "no <...>\cache\user found under those roots." -ForegroundColor Yellow
  Write-Host "Next: find the worker's own folder (it sits beside Lingma.exe):"
  Write-Host "  Get-ChildItem -Path `$env:USERPROFILE,`$env:APPDATA,`$env:LOCALAPPDATA -Recurse -Force -Filter Lingma.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty DirectoryName -Unique"
  exit 1
}

$found | Format-Table -AutoSize

Write-Host ""
Write-Host "The one magpie should use (its parent is the cosy home):"
foreach ($f in $found) {
  $v = $f.bytes / 1kb
  Write-Host ("  {0}  ({1:N1} KB, written {2}, cache/id: {3})" -f $f.cosyHome, $v, $f.written, $(if ($f.cacheId -like "yes*") { "yes" } else { "NO — derived from the machine" }))
}
Write-Host ""
Write-Host "To have magpie read it, set it for the magpie process:"
Write-Host ('  [Environment]::SetEnvironmentVariable("COSY_HOME", "' + $found[0].cosyHome + '", "User")')
Write-Host "then fully quit and reopen magpie (a new process is what reads it)."
