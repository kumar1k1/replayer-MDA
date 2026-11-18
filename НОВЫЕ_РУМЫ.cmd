@echo off
echo %date% %time% start %*>>"%~dp0run_log.txt"
rem окно не закрывается даже при ошибке; файл в кодировке cp866
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
setlocal
rem ============================================================================
rem  НОВЫЕ_РУМЫ.cmd - шаг 1 добавления WPN и iPoker: перевод архивов в формат PokerStars.
rem  Берёт zip из D:\маининг\WPN и D:\маининг\Ipoker, по одному rar за раз, ничего не распаковывает
rem  на диск целиком. Результат: папка новые_румы рядом с этим файлом, сжатые .txt.gz.
rem  Можно закрыть окно в любой момент - следующий запуск продолжит со следующего архива.
rem ============================================================================
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
if "%MEM%"=="" set "MEM=12288"
where node >nul 2>nul
if errorlevel 1 goto :nonode
echo Перевод архивов WPN и iPoker - начало %date% %time%
echo Лог: %~dp0новые_румы\конвертация.log
echo.
node --max-old-space-size=%MEM% tools\convert_rooms.cjs "D:\маининг\WPN" "D:\маининг\Ipoker"
if errorlevel 1 goto :err
echo.
echo ГОТОВО %date% %time%. Компьютер можно выключать. Напишите Claude: проверь.
echo %date% %time% > "%~dp0новые_румы\ПЕРЕВОД_ГОТОВ.flag"
goto :eof
:err
echo.
echo Остановилось с ошибкой. Запуск снова продолжит с того же места. Напишите Claude: проверь.
goto :eof
:nonode
echo Не найден Node.js.
goto :eof
