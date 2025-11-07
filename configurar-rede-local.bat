@echo off
chcp 65001 >nul
echo ═══════════════════════════════════════════════════════════════
echo   CONFIGURAR ACESSO NA REDE LOCAL
echo ═══════════════════════════════════════════════════════════════
echo.

REM Obter o IP local
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set IP=%%a
    goto :found
)
:found
set IP=%IP:~1%

echo 📍 Seu IP na rede local: %IP%
echo.
echo ⚙️  Configurando zap.html para usar o IP da rede...
echo.

REM Criar backup
if not exist "zap.html.backup" (
    copy "zap.html" "zap.html.backup" >nul
    echo ✅ Backup criado: zap.html.backup
)

REM Substituir localhost pelo IP na rede
powershell -Command "(Get-Content 'zap.html') -replace 'ws://localhost:3000', 'ws://%IP%:3000' | Set-Content 'zap.html'"

echo ✅ Configuração concluída!
echo.
echo 📱 Agora você pode acessar de outros dispositivos:
echo    http://%IP%:3000
echo.
echo ⚠️  IMPORTANTE:
echo    - Todos os dispositivos devem estar na mesma rede Wi-Fi
echo    - O firewall pode pedir permissão na primeira vez
echo.
echo Pressione qualquer tecla para continuar...
pause >nul

