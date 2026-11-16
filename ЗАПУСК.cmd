@echo off
rem окно не закрывается даже при ошибке: скрипт перезапускает себя внутри «cmd /k»
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
chcp 65001 >nul
setlocal
rem ============================================================================
rem  ЗАПУСК.cmd — полный прогон replayer-MDA на всей базе, ЧАСТЯМИ.
rem  Каждый тяжёлый шаг сохраняет прогресс после каждого архива, всего 34 архива.
rem  Можно указать, сколько архивов пройти за запуск, или просто закрыть окно —
rem  потеряется только архив, который обрабатывался в этот момент.
rem  Следующий запуск продолжит с того же места. Посмотреть прогресс: СТАТУС.cmd
rem  Пересчитать всё заново: удалить папку pipeline\out.
rem ============================================================================
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
if "%MEM%"=="" set "MEM=12288"
set "OUT=%~dp0pipeline\out"
if not exist "%OUT%" mkdir "%OUT%"
where node >nul 2>nul
if errorlevel 1 goto :nonode
if not exist "%BACKING_DIR%\pipeline\parser.cjs" goto :nobacking
echo Папка Backing: %BACKING_DIR%
echo Память для Node: %MEM% МБ
echo Лог прогона: %OUT%\progress_v7.log
echo.
echo Сколько архивов пройти за этот запуск? Всего 34 на шаг. Enter - до конца без остановки.
set "MAX_SOURCES="
set /p "MAX_SOURCES=Архивов: "
echo.
set "RESUME=1"

call :step 1  "Статы игроков и ход турниров - весь проход"   statsdone   "node --max-old-space-size=%MEM% pipeline\passStats.cjs"   "stats_state.ndjson stats_ids.bin"
if errorlevel 1 goto :stop
call :step 2s "Точность оценки стадии и калибровка"          stagedone   "node --max-old-space-size=%MEM% pipeline\stage_eval.cjs"  ""
if errorlevel 1 goto :stop
call :step 2  "Кластеры"                                     clusdone    "node --max-old-space-size=%MEM% pipeline\clusters.cjs"    ""
if errorlevel 1 goto :stop
call :step 3  "Топы - от 3000 рук, по формату"               topsdone    "node --max-old-space-size=%MEM% pipeline\tops.cjs"        ""
if errorlevel 1 goto :stop
set "SAMPLE=4"
set "IDSET_BITS=26"
call :step 4  "Сайзинги - каждая 4-я раздача"                sizesdone   "node --max-old-space-size=%MEM% pipeline\sizes.cjs"       "sizes_state.json sizes_ids.bin"
if errorlevel 1 goto :stop
set "SAMPLE=20"
set "IDSET_BITS=24"
call :step 5  "Лайнап - каждая 20-я раздача"                 lineupdone  "node --max-old-space-size=%MEM% pipeline\lineup.cjs"      "lineup_ids.bin"
if errorlevel 1 goto :stop
set "SAMPLE="
set "IDSET_BITS="
call :step 6  "Модель v8 - весь проход"                      modeldone   "node --max-old-space-size=%MEM% pipeline\passV8.cjs"      "v8_state.ndjson v8_ids.bin"
if errorlevel 1 goto :stop
set "MAX_SOURCES="
call :step 7  "Сборка реплеера app\dist"                     appdone     "node --max-old-space-size=%MEM% app\build.cjs"            ""
if errorlevel 1 goto :stop
echo.
echo [8] Проверка движка на полной модели
node --max-old-space-size=%MEM% tests\test_engine_v8.cjs > "%OUT%\test_engine.txt" 2>&1
node pipeline\report.cjs > nul
echo.
echo ГОТОВО. Итог: %OUT%\ИТОГ_ПРОГОНА.md
echo Реплеер: %~dp0app\dist\index.html
echo %date% %time% > "%OUT%\ВСЁ_ГОТОВО.flag"
goto :eof

rem ---------- один шаг: пропустить, если уже сделан; код 3 = часть готова ----------
:step
if exist "%OUT%\%~3.flag" goto :stepskip
echo.
echo [%~1] %~2 - начало %date% %time%
%~4
set "RC=%errorlevel%"
if "%RC%"=="3" goto :steppart
if not "%RC%"=="0" goto :steperr
echo %date% %time% > "%OUT%\%~3.flag"
for %%F in (%~5) do if exist "%OUT%\%%F" del /q "%OUT%\%%F"
if "%~3"=="lineupdone" if exist "%OUT%\lineup_ck" rmdir /s /q "%OUT%\lineup_ck"
echo [%~1] %~2 - готово %date% %time%
exit /b 0
:stepskip
echo [%~1] %~2 - уже сделано
exit /b 0
:steppart
echo.
echo [%~1] ЧАСТЬ ГОТОВА, прогресс сохранён %date% %time%
echo Можно закрыть окно и выключать компьютер. Следующий запуск ЗАПУСК.cmd продолжит отсюда.
echo %date% %time% > "%OUT%\часть_готова.flag"
exit /b 3
:steperr
echo [%~1] ОШИБКА, код %RC%
exit /b 1

:stop
if exist "%OUT%\часть_готова.flag" del /q "%OUT%\часть_готова.flag" & goto :eof
echo.
echo Прогон остановился с ошибкой. Пришлите %OUT%\progress_v7.log - разберёмся.
echo Запуск снова продолжит с этого шага.
goto :eof

:nonode
echo Не найден Node.js. Установите с https://nodejs.org и запустите снова.
goto :eof
:nobacking
echo Не найдена папка Backing: %BACKING_DIR%
goto :eof
