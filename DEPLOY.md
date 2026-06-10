# Publicar Bingo Virtual en internet

Para que personas fuera de tu WiFi entren al juego, necesitas una URL publica. `localhost` nunca sirve para otras personas porque apunta a la computadora de quien abre el enlace.

## Opcion rapida: tunel publico

1. Arranca el juego:

```powershell
npm start
```

2. Abre un tunel hacia el puerto `3000` con una herramienta como Cloudflare Tunnel, ngrok o LocalTunnel.

En este proyecto ya existe un comando para Cloudflare Tunnel si `cloudflared.exe` esta en la carpeta:

```powershell
npm run public:cloudflare
```

3. Copia la URL publica que te da la herramienta, por ejemplo:

```text
https://vingo-demo.trycloudflare.com
```

4. Reinicia el juego con esa URL:

```powershell
$env:PUBLIC_URL="https://vingo-demo.trycloudflare.com"
npm start
```

5. Crea una sala y comparte el campo `Link publico internet`.

## Opcion estable: hosting

Sube esta carpeta a un servidor Node.js como Railway, Render, Fly.io, DigitalOcean, AWS, Azure o Google Cloud.

Configura estas variables:

```text
PUBLIC_URL=https://tu-dominio.com
```

Si el hosting asigna el puerto automaticamente, no pongas `PORT`; el servidor ya usa `process.env.PORT`.

## Para mas de 300 jugadores

Esta version usa Server-Sent Events y puede manejar muchas conexiones en un servidor razonable. Para eventos grandes o varias salas simultaneas en produccion, agrega:

- Redis para compartir estado entre servidores.
- Balanceador con sesiones pegajosas o pub/sub.
- Base de datos para historial de partidas.
- HTTPS obligatorio.
