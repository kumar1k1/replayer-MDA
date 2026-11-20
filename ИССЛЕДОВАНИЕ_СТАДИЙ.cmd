@echo off
rem файл в кодировке cp866; окно не закрывается после ошибки
if "%~1"=="run" goto :main
cmd /k ""%~f0" run %~1"
exit /b
:main
setlocal
echo %date% %time% start stages %*>>"%~dp0run_log.txt"
rem ============================================================================
rem  ИССЛЕДОВАНИЕ_СТАДИЙ.cmd - насколько по-разному играют на стадиях турнира:
rem   [1] проход по всей базе - 6 стадий, по ядрам
rem   [2] отчёт pipeline\out2\стадии_отчёт.md
rem  Модель и реплеер НЕ меняет. Запускать ПОСЛЕ ЗАГРУЗКА_НОВОЙ_БАЗЫ.cmd.
rem  Компьютер можно выключать: после входа в Windows продолжится само.
rem ============================================================================
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
set "OUT2=%~dp0pipeline\out2"
set "ROOMS=%~dp0новые_румы"
set "ROOMS2=%~dp0новые_румы2"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCH=%STARTUP%\РЕПЛЕЕР_СТАДИИ.cmd"
where node >nul 2>nul
if errorlevel 1 goto :nonode
if not exist "%OUT2%\топы_сетка.json" goto :notyet
rem память: поток держит ход турниров - около 3 ГБ, большие архивы старой базы - ещё до 5 ГБ
if not exist "%OUT2%\потоков.stages.txt" > "%OUT2%\потоков.stages.txt" echo 10
if not exist "%OUT2%\память_потока.stages.txt" > "%OUT2%\память_потока.stages.txt" echo 8192
if not exist "%OUT2%\потоков_одновременно.stages.txt" > "%OUT2%\потоков_одновременно.stages.txt" echo 3
if not exist "%OUT2%\память_слияния.stages.txt" > "%OUT2%\память_слияния.stages.txt" echo 8192
> "%LAUNCH%" echo @start "" "%~f0" auto
set "PRIO=max"
if exist "%OUT2%\stages.json" goto :s2
echo.
echo [1] Стадии - проход по всей базе - начало %date% %time%
set "RAW_DIRS=%BACKING_DIR%/raw;%BACKING_DIR%/raw-ps;%ROOMS%;%ROOMS2%"
set "PLAYERS_CL=%OUT2%\players_cl_all.json"
set "TOURN=%OUT2%\tourn_all.json"
node tools\shards.cjs stages "%OUT2%" 10 8192 8192
if errorlevel 1 goto :err
:s2
echo.
echo [2] Отчёт по стадиям
set "OUT_DIR=%OUT2%"
node --max-old-space-size=4096 tools\stages_report.cjs
if errorlevel 1 goto :err
if exist "%LAUNCH%" del /q "%LAUNCH%"
echo.
echo ГОТОВО %date% %time%. Напишите Claude: проверь стадии.
goto :eof
:notyet
echo Сначала должна закончиться ЗАГРУЗКА_НОВОЙ_БАЗЫ.cmd - появится pipeline\out2\топы_сетка.json.
goto :eof
:err
echo.
echo Остановилось с ошибкой. Запуск снова продолжит с того же места. Напишите Claude: проверь.
goto :eof
:nonode
echo Не найден Node.js.
goto :eof
