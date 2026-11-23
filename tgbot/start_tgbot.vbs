' TG-bot: start local server without console window and open the app window (Edge, app mode).
' Voice input uses Edge speech recognition. Own Edge profile in tgbot\data\edge (mic permission is remembered).
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
d = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = d
sh.Run "cmd /c node server.cjs", 0, False
WScript.Sleep 1500
sh.Run "msedge --app=http://127.0.0.1:8790/ --window-size=1120,880 --no-first-run --no-default-browser-check --user-data-dir=""" & d & "\data\edge""", 1, False
