@echo off
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
setlocal
rem ГТО_ОБЗОР.cmd - быстрый обзор архива HRC GTO (без распаковки). Отдельно от базы майнинга, основной прогон не трогает.
cd /d "%~dp0"
set "GTO_ZIP="
if exist "D:\маининг\HRC GTO 20ml.zip" set "GTO_ZIP=D:\маининг\HRC GTO 20ml.zip"
if "%GTO_ZIP%"=="" if exist "%USERPROFILE%\Downloads\HRC GTO 20ml.zip" set "GTO_ZIP=%USERPROFILE%\Downloads\HRC GTO 20ml.zip"
if "%GTO_ZIP%"=="" (
  echo Не найден архив "HRC GTO 20ml.zip" ни в D:\маининг, ни в Загрузках.
  goto :eof
)
echo Архив: %GTO_ZIP%
echo Смотрю состав и выборку раздач, это 1-3 минуты...
echo.
node gto\scan.cjs "%GTO_ZIP%"
echo.
echo Готово. Напишите в чат "проверь" - я прочитаю gto\out\обзор.txt
