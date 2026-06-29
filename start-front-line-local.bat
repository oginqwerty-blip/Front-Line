@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 set "NODE_EXE=node"
if not defined NODE_EXE set "NODE_EXE=C:\Users\o1113\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%NODE_EXE%" goto start_server
if "%NODE_EXE%"=="node" goto start_server

echo Node.js was not found.
echo Expected path:
echo %NODE_EXE%
pause
exit /b 1

:start_server
echo Starting Front-Line local server...
start "Front-Line Server" cmd /k ""%NODE_EXE%" "%~dp0server.js""

timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8787/"

echo.
echo If the browser still says connection refused, wait a moment and refresh.
echo Keep the "Front-Line Server" window open while playing.
timeout /t 4 /nobreak >nul
