@echo off
rem файл в кодировке cp866; окно не закрывается после ошибки
if "%~1"=="run" goto :main
cmd /k ""%~f0" run %~1"
exit /b
:main
setlocal
echo %date% %time% start %*>>"%~dp0run_log.txt"
rem ============================================================================
rem  ЗАГРУЗКА_НОВОЙ_БАЗЫ.cmd - новая база из D:\маининг\new в работу:
rem   [1] перевод архивов 888, Chico, PS, PS ES, WPN, iPoker, Coin - параллельно
rem   [2] статы игроков по ВСЕЙ базе - старая + новые румы + новая - по ядрам
rem   [3] кластеры игроков и ход турниров
rem   [4] винрейт регов по четвертям базы - по ядрам
rem   [5] таблица порогов топов - pipeline\out2\топы_сетка.json
rem  Модель и реплеер НЕ меняет - всё пишется в pipeline\out2.
rem  Компьютер можно выключать: после включения и входа в Windows
rem  загрузка сама продолжится с того же места.
rem ============================================================================
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
set "SRC=D:\маининг\new"
set "OUT2=%~dp0pipeline\out2"
set "ROOMS=%~dp0новые_румы"
set "ROOMS2=%~dp0новые_румы2"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCH=%STARTUP%\РЕПЛЕЕР_ЗАГРУЗКА.cmd"
if not exist "%OUT2%" mkdir "%OUT2%"
if not exist "%ROOMS2%" mkdir "%ROOMS2%"
rem служебные списки номеров прошлого перевода WPN и iPoker - перевод закончен, больше не нужны, 4 ГБ
for %%F in ("%ROOMS%\конвертация_номера*.bin") do del /q "%%F"
where node >nul 2>nul
if errorlevel 1 goto :nonode
if /i "%~2"=="auto" goto :automode
echo Режим работы:
echo   Enter - максимум: все ядра, быстрее всего
echo   ф     - фон: низкий приоритет, компьютером удобно пользоваться
set "MODE="
set /p "MODE=Режим: "
> "%OUT2%\режим.txt" echo.%MODE%
goto :modeset
:automode
echo Автозапуск после включения компьютера - продолжаю загрузку.
set "MODE="
if exist "%OUT2%\режим.txt" set /p MODE=<"%OUT2%\режим.txt"
:modeset
if "%MODE%"==" " set "MODE="
set "PRIO=max"
if /i "%MODE%"=="ф" set "PRIO=low"
if /i "%MODE%"=="f" set "PRIO=low"
set /a NS=%NUMBER_OF_PROCESSORS%-2
if %NS% GTR 14 set "NS=14"
if %NS% LSS 2 set "NS=2"
set "NC=6"
if "%PRIO%"=="low" set /a NS=%NS%/2
if "%PRIO%"=="low" set "NC=3"
rem по памяти: поток статов - до 3 ГБ, перевод архива - до 4 ГБ; запас 6 ГБ системе и программам
set "RAMGB=16"
for /f %%M in ('powershell -NoProfile -Command "[math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB)"') do set "RAMGB=%%M"
set /a MAXS=(%RAMGB%-6)/3
set /a MAXC=(%RAMGB%-6)/4
if %MAXS% LSS 2 set "MAXS=2"
if %MAXC% LSS 1 set "MAXC=1"
if %NS% GTR %MAXS% set "NS=%MAXS%"
if %NC% GTR %MAXC% set "NC=%MAXC%"
echo Памяти %RAMGB% ГБ, ядер %NUMBER_OF_PROCESSORS%, потоков %NS%, перевод - %NC% архива одновременно, приоритет %PRIO%
rem автозапуск: пока загрузка не закончена, после включения компьютера она продолжится сама
> "%LAUNCH%" echo @start "" "%~f0" auto

if exist "%ROOMS2%\перевод_готов.flag" goto :s2
echo.
echo [1] Перевод архивов - начало %date% %time%
node tools\convert_new.cjs "%SRC%" "%ROOMS2%" %NC%
if errorlevel 1 goto :err
echo %date% %time% > "%ROOMS2%\перевод_готов.flag"

:s2
if exist "%OUT2%\statsdone.flag" goto :s3
echo.
echo [2] Статы игроков по всей базе - %NS% потоков - начало %date% %time%
set "RAW_DIRS=%BACKING_DIR%/raw;%BACKING_DIR%/raw-ps;%ROOMS%;%ROOMS2%"
node tools\shards.cjs stats "%OUT2%" %NS% 3072 16384
if errorlevel 1 goto :err
echo %date% %time% > "%OUT2%\statsdone.flag"

:s3
if exist "%OUT2%\clusdone.flag" goto :s4
echo.
echo [3] Кластеры игроков - начало %date% %time%
set "OUT_DIR=%OUT2%"
node --max-old-space-size=16384 pipeline\clusters.cjs
if errorlevel 1 goto :err
set "OUT_DIR="
copy /y "%OUT2%\players_cl_v8.json" "%OUT2%\players_cl_all.json" >nul
copy /y "%OUT2%\tourn_v8.json" "%OUT2%\tourn_all.json" >nul
echo %date% %time% > "%OUT2%\clusdone.flag"

:s4
if exist "%OUT2%\winq.json" goto :s5
echo.
echo [4] Винрейт регов по четвертям базы - %NS% потоков - начало %date% %time%
set "RAW_DIRS=%BACKING_DIR%/raw;%BACKING_DIR%/raw-ps;%ROOMS%;%ROOMS2%"
set "PLAYERS_CL=%OUT2%\players_cl_all.json"
set "MIN_HANDS_TOP=5000"
node tools\shards.cjs winq "%OUT2%" %NS% 3072 8192
if errorlevel 1 goto :err

:s5
echo.
echo [5] Таблица порогов топов
set "OUT_DIR=%OUT2%"
set "PLAYERS_CL=%OUT2%\players_cl_all.json"
set "REPORT_ONLY=1"
node --max-old-space-size=8192 pipeline\tops_q.cjs > nul
if errorlevel 1 goto :err
if exist "%LAUNCH%" del /q "%LAUNCH%"
echo.
echo ГОТОВО %date% %time%. Напишите Claude: проверь.
goto :eof
:err
echo.
echo Остановилось с ошибкой. Запуск снова продолжит с того же места. Напишите Claude: проверь.
goto :eof
:nonode
echo Не найден Node.js.
goto :eof
