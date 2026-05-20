@echo off
setlocal
cd /d "%~dp0\..\.."
node scripts\release\hindsight-control.mjs test
