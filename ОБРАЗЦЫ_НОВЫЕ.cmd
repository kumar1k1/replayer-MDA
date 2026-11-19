@echo off
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
rem ОБРАЗЦЫ_НОВЫЕ.cmd - опись архивов из D:\маининг\new и по несколько кусочков историй
rem из каждого, для проверки формата. Ничего не распаковывает целиком, 2-10 минут.
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
where node >nul 2>nul
if errorlevel 1 goto :nonode
node --max-old-space-size=8192 tools\samples_new.cjs "D:\маининг\new"
if errorlevel 1 goto :err
echo.
echo Готово. Напишите Claude: проверь.
goto :eof
:err
echo.
echo Остановилось с ошибкой. Напишите Claude: проверь.
goto :eof
:nonode
echo Не найден Node.js.
goto :eof
