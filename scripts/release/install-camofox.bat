@echo off
setlocal
cd /d "%~dp0\..\.."
node scripts\release\camofox-control.mjs install
