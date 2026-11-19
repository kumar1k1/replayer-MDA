@echo off
echo %date% %time% start %*>>"%~dp0run_log.txt"
rem окно не закрывается даже при ошибке; файл в кодировке cp866
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
setlocal
rem ============================================================================
rem  САЙЗИНГИ.cmd - пересчёт размеров рейзов по всей базе, в несколько потоков.
rem  Размеры отдельно по каждой позиции - SB отдельно от BB, по точному стеку
rem  и по позиции открывшего. Затем сборка реплеера.
rem  Можно закрыть окно - запуск снова продолжит.
rem ============================================================================
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
set "OUT=%~dp0pipeline\out"
set "ROOMS=%~dp0новые_румы"
where node >nul 2>nul
if errorlevel 1 goto :nonode
echo Режим работы:
echo   Enter - ФОН: низкий приоритет, компьютером можно пользоваться
echo   м     - МАКСИМУМ: все силы, когда вы не за компьютером
set "MODE="
set /p "MODE=Режим: "
set "PRIO=low"
set "NS=8"
if /i "%MODE%"=="м" set "PRIO=max"
if /i "%MODE%"=="m" set "PRIO=max"
if "%PRIO%"=="max" set "NS=14"
if exist "%OUT%\сайзинги2.flag" goto :run
if exist "%OUT%\sizes_state.json" del /q "%OUT%\sizes_state.json"
if exist "%OUT%\sizes_ids.bin" del /q "%OUT%\sizes_ids.bin"
if exist "%OUT%\потоки_план.json" del /q "%OUT%\потоки_план.json"
for /d %%D in ("%OUT%\shard_*") do rmdir /s /q "%%D"
echo %date% %time% > "%OUT%\сайзинги2.flag"
:run
echo.
echo [1] Сайзинги - %NS% потоков, каждая вторая раздача - начало %date% %time%
set "RAW_DIRS=%BACKING_DIR%/raw;%BACKING_DIR%/raw-ps;%ROOMS%"
set "TOPS=%OUT%\tops_all.json"
set "TOURN=%OUT%\tourn_all.json"
set "SAMPLE=2"
set "IDSET_BITS=25"
node tools\shards.cjs sizes "%OUT%" %NS% 4096 12288
if errorlevel 1 goto :err
set "SAMPLE="
set "IDSET_BITS="
echo.
echo [2] Сборка реплеера
node --max-old-space-size=12288 app\build.cjs
if errorlevel 1 goto :err
del /q "%OUT%\сайзинги2.flag"
echo.
echo ГОТОВО %date% %time%. Напишите Claude: проверь.
goto :eof
:err
echo.
echo Остановилось с ошибкой. Запуск снова продолжит. Напишите Claude: проверь.
goto :eof
:nonode
echo Не найден Node.js.
goto :eof
