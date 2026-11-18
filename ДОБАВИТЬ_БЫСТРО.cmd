@echo off
echo %date% %time% start %*>>"%~dp0run_log.txt"
rem окно не закрывается даже при ошибке; файл в кодировке cp866
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
setlocal
rem ============================================================================
rem  ДОБАВИТЬ_БЫСТРО.cmd - то же, что ДОБАВИТЬ_РУМЫ, но статы и модель считаются
rem  в несколько потоков параллельно. ПЕРЕД ЗАПУСКОМ закройте окно ДОБАВИТЬ_РУМЫ.
rem  Продолжает с сохранённого места. Можно закрыть окно - запуск снова продолжит.
rem ============================================================================
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
set "OUT=%~dp0pipeline\out"
set "NEWOUT=%~dp0pipeline\out_new"
set "ROOMS=%~dp0новые_румы"
if not exist "%NEWOUT%" mkdir "%NEWOUT%"
where node >nul 2>nul
if errorlevel 1 goto :nonode
echo Режим работы:
echo   Enter - ФОН: потоки с низким приоритетом, компьютером можно пользоваться
echo   м     - МАКСИМУМ: все силы, когда вы не за компьютером
set "MODE="
set /p "MODE=Режим: "
set "PRIO=low"
set "NST=8"
set "NV=4"
set "MV=5120"
if /i "%MODE%"=="м" set "PRIO=max"
if /i "%MODE%"=="m" set "PRIO=max"
if "%PRIO%"=="max" set "NST=14"
if "%PRIO%"=="max" set "NV=6"
if "%PRIO%"=="max" set "MV=4608"
echo.
echo Начало %date% %time%. Лог потоков: %NEWOUT%\потоки.log и %OUT%\потоки.log

if exist "%NEWOUT%\statsdone.flag" goto :s2
echo.
echo [1] Статы игроков новых румов - %NST% потоков
set "RAW_DIRS=%ROOMS%"
node tools\shards.cjs stats "%NEWOUT%" %NST% 3072 8192
if errorlevel 1 goto :err
echo %date% %time% > "%NEWOUT%\statsdone.flag"

:s2
set "OUT_DIR=%NEWOUT%"
if exist "%NEWOUT%\clusdone.flag" goto :s3
echo.
echo [2] Кластеры новых румов
node --max-old-space-size=8192 pipeline\clusters.cjs
if errorlevel 1 goto :err
echo %date% %time% > "%NEWOUT%\clusdone.flag"
:s3
if exist "%NEWOUT%\topsdone.flag" goto :s4
echo.
echo [3] Топы новых румов
node --max-old-space-size=8192 pipeline\tops.cjs
if errorlevel 1 goto :err
echo %date% %time% > "%NEWOUT%\topsdone.flag"
:s4
set "OUT_DIR="
echo.
echo [4] Слияние с основной базой
node --max-old-space-size=8192 tools\merge_rooms.cjs
if errorlevel 1 goto :err

if exist "%NEWOUT%\modeldone.flag" goto :s6
if not exist "%OUT%\model_v8_до_румов.ndjson" copy /y "%OUT%\model_v8.ndjson" "%OUT%\model_v8_до_румов.ndjson" >nul
echo.
echo [5] Модель: новые румы - %NV% потоков, затем слияние с основной моделью
set "RAW_DIRS=%BACKING_DIR%/raw;%BACKING_DIR%/raw-ps;%ROOMS%"
set "PLAYERS_CL=%OUT%\players_cl_all.json"
set "TOPS=%OUT%\tops_all.json"
set "TOURN=%OUT%\tourn_all.json"
node tools\shards.cjs v8 "%OUT%" %NV% %MV% 16384
if errorlevel 1 goto :err
echo %date% %time% > "%NEWOUT%\modeldone.flag"

:s6
echo.
echo [6] Сборка реплеера
node --max-old-space-size=12288 app\build.cjs
if errorlevel 1 goto :err
node pipeline\report.cjs > nul
echo.
echo ГОТОВО %date% %time%. Новые румы в модели. Напишите Claude: проверь.
echo %date% %time% > "%NEWOUT%\ВСЁ_ГОТОВО.flag"
goto :eof
:err
echo.
echo Остановилось с ошибкой. Запуск снова продолжит с этого шага. Напишите Claude: проверь.
goto :eof
:nonode
echo Не найден Node.js.
goto :eof
