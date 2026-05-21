@echo off
title Projeto Online
color 0A

cd /d "%~dp0"

cls
echo.
echo ==========================================
echo           PAINEL MULTIPLATAFORMA INICIANDO
echo ==========================================
echo.

start http://localhost:3000

npm start

pause