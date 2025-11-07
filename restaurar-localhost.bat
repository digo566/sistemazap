@echo off
chcp 65001 >nul
echo ═══════════════════════════════════════════════════════════════
echo   RESTAURAR CONFIGURAÇÃO LOCALHOST
echo ═══════════════════════════════════════════════════════════════
echo.

if exist "zap.html.backup" (
    copy "zap.html.backup" "zap.html" >nul
    echo ✅ Configuração restaurada para localhost!
    echo.
    echo Agora o sistema só funcionará em: http://localhost:3000
) else (
    echo ❌ Backup não encontrado!
    echo.
    echo ⚙️  Restaurando manualmente...
    powershell -Command "(Get-Content 'zap.html') -replace 'ws://[0-9.]+:3000', 'ws://localhost:3000' | Set-Content 'zap.html'"
    echo ✅ Restaurado para localhost!
)

echo.
echo Pressione qualquer tecla para continuar...
pause >nul

