@echo off
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
setlocal
rem ПЕРЕСЧЁТ_САЙЗИНГОВ.cmd - заново считает размеры ставок (каждая 4-я раздача базы, ~1 час) с реальными суммами
rem 3-бетов/4-бетов в BB, потом пересобирает реплеер. Можно закрыть окно: следующий запуск продолжит с места остановки.
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
set "OUT=%~dp0pipeline\out"
set "SAMPLE=4"
set "IDSET_BITS=26"
set "RESUME=1"
echo [1/2] Сайзинги по базе (около часа)...
node --max-old-space-size=12288 pipeline\sizes.cjs
if errorlevel 1 (
  echo ОШИБКА в сайзингах - пришлите %OUT%\progress_v7.log
  goto :eof
)
if exist "%OUT%\sizes_state.json" del /q "%OUT%\sizes_state.json"
if exist "%OUT%\sizes_ids.bin" del /q "%OUT%\sizes_ids.bin"
echo.
echo [2/2] Пересборка реплеера...
set "SAMPLE="
node --max-old-space-size=12288 app\build.cjs
echo.
echo Готово. Обновите страницу реплеера (F5).
