import express, { Request, Response } from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

const app = express();
app.use(cors());

// Health check para Google Cloud Run
app.get("/", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "Google Cloud MCP Server",
    endpoints: {
      sse: "/sse",
      health: "/health"
    }
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).send("OK");
});

// Inicializar Servidor MCP
const mcpServer = new McpServer({
  name: "google-cloud-mcp-server",
  version: "1.0.0"
});

// Herramienta 1: Información del servicio en la nube
mcpServer.tool(
  "obtener_info_cloud",
  "Devuelve información del estado del servidor MCP y entorno Cloud Run",
  {},
  async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "Online",
            platform: "Google Cloud Run",
            nodeVersion: process.version,
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || "production"
          }, null, 2)
        }
      ]
    };
  }
);

// Herramienta 2: Ejecutar cálculo / utilidad personalizada
mcpServer.tool(
  "procesar_texto",
  "Herramienta de ejemplo para procesar y transformar texto en Cloud Run",
  {
    texto: z.string().describe("El texto de entrada a procesar"),
    operacion: z.enum(["mayusculas", "minusculas", "contar_palabras"]).describe("Operación a realizar")
  },
  async ({ texto, operacion }) => {
    let resultado = "";
    if (operacion === "mayusculas") {
      resultado = texto.toUpperCase();
    } else if (operacion === "minusculas") {
      resultado = texto.toLowerCase();
    } else if (operacion === "contar_palabras") {
      const cantidad = texto.trim().split(/\s+/).filter(Boolean).length;
      resultado = `Total de palabras: ${cantidad}`;
    }

    return {
      content: [
        {
          type: "text",
          text: `[Cloud Run MCP]: ${resultado}`
        }
      ]
    };
  }
);

// Registro de transportes SSE activos
const transports = new Map<string, SSEServerTransport>();

// Endpoint SSE: Antigravity y otros clientes se conectan aquí
app.get("/sse", async (req: Request, res: Response) => {
  console.log(`[${new Date().toISOString()}] Nueva conexión SSE establecida`);
  
  // Endpoint donde el cliente enviará mensajes POST
  const transport = new SSEServerTransport("/messages", res);
  transports.set(transport.sessionId, transport);

  res.on("close", () => {
    console.log(`[${new Date().toISOString()}] Conexión SSE cerrada para sesión: ${transport.sessionId}`);
    transports.delete(transport.sessionId);
  });

  await mcpServer.connect(transport);
});

// Endpoint Messages: Recibe peticiones JSON-RPC del cliente
app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).send("Sesión no encontrada o expirada");
  }
});

const PORT = parseInt(process.env.PORT || "8080", 10);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`=============================================`);
  console.log(` Google Cloud MCP Server escuchando en puerto ${PORT}`);
  console.log(` SSE Endpoint: http://0.0.0.0:${PORT}/sse`);
  console.log(`=============================================`);
});
