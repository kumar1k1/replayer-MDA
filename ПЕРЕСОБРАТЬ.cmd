@echo off
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
setlocal
rem ПЕРЕСОБРАТЬ.cmd - пересобрать реплеер app\dist из уже посчитанной модели (без прогона базы), 3-10 минут.
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
echo Пересобираю реплеер из pipeline\out\model_v8.ndjson ...
node --max-old-space-size=12288 app\build.cjs
echo.
echo Готово. Откройте app\dist\index.html (если уже открыт - обновите страницу F5).
