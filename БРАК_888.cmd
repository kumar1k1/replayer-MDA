@echo off
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
rem БРАК_888.cmd - почему не переводятся раздачи 888, 1-3 минуты. Ничего в базу не пишет.
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
node --max-old-space-size=6144 tools\fails_888.cjs "D:\маининг\new" 2512
echo.
echo Готово. Напишите Claude: проверь.
