const { writeFileSync } = require("fs");
const localtunnel = require("localtunnel");
const { server } = require("./server");

const PORT = Number(process.env.PORT || 3000);

async function main() {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port: PORT, host: "0.0.0.0", backlog: 1024 }, resolve);
  });

  const tunnel = await localtunnel({ port: PORT });
  process.env.PUBLIC_URL = tunnel.url;
  writeFileSync("public-url.txt", `${tunnel.url}\n`, "utf8");

  console.log(`Bingo Virtual local:  http://localhost:${PORT}`);
  console.log(`Bingo Virtual publico: ${tunnel.url}`);
  console.log("Deja esta ventana abierta mientras dure el juego.");

  tunnel.on("close", () => {
    console.log("El tunel publico se cerro.");
    server.close();
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
