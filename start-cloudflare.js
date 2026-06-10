const { spawn } = require("child_process");
const { existsSync, writeFileSync } = require("fs");
const path = require("path");
const { server } = require("./server");

const PORT = Number(process.env.PORT || 3000);
const cloudflared = path.join(__dirname, "cloudflared.exe");

if (!existsSync(cloudflared)) {
  console.error("No se encontro cloudflared.exe. Descargalo antes de ejecutar este comando.");
  process.exit(1);
}

function startServer() {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port: PORT, host: "0.0.0.0", backlog: 1024 }, resolve);
  });
}

async function main() {
  await startServer();
  const tunnel = spawn(cloudflared, ["tunnel", "--url", `http://127.0.0.1:${PORT}`], {
    cwd: __dirname,
    windowsHide: true
  });

  console.log(`Bingo Virtual local: http://localhost:${PORT}`);
  console.log("Creando enlace publico con Cloudflare Tunnel...");

  const handleOutput = (chunk) => {
    const text = chunk.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match) {
      process.env.PUBLIC_URL = match[0];
      writeFileSync("public-url.txt", `${match[0]}\n`, "utf8");
      console.log(`Bingo Virtual publico: ${match[0]}`);
      console.log("Deja esta ventana abierta mientras dure el juego.");
    }
  };

  tunnel.stdout.on("data", handleOutput);
  tunnel.stderr.on("data", handleOutput);
  tunnel.on("exit", (code) => {
    console.log(`Cloudflare Tunnel se cerro con codigo ${code}.`);
    server.close();
    process.exit(code || 0);
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
