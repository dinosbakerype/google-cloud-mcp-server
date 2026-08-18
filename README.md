# Google Cloud Run MCP Server (SSE)

Servidor MCP (*Model Context Protocol*) con transporte **SSE (Server-Sent Events)** listo para ser desplegado en **Google Cloud Run** y conectado a **Antigravity**.

---

## 📁 Estructura del Proyecto

```
mcp-cloud-run/
├── src/
│   └── server.ts         # Implementación del servidor MCP y endpoints SSE
├── Dockerfile            # Configuración Docker optimizada para Cloud Run
├── package.json          # Dependencias y scripts
├── tsconfig.json         # Configuración de TypeScript
├── .dockerignore
├── .gitignore
└── README.md
```

---

## 🚀 Despliegue en Google Cloud Run

### Opción 1: Desde GitHub (Cloud Console)
1. Sube este repositorio a tu cuenta de **GitHub**.
2. En Google Cloud Console, ve a **Cloud Run** > **Crear Servicio**.
3. Selecciona **Implementar de forma continua desde un repositorio**.
4. Conecta tu cuenta de GitHub y selecciona este repositorio (`main`).
5. En tipo de compilación, elige **Dockerfile**.
6. En **Autenticación**, selecciona **Permitir invocaciones no autenticadas**.
7. Haz clic en **Crear**.

### Opción 2: Desde Terminal (gcloud)
```bash
gcloud run deploy google-cloud-mcp-server \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080
```

---

## 🔌 Conexión en Antigravity

Una vez desplegado tu servicio, añade la URL con `/sse` a tu archivo `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "google-cloud-run": {
      "serverUrl": "https://TU-SERVICIO-CLOUD-RUN.a.run.app/sse"
    }
  }
}
```
