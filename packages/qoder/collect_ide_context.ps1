<#
.SYNOPSIS
  Writes the workspace facts a 通义灵码 (Lingma) private deployment's chat
  carries, so magpie's Lingma sign-in can send them as the IDE does.

.DESCRIPTION
  The IDE puts workspaceLanguages / activeFilePath / code_language in every
  chat it sends. A plugin cannot see the IDE's open editor, so this script
  reads what the IDE leaves on disk:

    - the workspace: -Workspace, else the last project JetBrains opened,
      else the newest folder holding a .idea directory
    - the active file: the open editors in <workspace>\.idea\workspace.xml
    - the languages: the file types the workspace actually holds

  It writes <cosyHome>\magpie-context.json (COSY_HOME, else
  %USERPROFILE%\.lingma), where the plugin reads it. Nothing is sent
  anywhere.

  The IDE's system prompt is served to its worker, not stored in the
  binary, so it cannot be collected here: pass -SystemPromptFile to put
  one you captured into the same file.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File collect_ide_context.ps1

.EXAMPLE
  .\collect_ide_context.ps1 -Workspace D:\work\project -OutFile D:\tmp\ctx.json
#>
[CmdletBinding()]
param(
  [string]$Workspace = "",
  [string]$OutFile = "",
  [string]$SystemPromptFile = "",
  [string]$FromCapture = "",
  [string]$IdeName = "",
  [string]$IdeVersion = ""
)

$ErrorActionPreference = "Stop"

# extension -> the IDE's own language name (as its chats name them)
$LangOf = @{
  ".sh" = "shell"; ".bash" = "shell"; ".zsh" = "shell"; ".ksh" = "shell"
  ".ps1" = "PowerShell"; ".psm1" = "PowerShell"; ".bat" = "Batch"; ".cmd" = "Batch"
  ".py" = "Python"; ".pyw" = "Python"; ".ipynb" = "Jupyter Notebook"
  ".java" = "Java"; ".kt" = "Kotlin"; ".kts" = "Kotlin"; ".scala" = "Scala"; ".groovy" = "Groovy"
  ".js" = "JavaScript"; ".jsx" = "JavaScript"; ".mjs" = "JavaScript"; ".cjs" = "JavaScript"
  ".ts" = "TypeScript"; ".tsx" = "TypeScript"
  ".vue" = "Vue"; ".svelte" = "Svelte"
  ".go" = "Go"; ".rs" = "Rust"; ".rb" = "Ruby"; ".php" = "PHP"; ".pl" = "Perl"; ".lua" = "Lua"; ".r" = "R"
  ".c" = "C"; ".h" = "C"; ".cpp" = "C++"; ".cc" = "C++"; ".cxx" = "C++"; ".hpp" = "C++"
  ".cs" = "C#"; ".fs" = "F#"; ".swift" = "Swift"; ".m" = "Objective-C"; ".mm" = "Objective-C"
  ".sql" = "SQL"; ".md" = "Markdown"; ".markdown" = "Markdown"; ".rst" = "reStructuredText"
  ".json" = "JSON"; ".jsonc" = "JSON"; ".xml" = "XML"; ".yml" = "YAML"; ".yaml" = "YAML"
  ".toml" = "TOML"; ".ini" = "INI"; ".properties" = "Properties"
  ".html" = "HTML"; ".htm" = "HTML"; ".css" = "CSS"; ".scss" = "SCSS"; ".sass" = "Sass"; ".less" = "Less"
  ".proto" = "Protocol Buffer"; ".graphql" = "GraphQL"; ".tf" = "Terraform"; ".dockerfile" = "Dockerfile"
  ".txt" = "Text"; ".csv" = "CSV"; ".conf" = "Config"; ".cfg" = "Config"; ".env" = "DotEnv"
}
$SkipDirs = @(".git", ".idea", ".svn", ".hg", "node_modules", "target", "build", "dist", "out",
  "bin", "obj", "venv", ".venv", "__pycache__", ".gradle", ".mvn", "vendor", ".next", ".cache", "logs")

function Find-Workspace {
  param([string]$Given)
  if ($Given) {
    if (Test-Path -LiteralPath $Given) { return (Resolve-Path -LiteralPath $Given).Path }
    throw "the workspace '$Given' does not exist"
  }
  # JetBrains' own record of the last project it opened, newest product first
  $opts = Join-Path $env:APPDATA "JetBrains"
  if (Test-Path -LiteralPath $opts) {
    $files = Get-ChildItem -LiteralPath $opts -Directory |
      ForEach-Object { Join-Path $_.FullName "options\recentProjects.xml" } |
      Where-Object { Test-Path -LiteralPath $_ } |
      Sort-Object { (Get-Item -LiteralPath $_).LastWriteTime } -Descending
    foreach ($f in $files) {
      try {
        [xml]$x = Get-Content -LiteralPath $f -Raw
        $loc = $x.SelectSingleNode("//option[@name='lastProjectLocation']")
        if ($loc -and $loc.value) {
          $p = $loc.value -replace '^\$USER_HOME\$', $env:USERPROFILE
          if (Test-Path -LiteralPath $p) { return (Resolve-Path -LiteralPath $p).Path }
        }
        foreach ($e in $x.SelectNodes("//entry[@key]")) {
          $p = $e.key -replace '^\$USER_HOME\$', $env:USERPROFILE
          if (Test-Path -LiteralPath $p) { return (Resolve-Path -LiteralPath $p).Path }
        }
      } catch { }
    }
  }
  # nothing recorded: the newest folder that holds a .idea directory
  $dirs = Get-ChildItem -LiteralPath $env:USERPROFILE -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch '^(AppData|\.)' } |
    ForEach-Object { $idea = Join-Path $_.FullName ".idea"; if (Test-Path -LiteralPath $idea) { $_.FullName } } |
    Sort-Object { (Get-Item -LiteralPath $_).LastWriteTime } -Descending
  if ($dirs) { return $dirs[0] }
  return ""
}

function Get-ActiveFile {
  param([string]$Root)
  $ws = Join-Path $Root ".idea\workspace.xml"
  if (-not (Test-Path -LiteralPath $ws)) { return "" }
  try {
    [xml]$x = Get-Content -LiteralPath $ws -Raw
    foreach ($node in $x.SelectNodes("//component[@name='FileEditorManager']//entry[@file]")) {
      $p = $node.file -replace '^file://\$PROJECT_DIR\$', $Root -replace '^file:///', '' -replace '/', '\'
      if (Test-Path -LiteralPath $p) { return $p }
    }
    foreach ($node in $x.SelectNodes("//entry[@file]")) {
      $p = $node.file -replace '^file://\$PROJECT_DIR\$', $Root -replace '^file:///', '' -replace '/', '\'
      if (Test-Path -LiteralPath $p) { return $p }
    }
  } catch { }
  return ""
}

function Get-Languages {
  param([string]$Root)
  $seen = @{}
  $count = 0
  $stack = New-Object System.Collections.Stack
  $stack.Push($Root)
  while ($stack.Count -gt 0 -and $count -lt 4000) {
    $dir = $stack.Pop()
    try { $items = Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop } catch { continue }
    foreach ($it in $items) {
      if ($it.PSIsContainer) {
        if ($SkipDirs -notcontains $it.Name) { $stack.Push($it.FullName) }
        continue
      }
      $count++
      $ext = $it.Extension.ToLowerInvariant()
      if ($LangOf.ContainsKey($ext)) { $seen[$LangOf[$ext]] = $true }
      if ($count -ge 4000) { break }
    }
  }
  return @($seen.Keys | Sort-Object)
}

# ---- the facts <user_info> names -------------------------------------------

function Get-IdeConfigDir {
  $opts = Join-Path $env:APPDATA "JetBrains"
  if (-not (Test-Path -LiteralPath $opts)) { return "" }
  $d = Get-ChildItem -LiteralPath $opts -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($d) { return $d.Name }
  return ""
}

function Get-OsLabel {
  try {
    $k = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
    $v = $k.DisplayVersion
    if (-not $v) { $v = $k.ReleaseId }
    if ($v) { return "windows $v" }
  } catch { }
  return "windows"
}

function Get-IdeLabel {
  param([string]$Name, [string]$Version, [string]$ConfigDir)
  $n = $Name
  $v = $Version
  if (-not $n -and $ConfigDir) {
    if ($ConfigDir -match '^(.*?)(\d{4}\.\d+)$') { $n = "$($Matches[1]) $($Matches[2])".Trim() } else { $n = $ConfigDir }
    # JetBrains' folder names are not its product names
    $names = @{ "IntelliJIdea" = "IntelliJ IDEA"; "IdeaIC" = "IntelliJ IDEA Community"; "IdeaIU" = "IntelliJ IDEA Ultimate"; "PhpStorm" = "PhpStorm"; "GoLand" = "GoLand"; "DataGrip" = "DataGrip"; "RubyMine" = "RubyMine"; "WebStorm" = "WebStorm"; "CLion" = "CLion"; "Rider" = "Rider"; "AppCode" = "AppCode"; "AndroidStudio" = "Android Studio" }
    foreach ($k in $names.Keys) {
      if ($n -match ('^' + [regex]::Escape($k) + '(\s.*)?$')) { $n = $names[$k] + $Matches[1]; break }
    }
  }
  if (-not $v -and $ConfigDir -and ($ConfigDir -match '(\d{4}\.\d+(?:\.\d+)?)')) { $v = $Matches[1] }
  if ($n -and $v -and -not $n.EndsWith($v)) { return "$n $v" }
  if ($n) { return $n }
  return "JetBrains IDE"
}

# The IDE's own body codec, so an Encode=1 capture reads as it was written:
# its alphabet, and the encoded string's three thirds reversed.
$CosyAlphabet = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!"

function Decode-CosyBody {
  param([string]$Wire)
  $w = $Wire.Trim()
  $e = $w.Length
  $b = [math]::Floor($e / 3)
  $s = $w.Substring($e - $b) + $w.Substring($b, $e - 2 * $b) + $w.Substring(0, $b)
  $bits = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) {
    if ($ch -eq '=' -or $ch -eq '$') { break }
    $i = $CosyAlphabet.IndexOf($ch)
    if ($i -lt 0) { throw "not a COSY-encoded body (unexpected '$ch')" }
    [void]$bits.Append([Convert]::ToString($i, 2).PadLeft(6, '0'))
  }
  $str = $bits.ToString()
  $out = New-Object System.Collections.Generic.List[byte]
  for ($i = 0; $i + 8 -le $str.Length; $i += 8) { $out.Add([Convert]::ToByte($str.Substring($i, 8), 2)) }
  return [System.Text.Encoding]::UTF8.GetString($out.ToArray())
}

function Read-CapturePrompt {
  param([string]$Path)
  $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8).Trim()
  $obj = $null
  try { $obj = $raw | ConvertFrom-Json } catch { }
  if (-not $obj) { $obj = (Decode-CosyBody -Wire $raw) | ConvertFrom-Json }
  foreach ($m in @($obj.messages)) {
    if ($m.role -eq "system" -and $m.content -is [string] -and $m.content.Trim()) { return $m.content }
  }
  if ($obj.system_role_content) { return [string]$obj.system_role_content }
  return ""
}

# The prompt's own <user_info> block, rewritten with this machine's facts in
# the shape the IDE interpolates.
function Set-UserInfo {
  param([string]$Prompt, [string]$Os, [string]$Ide, [string]$Root, [string[]]$Languages)
  $langs = if ($Languages.Count) { ($Languages -join ', ') } else { "unknown" }
  $block = "<user_info>`n" +
           "The user's OS version is $Os.  The user's IDE is $Ide.`n" +
           "The absolute path of the user's workspace is: $Root`n" +
           "The types of programming languages included in the user's workspace are as follows: $langs, etc.`n" +
           "Please use this information as a reference but do not disclose it.`n" +
           "</user_info>"
  $i = $Prompt.IndexOf("<user_info>")
  $j = $Prompt.IndexOf("</user_info>")
  if ($i -ge 0 -and $j -gt $i) { return $Prompt.Substring(0, $i) + $block + $Prompt.Substring($j + 11) }
  return $block + "`n`n" + $Prompt
}

$root = Find-Workspace -Given $Workspace
if (-not $root) {
  Write-Error "no workspace found; run me from the project, or pass -Workspace <path>"
  exit 1
}

$configDir = Get-IdeConfigDir
$osLabel = Get-OsLabel
$ideLabel = Get-IdeLabel -Name $IdeName -Version $IdeVersion -ConfigDir $configDir

$active = Get-ActiveFile -Root $root
$languages = Get-Languages -Root $root
$codeLanguage = ""
if ($active) {
  $ext = [System.IO.Path]::GetExtension($active).ToLowerInvariant()
  if ($LangOf.ContainsKey($ext)) { $codeLanguage = $LangOf[$ext] }
}

$ctx = [ordered]@{
  workspace          = $root
  workspaceLanguages = $languages
  activeFilePath     = $active
  codeLanguage       = $codeLanguage
  os                 = $osLabel
  ide                = $ideLabel
  collectedAt        = (Get-Date).ToString("o")
}
if ($FromCapture) {
  if (-not (Test-Path -LiteralPath $FromCapture)) { Write-Error "no such file: $FromCapture"; exit 1 }
  $prompt = Read-CapturePrompt -Path $FromCapture
  if (-not $prompt) { Write-Error "no system prompt in $FromCapture"; exit 1 }
  # the captured prompt, with its <user_info> rewritten for this machine
  $ctx.systemPrompt = Set-UserInfo -Prompt $prompt -Os $osLabel -Ide $ideLabel -Root $root -Languages $languages
} elseif ($SystemPromptFile) {
  if (-not (Test-Path -LiteralPath $SystemPromptFile)) { Write-Error "no such file: $SystemPromptFile"; exit 1 }
  $ctx.systemPrompt = Get-Content -LiteralPath $SystemPromptFile -Raw
}

if (-not $OutFile) {
  $home_ = if ($env:COSY_HOME) { $env:COSY_HOME } else { Join-Path $env:USERPROFILE ".lingma" }
  $OutFile = Join-Path $home_ "magpie-context.json"
}
$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$json = $ctx | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "workspace : $root"
Write-Host "active    : $(if ($active) { $active } else { '(none open)' })"
Write-Host "languages : $($languages -join ', ')"
Write-Host "code lang : $(if ($codeLanguage) { $codeLanguage } else { '(unknown)' })"
Write-Host "os / ide  : $osLabel / $ideLabel"
if ($ctx.systemPrompt) { Write-Host "prompt    : $($ctx.systemPrompt.Length) chars" }
Write-Host "written   : $OutFile"
