@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\esbuild\package.json" goto install
if not exist "node_modules\sass\package.json" goto install
goto build
:install
call npm.cmd ci
if errorlevel 1 goto failed
:build
call npm.cmd run build
if errorlevel 1 goto failed
echo.
echo Local HTML: dist\local\index.html
echo Local configuration: dist\local\config.js
echo StreamElements tabs: dist\streamelements
pause
exit /b 0
:failed
echo Build failed. Check the error above.
pause
exit /b 1
