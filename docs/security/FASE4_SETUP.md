# Fase 4 — setup manual en GitHub (15 min)

Lo que viene en repo (workflows) ya está. Acá va lo que **no puedo configurar yo**
porque está en la UI de GitHub o necesita tokens que vos generás.

## 1. Secret `ANTHROPIC_API_KEY` (para `security-review.yml`)

El workflow `claude-review` usa la API de Anthropic para hacer el review
semántico en cada PR. Necesita una key propia, **no** la que uses en Claude Code
localmente — es una key de billing.

1. Ir a <https://console.anthropic.com/> → API Keys → **Create Key**.
2. Nombrarla `github-actions-tallyfinance`.
3. GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**.
4. Name: `ANTHROPIC_API_KEY`, Value: la key.

Sin esta secret, el job `claude-review` falla al primer PR. El job `semgrep` sigue
corriendo (no depende de Anthropic).

## 2. Dependabot (items Fase 0 pendiente)

GitHub → repo → **Settings → Code security and analysis** → activar:

- **Dependabot alerts** → On
- **Dependabot security updates** → On
- **Dependabot version updates** → requiere config file

Crear `.github/dependabot.yml` (te lo dejo como plantilla abajo si lo querés hoy,
sino lo hacemos cuando arrancemos Fase 6).

```yaml
# .github/dependabot.yml (opcional, activar cuando esté listo)
version: 2
updates:
  - package-ecosystem: npm
    directory: /backend
    schedule: { interval: weekly, day: monday }
    open-pull-requests-limit: 5
    groups:
      security-patches: { applies-to: security-updates, patterns: ['*'] }
  - package-ecosystem: npm
    directory: /frontend_TallyFinance
    schedule: { interval: weekly, day: monday }
    open-pull-requests-limit: 5
    groups:
      security-patches: { applies-to: security-updates, patterns: ['*'] }
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly, day: monday }
```

## 3. CodeQL (opcional, recomendado)

GitHub ofrece CodeQL gratis para repos públicos o con GitHub Advanced Security
para privados.

Settings → Code security → **CodeQL analysis** → Set up → Default.

Si tu plan no lo incluye, salteá esto — Semgrep cubre el espacio rule-based.

## 4. Branch protection en `main`

Settings → Branches → Add branch protection rule:

- Branch name pattern: `main`
- **Require a pull request before merging** ✅
  - Require approvals: **1**
  - Dismiss stale reviews when new commits are pushed: ✅
- **Require status checks to pass before merging** ✅
  - Buscar y marcar:
    - `Claude Code Security Review`
    - `Semgrep SAST`
    - (cuando tengas CI de build: `Build backend`, `Build frontend`)
  - Require branches to be up to date before merging: ✅
- **Require conversation resolution before merging** ✅
- **Do not allow bypassing the above settings** ✅ (incluye admins)
- **Restrict who can push to matching branches**: sin force-push, sin delete.

Justificación ISO: control A.8.32 (change management) requiere peer review
documentado. Sin branch protection, cualquiera con push accede a `main` sin
pasar por PR — no hay trazabilidad.

## 5. Permisos del token `GITHUB_TOKEN` en Actions

Settings → Actions → General → **Workflow permissions**:

- Seleccionar **Read and write permissions** (necesario para `sbom.yml` que hace
  commit, y para `dependency-audit.yml` que abre issues).
- Marcar **Allow GitHub Actions to create and approve pull requests** (para
  futuros Dependabot auto-merges si los activás).

## 6. Verificación (después de configurar 1-5)

1. Abrir un PR dummy (ej. typo en un comentario). Esperar a que corran los jobs.
2. Ver en la tab **Checks** del PR que aparezcan:
   - Claude Code Security Review
   - Semgrep SAST
3. Merge solo debería habilitarse si ambos pasan + review aprobada.
4. Correr manualmente `Dependency Audit` vía Actions → workflow_dispatch para
   verificar que abre issue correctamente (o no, si todo está limpio).
5. Correr `SBOM` manualmente vía workflow_dispatch. Verificar que `docs/SBOM/`
   recibe dos archivos nuevos con la fecha de hoy.

## 7. Costos esperados

| Concepto | Costo mensual aproximado |
|---|---|
| Claude API review en cada PR | ~$0.20–1.00/PR (Opus Sonnet) |
| Semgrep Cloud | $0 (CLI only, self-hosted en Actions) |
| GitHub Actions minutos | dentro del free tier de public/private con 2000 min/mes |
| SBOM commits | $0 |
| Dependabot | $0 |

En un repo de tu volumen (2 devs, pocos PRs/semana), el costo total ronda
$5–15/mes, principalmente API Anthropic.

## 8. Cuando activar qué

Orden sugerido:

1. **Hoy** — cargar `ANTHROPIC_API_KEY` y activar Workflow permissions (paso 1 + 5).
2. **Abrir un PR dummy** — verificar que los 2 jobs corren.
3. **Activar Dependabot alerts + security updates** (paso 2, sin el YAML opcional).
4. **Branch protection sobre `main`** (paso 4) — solo después de confirmar que
   los checks corren sin errores. Si los activás antes y el workflow falla por
   tema de secret o perms, no podés mergear nada ni para arreglar el workflow.
5. **Cuando el workflow esté estable por 1 semana**: activar Dependabot version
   updates (YAML del paso 2).
