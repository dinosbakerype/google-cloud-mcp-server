import express, { Request, Response } from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { InstancesClient } from "@google-cloud/compute";
import { z } from "zod";

const app = express();
app.use(cors());

const instancesClient = new InstancesClient();

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
  version: "1.2.0"
});

// Herramienta 1: Listar Máquinas Virtuales de Google Compute Engine
mcpServer.tool(
  "listar_maquinas_virtuales",
  "Lista todas las instancias de máquinas virtuales (Compute Engine VMs) en el proyecto de Google Cloud",
  {},
  async () => {
    try {
      const projectId = await instancesClient.getProjectId();
      const vms: any[] = [];
      const iterable = instancesClient.aggregatedListAsync({ project: projectId });

      for await (const [zone, response] of iterable) {
        if (response.instances) {
          for (const instance of response.instances) {
            const networkInterfaces = instance.networkInterfaces || [];
            const ipInterna = networkInterfaces[0]?.networkIP || "N/A";
            const ipExterna = networkInterfaces[0]?.accessConfigs?.[0]?.natIP || "Sin IP externa";
            const machineType = instance.machineType ? instance.machineType.split("/").pop() : "N/A";
            const zoneName = zone.replace("zones/", "");

            vms.push({
              nombre: instance.name,
              zona: zoneName,
              estado: instance.status || "DESCONOCIDO",
              tipo_maquina: machineType,
              ip_interna: ipInterna,
              ip_externa: ipExterna,
              fecha_creacion: instance.creationTimestamp || "N/A"
            });
          }
        }
      }

      if (vms.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Proyecto GCP: "${projectId}". No se encontraron máquinas virtuales creadas en ninguna zona.`
            }
          ]
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              proyecto: projectId,
              total_vms: vms.length,
              maquinas_virtuales: vms
            }, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error al consultar Compute Engine: ${error.message || error}`
          }
        ],
        isError: true
      };
    }
  }
);

// Herramienta 2: Obtener detalles completos de una VM (Metadata, Discos, Tags, etc.)
mcpServer.tool(
  "obtener_detalles_vm",
  "Obtiene la configuración detallada, discos, etiquetas, metadatos y sistema operativo de una VM",
  {
    nombre: z.string().describe("Nombre de la máquina virtual (ej: vps0dinosbakery)"),
    zona: z.string().describe("Zona de la máquina virtual (ej: us-central1-b)")
  },
  async ({ nombre, zona }) => {
    try {
      const projectId = await instancesClient.getProjectId();
      const [instance] = await instancesClient.get({
        project: projectId,
        zone: zona,
        instance: nombre
      });

      const discos = (instance.disks || []).map((d: any) => ({
        nombre: d.deviceName,
        tamano_gb: d.diskSizeGb,
        tipo: d.type,
        boot: d.boot,
        licencias: d.licenses?.map((l: string) => l.split("/").pop())
      }));

      const metadatos: Record<string, string> = {};
      if (instance.metadata?.items) {
        for (const item of instance.metadata.items) {
          if (item.key && item.value) {
            metadatos[item.key] = item.value;
          }
        }
      }

      const networkInterfaces = instance.networkInterfaces || [];

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              nombre: instance.name,
              id: instance.id,
              descripcion: instance.description || "Sin descripción",
              estado: instance.status,
              zona: zona,
              tipo_maquina: instance.machineType?.split("/").pop(),
              ip_interna: networkInterfaces[0]?.networkIP,
              ip_externa: networkInterfaces[0]?.accessConfigs?.[0]?.natIP,
              tags_red: instance.tags?.items || [],
              etiquetas_labels: instance.labels || {},
              discos: discos,
              metadatos: metadatos,
              service_accounts: instance.serviceAccounts?.map((s: any) => s.email)
            }, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error obteniendo detalles de ${nombre}: ${error.message || error}`
          }
        ],
        isError: true
      };
    }
  }
);

// Herramienta 3: Información del servicio en la nube
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

// Herramienta 4: Procesar texto
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

const transports = new Map<string, SSEServerTransport>();

app.get("/sse", async (req: Request, res: Response) => {
  console.log(`[${new Date().toISOString()}] Nueva conexión SSE establecida`);
  
  const transport = new SSEServerTransport("/messages", res);
  transports.set(transport.sessionId, transport);

  res.on("close", () => {
    console.log(`[${new Date().toISOString()}] Conexión SSE cerrada para sesión: ${transport.sessionId}`);
    transports.delete(transport.sessionId);
  });

  await mcpServer.connect(transport);
});

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
  console.log(`Google Cloud MCP Server escuchando en puerto ${PORT}`);
});
