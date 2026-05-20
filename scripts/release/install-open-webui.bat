@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."

where py >nul 2>nul && (
  py -3.11 -m pip install open-webui
  exit /b %errorlevel%
)

where python >nul 2>nul && (
  python -m pip install open-webui
  exit /b %errorlevel%
)

echo Python 3.11 is recommended for Open WebUI.
exit /b 1
