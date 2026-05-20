@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."
docker compose -f docker-compose.agent-gateway.yml --profile workers up --build
