# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TallyFinance is a personal finance assistant operating through Telegram and WhatsApp. The system follows a two-phase AI orchestration pattern where:

- **Backend (NestJS)** executes database operations and tool handlers
- **AI Service (FastAPI)** analyzes intent and generates personalized responses

**Core Principle:** "Backend ejecuta, IA entiende/decide/comunica"

## Architecture

```
User Message → Channel Adapter → Backend → Phase A (AI) → Tool Handler → Phase B (AI) → Response
```

### Services

| Service | Port | Technology | Purpose |
|---------|------|------------|---------|
| Backend | 3000 | NestJS/TypeScript | Webhooks, DB operations, tool execution |
| AI Service | 8000 | FastAPI/Python | Intent analysis, response generation |
| Frontend | 5173 | React/Vite | Web dashboard, account linking |
| Redis | 6379 | Redis | Caching, rate limiting |

### Two-Phase AI Orchestration

**Phase A (Intent Analysis):** Analyzes user message, returns `tool_call`, `clarification`, or `direct_reply`. Uses OpenAI gpt-4o-mini with temp=0.3, JSON mode.

**Phase B (Response Generation):** Takes tool result and generates personalized message based on user personality (tone/intensity/mood). Uses temp=0.7, text mode.

### Tool System (7 handlers in `backend-API_TallyFinance/src/bot/tools/handlers/`)

| Tool | Requires Context | Purpose |
|------|------------------|---------|
| `register_transaction` | Yes | Record expenses/income |
| `ask_balance` | Yes | Query spending & budget |
| `ask_budget_status` | Yes | Check budget configuration |
| `ask_goal_status` | Yes | Query goals progress |
| `ask_app_info` | No | Answer app questions (has knowledge base) |
| `greeting` | No | Handle greetings |
| `unknown` | No | Fallback handler |

## Build and Development Commands

### Backend (NestJS)
```bash
cd backend-API_TallyFinance
npm install
npm run start:dev      # Watch mode
npm run build          # Compile TypeScript
npm run lint           # ESLint with auto-fix
npm run test           # Jest unit tests
npm run test:watch     # Watch mode
npm run test:e2e       # End-to-end tests
```

### AI Service (FastAPI)
```bash
cd ai-service_TallyFinane
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (React/Vite)
```bash
cd frontend_TallyFinance
npm install
npm run dev            # Dev server on 5173
npm run build          # Production build
npm run lint           # ESLint
```

### Docker (Full Stack)
```bash
docker-compose up --build
# Services: redis:6379, ai-service:8000, backend:3000, ngrok:4040
```

### Testing Endpoints
```bash
# Health checks
curl http://localhost:8000/health
curl http://localhost:3000/

# Test bot (simulates message)
curl -X POST http://localhost:3000/bot/test \
  -H "Content-Type: application/json" \
  -d '{"channel":"test","externalId":"user-123","text":"gasté 15 lucas en comida"}'
```

## Key File Locations

### Backend
- Entry: `backend-API_TallyFinance/src/main.ts`
- Bot orchestration: `src/bot/bot.service.ts`
- Tool handlers: `src/bot/tools/handlers/*.tool-handler.ts`
- Tool registry: `src/bot/tools/tool-registry.ts`
- AI client: `src/bot/services/orchestrator.client.ts`
- Resilience utilities: `src/common/utils/resilience.ts`
- Channel adapters: `src/bot/adapters/`

### AI Service
- Entry/routes: `ai-service_TallyFinane/app.py`
- Orchestrator: `orchestrator.py`
- Prompts: `prompts/phase_a_system.txt`, `prompts/phase_b_system.txt`
- Tool schemas: `tool_schemas.py`

### Frontend
- Pages: `frontend_TallyFinance/src/pages/`
- Components: `src/components/`
- API client: `src/lib/apiClient.js`
- Hooks: `src/hooks/`

## Adding a New Tool Handler

1. Create handler in `src/bot/tools/handlers/` implementing `ToolHandler`:

```typescript
export class MyToolHandler implements ToolHandler {
  readonly name = 'my_tool';
  readonly schema: ToolSchema = {
    name: 'my_tool',
    description: 'Description for AI',
    parameters: { type: 'object', properties: {}, required: [] },
  };
  readonly requiresContext = true; // or false

  async execute(userId: string, msg: DomainMessage, args: Record<string, unknown>): Promise<ActionResult> {
    return { ok: true, action: 'my_tool', data: {} };
  }
}
```

2. Register in `ToolRegistry` constructor
3. Add stub response in `OrchestratorClient.stubPhaseB()` for offline fallback

## Database (Supabase)

Core tables: `users`, `user_prefs`, `personality_snapshot`, `channel_accounts`, `transactions`, `categories`, `payment_method`, `goals`, `spending_expectations`

Key enums:
- `bot_tone_enum`: neutral, friendly, serious, motivational, strict
- `bot_mood_enum`: normal, happy, disappointed, tired, hopeful, frustrated, proud
- `channel_t`: telegram, whatsapp, web

## Resilience Patterns

- **Rate Limiting:** 30 msgs/min per user (in `bot.controller.ts`)
- **Circuit Breaker:** Opens after 5 failures, 30s cooldown, fallback to stub mode
- **User Context Cache:** 60s TTL to reduce Supabase queries
- **Stub Mode:** Pattern-matching fallback when AI service unavailable

## Environment Variables

### Backend (.env)
```
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
AI_SERVICE_URL=http://localhost:8000
TELEGRAM_BOT_TOKEN, TELEGRAM_SECRET
WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID
CORS_ORIGINS, LINK_ACCOUNT_URL
DISABLE_AI=0  # Set to 1 for maintenance
```

### AI Service (.env)
```
OPENAI_API_KEY
OPENAI_MODEL=gpt-4o-mini
OPENAI_TIMEOUT=25.0
OPENAI_TEMPERATURE_PHASE_A=0.3
OPENAI_TEMPERATURE_PHASE_B=0.7
```

## Detailed Documentation

See `docs/SYSTEM_ARCHITECTURE.md` for complete architecture reference including message flow diagrams, tool handler specifications, and database schema details.

Service-specific guidance:
- `backend-API_TallyFinance/CLAUDE.md`
- `ai-service_TallyFinane/CLAUDE.md`

---

## Frontend Design System (SIEMPRE SEGUIR)

### Archivos de Referencia
Antes de modificar frontend, revisar:
- `src/pages/dashboard/components/DashboardLayout.jsx` - Layout principal
- `src/pages/dashboard/components/AppNavbar.jsx` - Navegación
- `src/components/Button.jsx` - Botones
- `tailwind.config.js` - Colores y configuración

### Colores de Marca
```
brand-primary: #0364c6    (azul principal - CTAs)
brand-primaryDark: #023a7e (texto principal)
brand-accent: #3B82F6     (hover states)
brand-border: #BFDBFE     (bordes)
brand-tint: #DBEAFE       (backgrounds sutiles)
```

### Tipografía
- **Font:** Goldplay (weights 200-900)
- **Títulos:** `text-2xl font-bold text-slate-900` o `font-black text-brand-primaryDark`
- **Subtítulos:** `text-lg font-semibold text-slate-900`
- **Body:** `text-sm text-slate-600` o `text-base font-medium`
- **Labels:** `text-xs font-medium text-slate-500`
- **Links:** `text-sm font-medium text-blue-600 hover:text-blue-800`

### Componentes

**Botones:**
```jsx
// Primario
className="rounded-full bg-brand-primary px-6 py-3 text-base font-black text-white shadow-cta hover:bg-brand-accent"

// Secundario
className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"

// Ghost
className="text-sm font-medium text-blue-600 hover:text-blue-800"
```

**Cards:**
```jsx
className="rounded-2xl border border-brand-border/40 bg-white/90 p-6 shadow-lg shadow-brand-border/20 backdrop-blur md:rounded-3xl md:p-8"
```

**Inputs:**
```jsx
className="w-full rounded-xl border border-brand-tint/60 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 focus:border-brand-highlight focus:ring-2 focus:ring-brand-border md:rounded-2xl md:px-5 md:py-4 md:text-lg"
```

**Tables:**
```jsx
// Container
className="overflow-hidden rounded-xl border border-slate-200 bg-white"

// Header
className="bg-slate-50"
<th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">

// Rows
className="hover:bg-slate-50"
<td className="px-4 py-3 text-sm text-slate-900">
```

### Backgrounds
```jsx
// Página principal
className="bg-gradient-to-b from-white via-[#f5f8ff] to-[#e0eaff]"

// Mobile
className="bg-white"

// Cards transparentes
className="bg-white/90 backdrop-blur"
```

### Border Radius
- **Botones:** `rounded-full` (pill) o `rounded-lg`
- **Cards:** `rounded-2xl` → `md:rounded-3xl`
- **Inputs:** `rounded-xl` → `md:rounded-2xl`
- **Chips:** `rounded-xl`

### Shadows
```
shadow-sm shadow-brand-border/20   (sutil)
shadow-lg shadow-brand-border/30   (cards)
shadow-xl shadow-brand-border/20   (modals)
shadow-cta                          (botones primarios)
```

### Responsive (3 vistas)
```
Mobile (base):     px-4, py-2.5, text-sm, rounded-xl
Tablet (md:):      px-5, py-4, text-lg, rounded-2xl
Desktop (lg:):     px-6, py-5, más espaciado
```

### Layout para Páginas Autenticadas
```jsx
import DashboardLayout from '../dashboard/components/DashboardLayout'
import { useAdminGuard } from '../../hooks/useAdminGuard'

const MiPagina = () => {
  const { user, logout } = useAuthSession()

  return (
    <DashboardLayout
      displayName={user?.fullName}
      subtitle={user?.email}
      onLogout={logout}
      isAdmin={isAdmin}
    >
      {/* Contenido */}
    </DashboardLayout>
  )
}
```

### NUNCA hacer
- Usar colores hex directos (usar clases de Tailwind/brand)
- Crear estilos inline
- Ignorar responsive (`md:` y `lg:`)
- Usar border-radius inconsistentes
- Olvidar hover/focus states
