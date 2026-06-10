# Bingo Virtual

Software web de bingo virtual con salas por link, anfitrion, jugadores y actualizacion en vivo.

## Como iniciar

```powershell
npm start
```

Luego abre:

```text
http://localhost:3000
```

Para crear un enlace publico temporal:

```powershell
npm run public
```

El comando mostrara una URL publica y tambien la guardara en `public-url.txt`.

Si LocalTunnel falla, usa Cloudflare Tunnel:

```powershell
npm run public:cloudflare
```

## Como compartir el link

Si abres el juego como `http://localhost:3000`, ese link solo sirve en tu computadora.

Para personas en la misma WiFi, usa el campo `Link para misma WiFi` que aparece en la pantalla del anfitrion. Tiene una forma parecida a:

```text
http://192.168.1.25:3000/play.html?room=...
```

Si quieres que entren personas desde otra casa o por internet, necesitas publicar el servidor en un hosting o usar un tunel como Cloudflare Tunnel, ngrok, LocalTunnel, Railway, Render o Fly.io.

Cuando tengas una URL publica, inicia el servidor asi para que el juego genere enlaces publicos:

```powershell
$env:PUBLIC_URL="https://tu-dominio-o-tunel.com"
npm start
```

En Linux/macOS:

```bash
PUBLIC_URL="https://tu-dominio-o-tunel.com" npm start
```

## Flujo del juego

1. El anfitrion crea una sala.
2. La app genera un link privado para el anfitrion y un link publico para jugadores.
3. Cada jugador entra con su nombre y recibe un carton unico.
4. El anfitrion canta numeros con el boton `Sacar numero`.
5. Los jugadores marcan su carton y presionan `Cantar bingo`.
6. El servidor valida si la linea, columna o diagonal es correcta.

## Capacidad

La app esta pensada para aguantar mas de 300 personas por sala usando Server-Sent Events, que mantiene una conexion liviana por jugador. En esta primera version el estado vive en memoria del servidor; para produccion conviene agregar:

- Redis para compartir salas entre varios servidores.
- Base de datos para guardar partidas y premios.
- Autenticacion del anfitrion.
- Proxy HTTPS con Nginx, Caddy, Render, Railway, Fly.io o similar.

## Archivos principales

- `server.js`: servidor Node, API, salas, cartones, eventos en vivo y validacion de bingo.
- `public/index.html`: pantalla para crear sala.
- `public/host.html`: pantalla del anfitrion.
- `public/play.html`: pantalla de jugadores.
- `public/app.js`: logica del navegador.
- `public/styles.css`: diseno visual responsive.
