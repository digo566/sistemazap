@echo off
echo ========================================
echo   LIMPANDO CACHE DO WHATSAPP WEB
echo ========================================
echo.
cd /d "%~dp0"
echo Parando processos Node.js...
taskkill /F /IM node.exe 2>nul
echo.
echo Removendo cache...
if exist ".wwebjs_auth" (
    echo Removendo .wwebjs_auth...
    rmdir /s /q ".wwebjs_auth" 2>nul
)
if exist ".wwebjs_cache" (
    echo Removendo .wwebjs_cache...
    rmdir /s /q ".wwebjs_cache" 2>nul
)
echo.
echo Cache limpo! Agora voce pode iniciar o servidor novamente.
echo.
pause
