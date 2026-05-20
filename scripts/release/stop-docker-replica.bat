@echo off
setlocal
chcp 65001 >nul
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8741"
set "NAME=%~2"
if "%NAME%"=="" set "NAME=openclaude-agent-%PORT%"
docker rm -f "%NAME%"
