@echo off
title Instalador Projeto Multiplataforma
color 0A

echo ==========================================
echo   INSTALADOR AUTOMATICO DO PROJETO
echo ==========================================
echo.

:: Verifica Winget
where winget >nul 2>nul
if %errorlevel% neq 0 (
    echo Winget nao encontrado.
    echo Atualize o Windows ou instale App Installer da Microsoft Store.
    pause
    exit
)

echo.
echo ==========================================
echo Instalando Node.js 20 LTS...
echo ==========================================
winget install OpenJS.NodeJS.LTS --silent

echo.
echo ==========================================
echo Atualizando NPM...
echo ==========================================
call npm install -g npm

echo.
echo ==========================================
echo Instalando Chromium do Playwright...
echo ==========================================
call npx playwright install chromium

echo.
echo ==========================================
echo Instalando dependencias do projeto...
echo ==========================================
call npm install

echo.
echo ==========================================
echo Iniciando projeto...
echo ==========================================
call npm start

echo.
echo ==========================================
echo INSTALACAO FINALIZADA
echo ==========================================
echo.
pause