@echo off
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
setlocal
rem ПЕРЕСЧЁТ_МОДЕЛИ.cmd - заново считает модель v8 по всей базе (~4-5 часов) и пересобирает реплеер.
rem Нужно, чтобы в модели появились руки регов на вскрытии (веса "как реги играют вашу руку").
rem Можно закрыть окно после строки "источник пройден ... (чекпоинт)": следующий запуск продолжит.
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
set "OUT=%~dp0pipeline\out"
if exist "%OUT%\модель_пересчёт.flag" goto :go
echo Удаляю старый чекпоинт модели, чтобы пересчитать заново...
if exist "%OUT%\v8_state.ndjson" del /q "%OUT%\v8_state.ndjson"
if exist "%OUT%\v8_ids.bin" del /q "%OUT%\v8_ids.bin"
echo %date% %time% > "%OUT%\модель_пересчёт.flag"
:go
set "RESUME=1"
echo [1/2] Модель v8 по всей базе (4-5 часов)...
node --max-old-space-size=12288 pipeline\passV8.cjs
if errorlevel 1 (
  echo ОШИБКА в модели - пришлите %OUT%\progress_v7.log
  goto :eof
)
del /q "%OUT%\модель_пересчёт.flag"
echo.
echo [2/2] Пересборка реплеера...
node --max-old-space-size=12288 app\build.cjs
echo.
echo Готово. Обновите страницу реплеера (F5).
