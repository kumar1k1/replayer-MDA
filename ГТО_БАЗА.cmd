@echo off
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
setlocal
rem ГТО_БАЗА.cmd - строит GTO-базу из архива HRC (отдельно от базы майнинга, основной прогон не трогает).
rem Результат: gto\out\<набор>.json, лог gto\out\build.log. Готовые наборы при повторном запуске пропускаются.
cd /d "%~dp0"
set "GTO_ZIP="
if exist "D:\маининг\HRC GTO 20ml.zip" set "GTO_ZIP=D:\маининг\HRC GTO 20ml.zip"
if "%GTO_ZIP%"=="" if exist "%USERPROFILE%\Downloads\HRC GTO 20ml.zip" set "GTO_ZIP=%USERPROFILE%\Downloads\HRC GTO 20ml.zip"
if "%GTO_ZIP%"=="" (
  echo Не найден архив "HRC GTO 20ml.zip" ни в D:\маининг, ни в Загрузках.
  goto :eof
)
echo Архив: %GTO_ZIP%
echo 27 наборов: хедз-ап и 8-max на 9 стеках, около 20 млн раздач. Ориентировочно 20-60 минут.
echo Можно закрыть окно в любой момент: готовые наборы сохранятся, следующий запуск продолжит.
echo.
node --max-old-space-size=8192 gto\build.cjs "%GTO_ZIP%"
echo.
echo Напишите в чат "проверь".
