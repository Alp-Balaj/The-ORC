# Windows: create "The ORC" shortcuts on the Desktop and in the Start menu.
# Run:  powershell -ExecutionPolicy Bypass -File scripts\install-shortcut.ps1
# Safe to re-run; it rewrites the shortcuts with this checkout's path.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcher = Join-Path $repo 'scripts\orc-launch.vbs'
$icon = Join-Path $repo 'build\icon.ico'

$bash = @($env:ORC_GIT_BASH, "$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe",
  "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $bash) { throw 'Git Bash not found. Install Git for Windows, or set ORC_GIT_BASH to its bash.exe.' }
Write-Host "Git Bash: $bash"

$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'The ORC.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'The ORC.lnk'))
$shell = New-Object -ComObject WScript.Shell
foreach ($t in $targets) {
  $lnk = $shell.CreateShortcut($t)
  $lnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $lnk.Arguments = "`"$launcher`""
  $lnk.WorkingDirectory = $repo
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = 'The ORC'
  $lnk.WindowStyle = 7
  $lnk.Save()
  Write-Host "Created $t"
}
Write-Host "Launch output goes to $env:USERPROFILE\.local\state\the-orc\launch.log"
