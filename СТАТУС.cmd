@echo off
rem СТАТУС.cmd - что уже сделано и последние строки лога прогона
cd /d "%~dp0"
set "OUT=%~dp0pipeline\out"
node pipeline\status.cjs
echo.
echo ===== Шаги, которые уже закончены =====
for %%F in (statsdone stagedone clusdone topsdone sizesdone lineupdone modeldone appdone) do if exist "%OUT%\%%F.flag" (echo   готово: %%F) else (echo   ещё нет: %%F)
if exist "%OUT%\ВСЁ_ГОТОВО.flag" echo   ВЕСЬ ПРОГОН ЗАКОНЧЕН
echo.
echo ===== Последние 20 строк лога =====
if exist "%OUT%\progress_v7.log" (powershell -NoProfile -Command "Get-Content -Encoding UTF8 -Tail 20 '%OUT%\progress_v7.log'") else (echo   лога ещё нет - прогон не начинался)
echo.
tasklist /fi "imagename eq node.exe" | find /i "node.exe" >nul && echo Сейчас ИДЁТ обработка - node.exe работает || echo Сейчас ничего не запущено
echo.
pause
