@echo off
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
rem ОБЗОР_РУМОВ.cmd - что внутри архивов WPN и iPoker (без распаковки, меньше минуты)
cd /d "%~dp0"
node tools\scan_zips.cjs "D:\маининг\WPN" "D:\маининг\Ipoker"
echo.
echo Свободное место на диске D:
fsutil volume diskfree D: 2>nul || dir D:\ | find "свободно"
echo.
echo Напишите в чат "проверь".
