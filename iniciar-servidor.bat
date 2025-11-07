@echo off
echo ========================================
echo   AUTOMACAO WHATSAPP - RESTAURANTE
echo   Iniciando servidor...
echo ========================================
echo.
cd /d "%~dp0"
echo Diretorio: %CD%
echo.
echo Instalando dependencias (se necessario)...
call npm install
echo.
echo Iniciando servidor na porta 3000...
echo.
echo IMPORTANTE: Mantenha esta janela aberta enquanto usar o sistema!
echo.
echo Quando aparecer "Servidor rodando em http://localhost:3000"
echo voce pode abrir o arquivo zap.html no navegador.
echo.
call npm start
pause
