@echo off
color 0A
title Painel AGENT - Cliente
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
echo Iniciando AGENT em http://localhost:3000
call npm start
pause
