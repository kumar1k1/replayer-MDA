@echo off
chcp 65001 >nul
setlocal
rem ============================================================================
rem  ЗАПУСК.cmd — полный прогон replayer-MDA на всей базе (п.10).
rem  Положите папку replayer-MDA в D:\маининг\ и запустите этот файл двойным щелчком.
rem  Каждый шаг пишет флажок в pipeline\out\ — после перерыва (выключили ПК) запуск продолжится
rem  с первого незавершённого шага; модель (шаг 6) продолжает с последнего архива.
rem  Пересчитать всё заново: удалите папку pipeline\out.
rem ============================================================================
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
if "%MEM%"=="" set "MEM=12288"
set "OUT=%~dp0pipeline\out"
if not exist "%OUT%" mkdir "%OUT%"
where node >nul 2>nul || (echo Не найден Node.js. Установите с https://nodejs.org и запустите снова. & pause & exit /b 1)
if not exist "%BACKING_DIR%\pipeline\parser.cjs" (echo Не найдена папка Backing: %BACKING_DIR% & pause & exit /b 1)
echo Папка Backing: %BACKING_DIR%   память для Node: %MEM% МБ
echo Лог: %OUT%\progress_v7.log
echo.

call :step 1 "Статы игроков (весь проход, ~4-6 ч)"      statsdone   "node --max-old-space-size=%MEM% pipeline\passStats.cjs" || goto :fail
call :step 2s "Точность оценки стадии и калибровка"     stagedone   "node --max-old-space-size=%MEM% pipeline\stage_eval.cjs" || goto :fail
call :step 2 "Кластеры"                                  clusdone    "node --max-old-space-size=%MEM% pipeline\clusters.cjs" || goto :fail
call :step 3 "Топы (3000+ рук)"                          topsdone    "node --max-old-space-size=%MEM% pipeline\tops.cjs" || goto :fail
set "SAMPLE=4"
call :step 4 "Сайзинги (четверть базы, ~2-3 ч)"        sizesdone   "node --max-old-space-size=%MEM% pipeline\sizes.cjs" || goto :fail
call :step 5 "Лайнап (четверть базы, ~2-3 ч)"          lineupdone  "node --max-old-space-size=%MEM% pipeline\lineup.cjs" || goto :fail
set "SAMPLE="
set "RESUME=1"
call :step 6 "Модель v8 (весь проход, ~5-7 ч)"           modeldone   "node --max-old-space-size=%MEM% pipeline\passV8.cjs" || goto :fail
set "RESUME="
call :step 7 "Сборка реплеера app\dist"                   appdone     "node --max-old-space-size=%MEM% app\build.cjs" || goto :fail
echo.
echo [8] Проверка движка на полной модели
node --max-old-space-size=%MEM% tests\test_engine_v8.cjs > "%OUT%\test_engine.txt" 2>&1
type "%OUT%\test_engine.txt" | findstr /b /c:"FAIL" /c:"Все"
node pipeline\report.cjs > nul
echo.
echo ГОТОВО. Итог: %OUT%\ИТОГ_ПРОГОНА.md   Реплеер: %~dp0app\dist\index.html
pause
exit /b 0

:step
if exist "%OUT%\%~3.flag" (echo [%~1] %~2 — уже сделано & exit /b 0)
echo [%~1] %~2 — %date% %time%
%~4
if errorlevel 1 (echo [%~1] ОШИБКА, код %errorlevel% & exit /b 1)
echo %date% %time% > "%OUT%\%~3.flag"
exit /b 0

:fail
echo.
echo Прогон остановился с ошибкой. Пришлите %OUT%\progress_v7.log — разберёмся. Запуск снова продолжит с этого шага.
pause
exit /b 1
