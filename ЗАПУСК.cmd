@echo off
chcp 65001 >nul
setlocal
rem ============================================================================
rem  ЗАПУСК.cmd — полный прогон replayer-MDA на всей базе, ЧАСТЯМИ.
rem  Каждый тяжёлый шаг сохраняет прогресс после каждого архива (34 архива). Можно:
rem   • указать, сколько архивов пройти за этот запуск — по окончании окно сообщит «часть готова»;
rem   • или просто закрыть окно — потеряется только архив, который обрабатывался в этот момент.
rem  Следующий запуск продолжит с того же места. Пересчитать всё заново: удалить папку pipeline\out.
rem ============================================================================
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
if "%MEM%"=="" set "MEM=12288"
set "OUT=%~dp0pipeline\out"
if not exist "%OUT%" mkdir "%OUT%"
where node >nul 2>nul || (echo Не найден Node.js. Установите с https://nodejs.org и запустите снова. & pause & exit /b 1)
if not exist "%BACKING_DIR%\pipeline\parser.cjs" (echo Не найдена папка Backing: %BACKING_DIR% & pause & exit /b 1)
echo Папка Backing: %BACKING_DIR%   память для Node: %MEM% МБ   лог: %OUT%\progress_v7.log
echo.
echo Сколько архивов пройти за этот запуск? (всего 34 на шаг; Enter — до конца без остановки)
set "MAX_SOURCES="
set /p "MAX_SOURCES=Архивов: "
echo.
set "RESUME=1"

call :step 1  "Статы игроков и ход турниров (весь проход)"      statsdone   "node --max-old-space-size=%MEM% pipeline\passStats.cjs"   "stats_state.ndjson stats_ids.bin" || goto :stop
call :step 2s "Точность оценки стадии и калибровка"              stagedone   "node --max-old-space-size=%MEM% pipeline\stage_eval.cjs"  "" || goto :stop
call :step 2  "Кластеры"                                         clusdone    "node --max-old-space-size=%MEM% pipeline\clusters.cjs"    "" || goto :stop
call :step 3  "Топы (3000+ рук, по формату)"                     topsdone    "node --max-old-space-size=%MEM% pipeline\tops.cjs"        "" || goto :stop
set "SAMPLE=4"& set "IDSET_BITS=26"
call :step 4  "Сайзинги (каждая 4-я раздача)"                    sizesdone   "node --max-old-space-size=%MEM% pipeline\sizes.cjs"       "sizes_state.json sizes_ids.bin" || goto :stop
set "SAMPLE=20"& set "IDSET_BITS=24"
call :step 5  "Лайнап (каждая 20-я раздача)"                     lineupdone  "node --max-old-space-size=%MEM% pipeline\lineup.cjs"      "lineup_ids.bin" || goto :stop
set "SAMPLE="& set "IDSET_BITS="
call :step 6  "Модель v8 (весь проход)"                          modeldone   "node --max-old-space-size=%MEM% pipeline\passV8.cjs"      "v8_state.ndjson v8_ids.bin" || goto :stop
set "MAX_SOURCES="
call :step 7  "Сборка реплеера app\dist"                         appdone     "node --max-old-space-size=%MEM% app\build.cjs"            "" || goto :stop
echo.
echo [8] Проверка движка на полной модели
node --max-old-space-size=%MEM% tests\test_engine_v8.cjs > "%OUT%\test_engine.txt" 2>&1
node pipeline\report.cjs > nul
echo.
echo ГОТОВО. Итог: %OUT%\ИТОГ_ПРОГОНА.md   Реплеер: %~dp0app\dist\index.html
pause
exit /b 0

:step
if exist "%OUT%\%~3.flag" (echo [%~1] %~2 — уже сделано& exit /b 0)
echo [%~1] %~2 — %date% %time%
%~4
set "RC=%errorlevel%"
if "%RC%"=="3" (echo.& echo [%~1] Часть готова, прогресс сохранён. Можно выключать компьютер — следующий запуск ЗАПУСК.cmd продолжит отсюда.& exit /b 3)
if not "%RC%"=="0" (echo [%~1] ОШИБКА, код %RC%& exit /b 1)
echo %date% %time% > "%OUT%\%~3.flag"
rem шаг завершён — служебные файлы продолжения больше не нужны (освобождают место на диске)
for %%F in (%~5) do if exist "%OUT%\%%F" del /q "%OUT%\%%F"
if "%~3"=="lineupdone" if exist "%OUT%\lineup_ck" rmdir /s /q "%OUT%\lineup_ck"
exit /b 0

:stop
if "%errorlevel%"=="3" (pause & exit /b 0)
echo.
echo Прогон остановился с ошибкой. Пришлите %OUT%\progress_v7.log — разберёмся. Запуск снова продолжит с этого шага.
pause
exit /b 1
