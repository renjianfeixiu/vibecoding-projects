@echo off
chcp 65001 >nul
setlocal
if not exist "%~dp0打开帧序.html" (
  echo Portable HTML is missing. Download the latest repository again.
  pause
  exit /b 1
)
start "" "%~dp0打开帧序.html"
