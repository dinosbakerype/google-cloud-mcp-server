import express, { Request, Response } from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { InstancesClient } from "@google-cloud/compute";
import { google } from "googleapis";
import { z } from "zod";

const app = express();
app.use(cors());

const instancesClient = new InstancesClient();

const auth = new google.auth.GoogleAuth({
  scopes: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.readonly"
  ]
});
const drive = google.drive({ version: "v3", auth });

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
  version: "1.3.0"
});

// ==========================================
// SECCIÓN 1: GOOGLE DRIVE TOOLS
// ==========================================

// Herramienta: Listar y buscar archivos en Google Drive
mcpServer.tool(
  "buscar_archivos_drive",
  "Busca archivos y carpetas en Google Drive por nombre, tipo o contenido",
  {
    busqueda: z.string().optional().describe("Término de búsqueda o nombre de archivo (opcional)"),
    max_resultados: z.number().optional().describe("Número máximo de resultados (por defecto 10)")
  },
  async ({ busqueda, max_resultados = 10 }) => {
    try {
      let q = "trashed = false";
      if (busqueda) {
        q += ` and name contains '${busqueda.replace(/'/g, "\\'")}'`;
      }

      const res = await drive.files.list({
        q: q,
        pageSize: max_resultados,
        fields: "files(id, name, mimeType, size, modifiedTime, webViewLink, owners)"
      });

      const files = res.data.files || [];
      if (files.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No se encontraron archivos en Google Drive con esos criterios. Asegúrate de haber compartido la carpeta o archivo con la cuenta de servicio de Google Cloud: 922428032361-compute@developer.gserviceaccount.com"
            }
          ]
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              total_encontrados: files.length,
              archivos: files.map(f => ({
                id: f.id,
                nombre: f.name,
                tipo: f.mimeType,
                tamano_bytes: f.size || "N/A",
                ultima_modificacion: f.modifiedTime,
                enlace: f.webViewLink
              }))
            }, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error al consultar Google Drive: ${error.message || error}`
          }
        ],
        isError: true
      };
    }
  }
);

// Herramienta: Leer contenido de un archivo de Google Drive
mcpServer.tool(
  "leer_archivo_drive",
  "Lee el contenido de texto de un archivo o documento de Google Drive usando su File ID",
  {
    file_id: z.string().describe("ID del archivo en Google Drive")
  },
  async ({ file_id }) => {
    try {
      const fileMeta = await drive.files.get({
        fileId: file_id,
        fields: "id, name, mimeType"
      });

      const mimeType = fileMeta.data.mimeType || "";

      // Si es Google Docs, exportar como texto plano
      if (mimeType === "application/vnd.google-apps.document") {
        const exportRes = await drive.files.export({
          fileId: file_id,
          mimeType: "text/plain"
        });
        return {
          content: [
            {
              type: "text",
              text: `[Google Doc: ${fileMeta.data.name}]\n\n${exportRes.data}`
            }
          ]
        };
      }

      // Si es Google Sheets, exportar como CSV
      if (mimeType === "application/vnd.google-apps.spreadsheet") {
        const exportRes = await drive.files.export({
          fileId: file_id,
          mimeType: "text/csv"
        });
        return {
          content: [
            {
              type: "text",
              text: `[Google Sheet (CSV): ${fileMeta.data.name}]\n\n${exportRes.data}`
            }
          ]
        };
      }

      // Archivo binario o de texto estándar
      const getRes = await drive.files.get({
        fileId: file_id,
        alt: "media"
      });

      return {
        content: [
          {
            type: "text",
            text: `[Archivo: ${fileMeta.data.name}]\n\n${typeof getRes.data === "string" ? getRes.data : JSON.stringify(getRes.data, null, 2)}`
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error al leer archivo de Google Drive: ${error.message || error}`
          }
        ],
        isError: true
      };
    }
  }
);

// ==========================================
// SECCIÓN 2: COMPUTE ENGINE TOOLS
// ==========================================

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

// ==========================================
// SECCIÓN 3: SERVICIOS Y UTILIDADES
// ==========================================

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
