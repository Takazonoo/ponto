@echo off
setlocal
cd /d "%~dp0"
title Ponto - Acesso privado ao site
node scripts\ponto-privado.cjs %*
pause
