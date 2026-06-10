@echo off
cd /d "%~dp0"
echo Iniciando Bingo Virtual publico...
echo.
echo Deja esta ventana abierta mientras dure el juego.
echo El enlace publico aparecera aqui y tambien en public-url.txt
echo.
npm.cmd run public:cloudflare
pause
