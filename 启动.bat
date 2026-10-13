@echo off
chcp 65001 >nul
title 校园二手交易平台
cd /d "%~dp0"
echo.
echo   正在启动「校园集市 · 校园二手交易平台」...
echo.
node --no-warnings server.js
pause
