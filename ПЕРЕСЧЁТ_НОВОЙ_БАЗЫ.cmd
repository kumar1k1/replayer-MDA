@echo off
rem файл в кодировке cp866; окно не закрывается после ошибки
if "%~1"=="run" goto :main
cmd /k ""%~f0" run %~1"
exit /b
:main
setlocal
echo %date% %time% start %*>>"%~dp0run_log.txt"
rem ============================================================================
rem  ПЕРЕСЧЁТ_НОВОЙ_БАЗЫ.cmd - после ЗАГРУЗКА_НОВОЙ_БАЗЫ.cmd и согласования порогов топов:
rem   [1] отбор топов по четвертям базы: топ-1 и топ-2, пороги - ниже
rem   [2] модель по всей базе - по ядрам
rem   [3] размеры рейзов по всей базе - по ядрам
rem   [4] сборка реплеера - копия прежнего реплеера сохраняется
rem   [5] отчёт: как изменилась игра 2025 против 2026
rem  Всё считается в pipeline\out2. Можно выключать компьютер - после включения
rem  и входа в Windows пересчёт сам продолжится с того же места.
rem ============================================================================
rem ---- пороги топов - согласованы с владельцем ----
set "MIN_HANDS_TOP=10000"
set "TOP1_BB100=8"
set "TOP2_BB100=5"
rem класс игрока - только у чётко подходящих своему кластеру: 1 - да, пусто - у всех
set "TIGHT_ONLY="
rem ---------------------------------------------------
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
set "OUT2=%~dp0pipeline\out2"
set "ROOMS=%~dp0новые_румы"
set "ROOMS2=%~dp0новые_румы2"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCH=%STARTUP%\РЕПЛЕЕР_ПЕРЕСЧЁТ.cmd"
where node >nul 2>nul
if errorlevel 1 goto :nonode
if not exist "%OUT2%\winq.json" goto :noload
set "RAMGB=16"
for /f %%M in ('powershell -NoProfile -Command "[math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB)"') do set "RAMGB=%%M"
rem модель: поток до 5 ГБ, слияние - почти вся память; размеры: поток до 4 ГБ
set /a NV=(%RAMGB%-8)/5
set /a NZ=(%RAMGB%-6)/4
set /a MM=(%RAMGB%-6)*1024
if %NV% GTR 8 set "NV=8"
if %NV% LSS 2 set "NV=2"
if %NZ% GTR 12 set "NZ=12"
if %NZ% LSS 2 set "NZ=2"
echo Памяти %RAMGB% ГБ: модель - %NV% потоков, размеры - %NZ% потоков, слияние - %MM% МБ
echo Топы: от %MIN_HANDS_TOP% рук, топ-1 от %TOP1_BB100% bb/100, топ-2 от %TOP2_BB100% bb/100
> "%LAUNCH%" echo @start "" "%~f0" auto
set "RAW_DIRS=%BACKING_DIR%/raw;%BACKING_DIR%/raw-ps;%ROOMS%;%ROOMS2%"
set "PLAYERS_CL=%OUT2%\players_cl_all.json"
set "TOPS=%OUT2%\tops_all.json"
set "TOURN=%OUT2%\tourn_all.json"
set "ROOM_LAYER=wpn,ipoker,chico,888,pses"
if "%TIGHT_ONLY%"=="1" set "TIGHT_FILE=%OUT2%\players_tight.json"
set "PRIO=max"

if exist "%OUT2%\topsdone.flag" goto :s2
echo.
echo [1] Отбор топов - %date% %time%
set "OUT_DIR=%OUT2%"
node --max-old-space-size=8192 pipeline\tops_q.cjs > "%OUT2%\топы_итог.txt"
if errorlevel 1 goto :err
set "OUT_DIR="
type "%OUT2%\топы_итог.txt" | findstr /c:"топ1_всего" /c:"топ2_всего"
echo %date% %time% > "%OUT2%\topsdone.flag"

:s2
if exist "%OUT2%\modeldone.flag" goto :s3
echo.
echo [2] Модель по всей базе - %NV% потоков - %date% %time%
node tools\shards.cjs v8 "%OUT2%" %NV% 5120 %MM%
if errorlevel 1 goto :err
echo %date% %time% > "%OUT2%\modeldone.flag"

:s3
if exist "%OUT2%\sizesdone.flag" goto :s4
echo.
echo [3] Размеры рейзов по всей базе - %NZ% потоков - %date% %time%
set "SAMPLE=2"
set "IDSET_BITS=25"
node tools\shards.cjs sizes "%OUT2%" %NZ% 4096 12288
if errorlevel 1 goto :err
set "SAMPLE="
set "IDSET_BITS="
echo %date% %time% > "%OUT2%\sizesdone.flag"

:s4
echo.
echo [4] Сборка реплеера - %date% %time%
if not exist "%~dp0app\dist_до_новой_базы" xcopy /e /i /q /y "%~dp0app\dist" "%~dp0app\dist_до_новой_базы" >nul
set "OUT_DIR=%OUT2%"
node --max-old-space-size=12288 app\build.cjs
if errorlevel 1 goto :err

echo.
echo [5] Отчёт 2025 против 2026 - %date% %time%
node --max-old-space-size=12288 tools\years_report.cjs
if errorlevel 1 goto :err
set "OUT_DIR="
if exist "%LAUNCH%" del /q "%LAUNCH%"
echo.
echo ГОТОВО %date% %time%. Прежний реплеер сохранён в app\dist_до_новой_базы. Напишите Claude: проверь.
goto :eof
:noload
echo Сначала должна закончиться ЗАГРУЗКА_НОВОЙ_БАЗЫ.cmd - нет pipeline\out2\winq.json.
goto :eof
:err
echo.
echo Остановилось с ошибкой. Запуск снова продолжит с того же места. Напишите Claude: проверь.
goto :eof
:nonode
echo Не найден Node.js.
goto :eof
