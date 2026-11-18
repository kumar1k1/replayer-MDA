@echo off
echo %date% %time% start %*>>"%~dp0run_log.txt"
rem окно не закрывается даже при ошибке; файл в кодировке cp866
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
setlocal
rem ============================================================================
rem  ДОБАВИТЬ_РУМЫ.cmd - шаг 2: переведённые раздачи WPN и iPoker - в модель.
rem  Старая база PokerStars и CoinPoker заново НЕ считается.
rem   0 - образцы непереведённых раздач WPN, несколько минут
rem   1 - статы игроков новых румов, папка pipeline\out_new
rem   2 - кластеры и 3 - топы новых румов, свои по каждому руму
rem   4 - слияние с основной базой
rem   5 - модель: к сохранённому состоянию добавляются только новые архивы
rem   6 - сборка реплеера
rem  Можно закрыть окно в любой момент - запуск снова продолжит с того же места.
rem ============================================================================
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
if "%MEM%"=="" set "MEM=12288"
set "OUT=%~dp0pipeline\out"
set "NEWOUT=%~dp0pipeline\out_new"
set "ROOMS=%~dp0новые_румы"
if not exist "%NEWOUT%" mkdir "%NEWOUT%"
where node >nul 2>nul
if errorlevel 1 goto :nonode
if not exist "%ROOMS%\ПЕРЕВОД_ГОТОВ.flag" goto :noconv
if not exist "%OUT%\v8_state.ndjson" goto :nostate
echo Добавление новых румов - начало %date% %time%
echo Лог: %NEWOUT%\progress_v7.log и %OUT%\progress_v7.log
echo.

if exist "%NEWOUT%\обр.flag" goto :s1
echo [0] Образцы непереведённых раздач WPN
node --max-old-space-size=%MEM% tools\wpn_fails.cjs "D:\маининг\WPN"
echo %date% %time% > "%NEWOUT%\обр.flag"

:s1
if exist "%NEWOUT%\statsdone.flag" goto :s2
echo.
echo [1] Статы игроков новых румов - начало %date% %time%
set "RAW_DIRS=%ROOMS%"
set "OUT_DIR=%NEWOUT%"
set "RESUME=1"
set "KEEP_STATE=1"
set "CK_EVERY=10"
node --max-old-space-size=%MEM% pipeline\passStats.cjs
if errorlevel 1 goto :err
echo %date% %time% > "%NEWOUT%\statsdone.flag"

:s2
set "OUT_DIR=%NEWOUT%"
if exist "%NEWOUT%\clusdone.flag" goto :s3
echo.
echo [2] Кластеры новых румов
node --max-old-space-size=%MEM% pipeline\clusters.cjs
if errorlevel 1 goto :err
echo %date% %time% > "%NEWOUT%\clusdone.flag"

:s3
if exist "%NEWOUT%\topsdone.flag" goto :s4
echo.
echo [3] Топы новых румов
node --max-old-space-size=%MEM% pipeline\tops.cjs
if errorlevel 1 goto :err
echo %date% %time% > "%NEWOUT%\topsdone.flag"

:s4
set "OUT_DIR="
echo.
echo [4] Слияние с основной базой
node --max-old-space-size=%MEM% tools\merge_rooms.cjs
if errorlevel 1 goto :err

if exist "%NEWOUT%\modeldone.flag" goto :s6
if not exist "%OUT%\model_v8_до_румов.ndjson" copy /y "%OUT%\model_v8.ndjson" "%OUT%\model_v8_до_румов.ndjson" >nul
echo.
echo [5] Модель: добавляю новые румы к сохранённому состоянию - начало %date% %time%
set "RAW_DIRS=%BACKING_DIR%/raw;%BACKING_DIR%/raw-ps;%ROOMS%"
set "RESUME=1"
set "CK_EVERY=25"
set "PLAYERS_CL=%OUT%\players_cl_all.json"
set "TOPS=%OUT%\tops_all.json"
set "TOURN=%OUT%\tourn_all.json"
node --max-old-space-size=%MEM% pipeline\passV8.cjs
if errorlevel 1 goto :err
echo %date% %time% > "%NEWOUT%\modeldone.flag"

:s6
echo.
echo [6] Сборка реплеера
node --max-old-space-size=%MEM% app\build.cjs
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
:noconv
echo Сначала нужен перевод архивов: НОВЫЕ_РУМЫ.cmd
goto :eof
:nostate
echo Нет сохранённого состояния модели pipeline\out\v8_state.ndjson - добавлять не к чему.
goto :eof
:nonode
echo Не найден Node.js.
goto :eof
