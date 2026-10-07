@echo off
chcp 65001 >nul
echo.
echo  Estakalc - acesso pela rede local (celular/tablet na MESMA rede Wi-Fi)
echo  No celular, abra o endereco "Network" mostrado abaixo (ex.: http://192.168.0.15:5173)
echo  Seus enderecos IPv4 neste computador:
ipconfig | findstr /i "IPv4"
echo.
cd /d "%~dp0app"
call npm run dev -- --host --port 5173
