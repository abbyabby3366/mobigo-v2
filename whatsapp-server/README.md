# Mobigo WhatsApp Server

Standalone WhatsApp microservice for Mobigo DocuSeal, powered by [Baileys](https://github.com/JonathanChuahE-Jay/Baileys) and Redis Cloud for persistent session authentication.

## Features

- **Redis Session Storage**: Keeps your WhatsApp session logged in across container restarts and cloud redeployments.
- **Outbound Messaging**: Send text messages, documents, PDFs, and images to any customer on WhatsApp via simple REST APIs.
- **Inbound Action Handling**: Automatically receive incoming files and customer documents from WhatsApp, download them, and create DocuSeal submissions.
- **DocuSeal Webhooks**: Receive completion webhooks from DocuSeal and automatically forward completed signed PDFs to the customer's WhatsApp.
- **Universal Deployment**: Run locally using Docker Compose or deploy directly to Render as a standalone Docker Web Service.

---

## Environment Variables (`.env`)

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP Server port | `4000` |
| `REDIS_HOST` | Redis host for session auth | Required for cloud persistence |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis auth password | - |
| `DOCUSEAL_API_URL` | DocuSeal backend URL | `http://app:3000` (Docker) or `http://localhost:3000` |
| `DOCUSEAL_API_KEY` | DocuSeal API Token | Set in Mobigo settings |
| `DOCUSEAL_DEFAULT_TEMPLATE_ID` | Default template ID for auto-submissions | Optional |
| `DEFAULT_SESSION_ID` | Session identifier | `mobigo_main` |
| `ADMIN_NOTIFY_PHONE` | Admin phone number for alerts (e.g., `60123456789`) | Optional |

---

## API Endpoints

### 1. WhatsApp Pairing & Status
- **`GET /api/session/qr`**: Visual web page to scan the WhatsApp pairing QR code in browser.
- **`GET /api/session/status`**: Returns current connection status (`DISCONNECTED`, `STARTING`, `QR_READY`, `CONNECTED`).
- **`POST /api/session/start`**: Re-initializes WhatsApp socket.
- **`POST /api/session/logout`**: Logs out and clears session keys from Redis.

### 2. Messaging & File Transfer
- **`POST /api/messages/send-text`**:
  ```json
  {
    "to": "60123456789",
    "text": "Hello from Mobigo!"
  }
  ```
- **`POST /api/messages/send-document`**:
  *(Supports JSON with `url` or `multipart/form-data` with `file`)*
  ```json
  {
    "to": "60123456789",
    "url": "https://example.com/agreement.pdf",
    "fileName": "Contract.pdf",
    "caption": "Please find your contract attached."
  }
  ```
- **`POST /api/messages/send-image`**:
  ```json
  {
    "to": "60123456789",
    "url": "https://example.com/photo.jpg",
    "caption": "Your document preview"
  }
  ```
- **`POST /api/messages/send-submission`**:
  Generates a DocuSeal submission and sends the signing link via WhatsApp:
  ```json
  {
    "to": "60123456789",
    "template_id": 1,
    "name": "Customer Name"
  }
  ```

### 3. DocuSeal Webhook Callback
- **`POST /api/webhooks/docuseal`**: Receives `submission.completed` event from DocuSeal and forwards the final signed PDF to the customer.

---

## Deployment to Render

1. Create a new **Web Service** in Render.
2. Select your repository.
3. Configure settings:
   - **Root Directory**: `whatsapp-server`
   - **Runtime**: `Docker`
   - **Dockerfile Path**: `./Dockerfile`
4. Add your Environment Variables (`REDIS_HOST`, `REDIS_PASSWORD`, `DOCUSEAL_API_URL`, `DOCUSEAL_API_KEY`).
