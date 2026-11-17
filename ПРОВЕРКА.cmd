@echo off
if not "%~1"=="run" (
  cmd /k ""%~f0" run %*"
  exit /b
)
setlocal
rem ПРОВЕРКА.cmd - проверка модели.
rem  Двойной щелчок: 1) тесты движка на полной модели, 2) 60 000 реальных решений из базы (кто получает какие оценки).
rem  Перетащить на этот файл свой турнир (.txt) или папку с турнирами: разбор всех ваших решений и список ошибок.
cd /d "%~dp0"
if "%BACKING_DIR%"=="" set "BACKING_DIR=D:/маининг/реплеер"
set "OUT=%~dp0pipeline\out"
shift
if not "%~1"=="" goto :tours
echo [1/2] Тесты движка на полной модели (загрузка модели 1-3 минуты)...
node --max-old-space-size=12288 tests\test_engine_v8.cjs > "%OUT%\test_engine.txt" 2>&1
findstr /b /c:"FAIL" "%OUT%\test_engine.txt" >nul && (echo   ЕСТЬ ОШИБКИ - см. %OUT%\test_engine.txt) || (echo   все тесты пройдены)
findstr /c:"прогон по" "%OUT%\test_engine.txt"
echo.
echo [2/2] 60 000 реальных решений из базы: откуда советы и кто получает какие оценки (5-15 минут)...
set "N=60000"
node --max-old-space-size=12288 tests\coverage.cjs > "%OUT%\ПРОВЕРКА_БАЗЫ.txt" 2>&1
type "%OUT%\ПРОВЕРКА_БАЗЫ.txt" | findstr /v /r /c:"^   [A-Z][A-Z]* [0-9<]"
echo.
echo Готово. Полные отчёты: %OUT%\test_engine.txt и %OUT%\ПРОВЕРКА_БАЗЫ.txt
echo Чтобы проверить свои турниры - перетащите файл турнира или папку с турнирами на ПРОВЕРКА.cmd
goto :eof

:tours
set ARGS=
:collect
if "%~1"=="" goto :go
set ARGS=%ARGS% "%~1"
shift
goto :collect
:go
echo Разбор ваших турниров:%ARGS%
node --max-old-space-size=8192 tests\tour_check.cjs%ARGS%
echo.
echo Отчёт: %OUT%\ПРОВЕРКА_ТУРНИРОВ.txt
