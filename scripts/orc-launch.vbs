' Windows: starts The ORC through Git Bash with no console window (the Start menu / Desktop
' shortcut points here). Output goes to %USERPROFILE%\.local\state\the-orc\launch.log via orc-launch.sh.
Option Explicit
Dim sh, fso, repo, env, cands, c, bash
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
repo = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set env = sh.Environment("Process")

bash = ""
cands = Array( _
  env("ORC_GIT_BASH"), _
  env("ProgramFiles") & "\Git\bin\bash.exe", _
  env("ProgramFiles(x86)") & "\Git\bin\bash.exe", _
  env("LocalAppData") & "\Programs\Git\bin\bash.exe")
For Each c In cands
  If c <> "" And bash = "" Then
    If fso.FileExists(c) Then bash = c
  End If
Next
If bash = "" Then
  MsgBox "Git Bash was not found. Install Git for Windows, or set ORC_GIT_BASH to its bash.exe.", 16, "The ORC"
  WScript.Quit 1
End If

env("CHERE_INVOKING") = "1" ' keep the login shell in the repo instead of $HOME
sh.CurrentDirectory = repo
sh.Run """" & bash & """ -lc ""./scripts/orc-launch.sh""", 0, False
