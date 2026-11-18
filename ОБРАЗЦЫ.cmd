@echo off
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
rem ОБРАЗЦЫ.cmd - достаёт по несколько файлов историй WPN и iPoker для проверки формата (1-3 минуты)
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
node --max-old-space-size=8192 tools\samples.cjs "D:\маининг\WPN" "D:\маининг\Ipoker"
echo.
echo Напишите в чат "проверь".
