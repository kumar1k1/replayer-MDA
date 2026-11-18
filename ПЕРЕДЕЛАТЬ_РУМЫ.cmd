@echo off
echo %date% %time% start %*>>"%~dp0run_log.txt"
rem окно не закрывается даже при ошибке; файл в кодировке cp866
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
setlocal
rem ============================================================================
rem  ПЕРЕДЕЛАТЬ_РУМЫ.cmd - исправленный перевод iPoker и WPN и пересчёт модели новых румов.
rem  Статы, кластеры и топы новых румов уже готовы - их не трогает.
rem  ПЕРЕД ЗАПУСКОМ закройте окно ДОБАВИТЬ_БЫСТРО, если оно открыто.
rem ============================================================================
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
set "OUT=%~dp0pipeline\out"
set "ROOMS=%~dp0новые_румы"
where node >nul 2>nul
if errorlevel 1 goto :nonode
echo Режим работы на всё время:
echo   Enter - ФОН: низкий приоритет, компьютером можно пользоваться
echo   м     - МАКСИМУМ: все силы, когда вы не за компьютером
set "MODE="
set /p "MODE=Режим: "
set "MODE_SET=1"
set "PRIO=low"
if /i "%MODE%"=="м" set "PRIO=max"
if /i "%MODE%"=="m" set "PRIO=max"

rem незаконченный расчёт модели на старом переводе - убрать, основная модель не тронута
if exist "%OUT%\потоки_план.json" del /q "%OUT%\потоки_план.json"
for /d %%D in ("%OUT%\shard_*") do rmdir /s /q "%%D"
if exist "%ROOMS%\ПЕРЕВОД3_ГОТОВ.flag" goto :add
if exist "%ROOMS%\ipoker" echo Удаляю старый перевод iPoker
if exist "%ROOMS%\ipoker" rmdir /s /q "%ROOMS%\ipoker"
if exist "%ROOMS%\wpn2" echo Удаляю старый перевод WPN
if exist "%ROOMS%\wpn2" rmdir /s /q "%ROOMS%\wpn2"
echo.
echo Перевод WPN и iPoker заново, одновременно - начало %date% %time%
node tools\convert_parallel.cjs "D:\маининг\WPN" "D:\маининг\Ipoker"
if errorlevel 1 goto :err
echo %date% %time% > "%ROOMS%\ПЕРЕВОД3_ГОТОВ.flag"
:add
echo.
echo Перевод готов. Пересчитываю модель новых румов
call "%~dp0ДОБАВИТЬ_БЫСТРО.cmd" run
goto :eof
:err
echo Остановилось с ошибкой. Запустите снова - продолжит с того же места. Напишите Claude: проверь.
goto :eof
:nonode
echo Не найден Node.js.
goto :eof
