@echo off
echo %date% %time% start %*>>"%~dp0run_log.txt"
rem файл в кодировке cp866; окно не закрывается после ошибки
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
setlocal
rem ============================================================================
rem  ТОПЫ_ОЦЕНКА.cmd - винрейт регов по четвертям базы и таблица: сколько топов
rem  и сколько у них рук при разных порогах - минимум рук и винрейт от 3/5/8/10.
rem  Модель и размеры НЕ меняет. Итог - pipeline\out\топы_сетка.json.
rem  Можно закрыть окно - запуск снова продолжит.
rem ============================================================================
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
set "OUT=%~dp0pipeline\out"
set "ROOMS=%~dp0новые_румы"
where node >nul 2>nul
if errorlevel 1 goto :nonode
echo Режим работы:
echo   Enter - фон: низкий приоритет, компьютером можно пользоваться
echo   м     - максимум: на полную мощность
set "MODE="
set /p "MODE=Режим: "
set "PRIO=low"
set "NS=8"
if /i "%MODE%"=="м" set "PRIO=max"
if /i "%MODE%"=="m" set "PRIO=max"
if "%PRIO%"=="max" set "NS=14"
if exist "%OUT%\winq.json" goto :report
echo.
echo [1] Винрейт по четвертям базы - %NS% потоков - начало %date% %time%
set "RAW_DIRS=%BACKING_DIR%/raw;%BACKING_DIR%/raw-ps;%ROOMS%"
set "PLAYERS_CL=%OUT%\players_cl_all.json"
set "MIN_HANDS_TOP=5000"
set "IDSET_BITS=25"
node tools\shards.cjs winq "%OUT%" %NS% 3072 8192
if errorlevel 1 goto :err
set "IDSET_BITS="
:report
echo.
echo [2] Таблица порогов
set "OUT_DIR=%OUT%"
set "PLAYERS_CL=%OUT%\players_cl_all.json"
set "REPORT_ONLY=1"
node --max-old-space-size=8192 pipeline\tops_q.cjs > nul
if errorlevel 1 goto :err
echo.
echo Готово %date% %time%. Таблица - pipeline\out\топы_сетка.json. Напишите Claude: проверь.
goto :eof
:err
echo.
echo Остановилось с ошибкой. Запуск снова продолжит. Напишите Claude: проверь.
goto :eof
:nonode
echo Не найден Node.js.
goto :eof
