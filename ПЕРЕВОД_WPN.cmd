@echo off
echo %date% %time% start %*>>"%~dp0run_log.txt"
rem окно не закрывается даже при ошибке; файл в кодировке cp866
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
setlocal
rem ============================================================================
rem  ПЕРЕВОД_WPN.cmd - повторный перевод WPN исправленным переводчиком:
rem  бай-ин и формат турнира берутся из папок архива, раздачи с collected в итогах больше не теряются.
rem  Старый перевод WPN удаляется, новый пишется в новые_румы\wpn2, затем сам продолжает ДОБАВИТЬ_РУМЫ.cmd.
rem  ПЕРЕД ЗАПУСКОМ закройте окно ДОБАВИТЬ_РУМЫ, если оно открыто.
rem ============================================================================
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
if "%MEM%"=="" set "MEM=12288"
set "ROOMS=%~dp0новые_румы"
where node >nul 2>nul
if errorlevel 1 goto :nonode
if exist "%ROOMS%\wpn2_готово.flag" goto :add
if exist "%ROOMS%\wpn" echo Удаляю старый перевод WPN
if exist "%ROOMS%\wpn" rmdir /s /q "%ROOMS%\wpn"
echo Перевод WPN заново - начало %date% %time%
set "CONV_TAG=wpn2"
node --max-old-space-size=%MEM% tools\convert_rooms.cjs "D:\маининг\WPN"
if errorlevel 1 goto :err
echo %date% %time% > "%ROOMS%\wpn2_готово.flag"
:add
echo.
echo Перевод WPN готов. Продолжаю добавление румов в модель
set "CONV_TAG="
call "%~dp0ДОБАВИТЬ_РУМЫ.cmd" run
goto :eof
:err
echo Остановилось с ошибкой. Запустите снова - продолжит со следующего архива. Напишите Claude: проверь.
goto :eof
:nonode
echo Не найден Node.js.
goto :eof
