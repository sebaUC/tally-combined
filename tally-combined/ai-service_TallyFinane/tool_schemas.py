from __future__ import annotations

from typing import List

from schemas import ToolSchema, ToolSchemaParameter, ToolSchemaParameters


"""
Tool schemas for V1.
These define what the AI can extract from user messages.

IMPORTANT: Field names here are what AI returns. The NestJS backend
maps these to actual Supabase columns:

AI Field          -> Supabase Column
-----------------------------------------
amount            -> transactions.amount
category          -> categories.name (lookup -> category_id)
posted_at         -> transactions.posted_at
payment_method    -> payment_method.name (lookup -> payment_method_id)
description       -> transactions.description
"""


TOOL_SCHEMAS: List[ToolSchema] = [
    ToolSchema(
        name="ask_app_info",
        description=(
            "Responde CUALQUIER pregunta sobre TallyFinance, el bot, sus funcionalidades, "
            "como usarlo, limitaciones, o informacion general. Usa esto para ayuda/meta/preguntas sobre la app."
        ),
        parameters=ToolSchemaParameters(
            properties={
                "userQuestion": ToolSchemaParameter(
                    type="string",
                    description="La pregunta original del usuario tal como la formulo",
                ),
                "suggestedTopic": ToolSchemaParameter(
                    type="string",
                    description=(
                        "Tema sugerido: capabilities, how_to, limitations, channels, getting_started, "
                        "about, security, pricing, other"
                    ),
                ),
            },
            required=["userQuestion"],
        ),
    ),
    ToolSchema(
        name="register_transaction",
        description="Registra un gasto o ingreso del usuario en su cuenta",
        parameters=ToolSchemaParameters(
            properties={
                "amount": ToolSchemaParameter(
                    type="number",
                    description="Monto de la transaccion en CLP (pesos chilenos). Siempre positivo y mayor a 0. NUNCA enviar 0.",
                ),
                "category": ToolSchemaParameter(
                    type="string",
                    description=(
                        "Nombre de la categoria tal como la identifica el usuario. "
                        "Mapear a categorías existentes cuando sea posible (ej: uber → Transporte). "
                        "Si no existe una categoría adecuada, enviar el nombre que dijo el usuario. "
                        "Para type='income' (ingresos) NO enviar este campo."
                    ),
                ),
                "posted_at": ToolSchemaParameter(
                    type="string",
                    description="Fecha de la transaccion en formato ISO-8601 (YYYY-MM-DD). Si no se especifica, usar fecha de hoy.",
                ),
                "description": ToolSchemaParameter(
                    type="string",
                    description="Descripcion opcional del gasto (ej: almuerzo con amigos, uber al trabajo)",
                ),
                "type": ToolSchemaParameter(
                    type="string",
                    description=(
                        "Tipo: 'expense' (default), 'income' (sueldo, pago recibido, venta), "
                        "o 'balance_set' (setear balance de cuenta — cuando el usuario dice cuánto tiene, "
                        "ej: 'tengo 500 mil en mi cuenta', 'mi saldo es 300 mil', 'ajusta mi balance a 100 mil'). "
                        "'balance_set' NO crea transacción, solo actualiza el saldo de la cuenta."
                    ),
                ),
                "name": ToolSchemaParameter(
                    type="string",
                    description=(
                        "Nombre breve e indicativo de la transaccion. SIEMPRE enviar. "
                        "FORMATO: 2-4 palabras, Title Case, sin articulos (el/la/un/una), sin monto. "
                        "PATRONES por contexto: "
                        "Comida/Resto → [Ocasion o Lugar]: 'Almuerzo Trabajo', 'Cena Cumpleanos', 'Sushi Delivery', 'Cafe Reunion'. "
                        "Transporte → [Servicio Destino]: 'Uber Aeropuerto', 'Bencina Auto', 'TAG Semana'. "
                        "Streaming/Suscripciones → [Servicio]: 'Netflix', 'Spotify', 'Disney Plus'. "
                        "Servicios/Hogar → [Servicio Mes]: 'Luz Abril', 'Arriendo Mayo', 'Internet'. "
                        "Salud → [Tipo Contexto]: 'Consulta Medica', 'Farmacia Gripe', 'Gym Mensual'. "
                        "Ropa → [Tipo Uso]: 'Zapatillas Running', 'Polera Trabajo', 'Ropa Verano'. "
                        "Supermercado → [Lugar Frecuencia]: 'Super Semana', 'Jumbo Mensual'. "
                        "Ingreso sueldo → 'Sueldo [Mes]': 'Sueldo Marzo'. "
                        "Ingreso freelance → 'Freelance [Proyecto]': 'Freelance Logo', 'Freelance Web'. "
                        "Ingreso venta → 'Venta [Objeto]': 'Venta Bicicleta', 'Venta Ropa'. "
                        "Agrega mes solo cuando sea relevante (sueldos, arriendos, servicios recurrentes). "
                        "Prioriza contexto util sobre genericidad: 'Uber Trabajo' es mejor que 'Transporte'."
                    ),
                ),
            },
            required=["amount"],
        ),
    ),
    ToolSchema(
        name="manage_transactions",
        description=(
            "Gestiona transacciones existentes del usuario: listar las ultimas, "
            "editar campos (monto, categoria, descripcion, fecha), o eliminar una transaccion. "
            "Usa hints para identificar la transaccion objetivo si no tienes el ID."
        ),
        parameters=ToolSchemaParameters(
            properties={
                "operation": ToolSchemaParameter(
                    type="string",
                    description='Operacion a realizar: "list", "edit", o "delete"',
                ),
                "transaction_id": ToolSchemaParameter(
                    type="string",
                    description="UUID de la transaccion (si se conoce del historial de conversacion)",
                ),
                "hint_amount": ToolSchemaParameter(
                    type="number",
                    description="Monto aproximado para identificar la transaccion",
                ),
                "hint_category": ToolSchemaParameter(
                    type="string",
                    description="Categoria para identificar la transaccion",
                ),
                "hint_description": ToolSchemaParameter(
                    type="string",
                    description="Descripcion parcial para identificar la transaccion",
                ),
                "limit": ToolSchemaParameter(
                    type="number",
                    description="Cantidad de transacciones a listar (default 5, max 20)",
                ),
                "new_amount": ToolSchemaParameter(
                    type="number",
                    description="Nuevo monto para editar",
                ),
                "new_category": ToolSchemaParameter(
                    type="string",
                    description="Nueva categoria para editar",
                ),
                "new_description": ToolSchemaParameter(
                    type="string",
                    description="Nueva descripcion para editar",
                ),
                "new_posted_at": ToolSchemaParameter(
                    type="string",
                    description="Nueva fecha para editar (ISO-8601)",
                ),
                "choice": ToolSchemaParameter(
                    type="number",
                    description="Numero 1-based para elegir entre transacciones ambiguas",
                ),
            },
            required=["operation"],
        ),
    ),
    ToolSchema(
        name="manage_categories",
        description=(
            "Gestiona las categorias del usuario: listar todas, crear nueva, "
            "renombrar o eliminar una categoria existente."
        ),
        parameters=ToolSchemaParameters(
            properties={
                "operation": ToolSchemaParameter(
                    type="string",
                    description='Operacion: "list", "create", "rename", "delete"',
                ),
                "name": ToolSchemaParameter(
                    type="string",
                    description="Nombre de la categoria (crear, renombrar fuente, eliminar)",
                ),
                "new_name": ToolSchemaParameter(
                    type="string",
                    description="Nuevo nombre (solo para rename)",
                ),
                "icon": ToolSchemaParameter(
                    type="string",
                    description=(
                        "Emoji representativo para la categoría. "
                        "Para operation=create: OBLIGATORIO, siempre asignar uno. "
                        "Elige el emoji que MEJOR represente el concepto de la categoría. "
                        "Puedes usar CUALQUIER emoji existente — no te limites a una lista fija. "
                        "Busca el emoji más específico y semánticamente correcto. "
                        "Ej: Filosofía→🧠, Gaming→🎮, Pilates→🧘, Cerveza→🍺, "
                        "Natación→🏊, Cine→🎬, Sushi→🍣, Peluquería→💇, Dentista→🦷, "
                        "Veterinario→🐕, Lavandería→👔, Bicicleta→🚴, Parking→🅿️. "
                        "Sé creativo y preciso — el emoji debe ser reconocible al instante."
                    ),
                ),
                "parent_name": ToolSchemaParameter(
                    type="string",
                    description="Nombre de categoria padre para crear subcategoria",
                ),
                "force_delete": ToolSchemaParameter(
                    type="boolean",
                    description="Forzar eliminacion si la categoria tiene transacciones asociadas",
                ),
                "_pending_transaction": ToolSchemaParameter(
                    type="object",
                    description=(
                        "Datos de transaccion pendiente (amount, description, posted_at) "
                        "para registrar despues de crear la categoria. "
                        "Solo usar cuando el usuario confirma crear una categoria "
                        "durante un registro de transaccion pendiente."
                    ),
                ),
            },
            required=["operation"],
        ),
    ),
    ToolSchema(
        name="ask_balance",
        description=(
            "Consulta el saldo, gastos e ingresos del usuario. "
            "Soporta filtros por período, categoría y tipo. "
            "Usar cuando el usuario pregunta cuánto gastó, su balance, "
            "o consultas como 'cuánto gasté en comida esta semana'."
        ),
        parameters=ToolSchemaParameters(
            properties={
                "period": ToolSchemaParameter(
                    type="string",
                    description=(
                        "Período a consultar: 'today' (hoy), 'week' (esta semana), "
                        "'month' (este mes, default), 'custom' (rango personalizado). "
                        "Usa 'today' para 'hoy', 'week' para 'esta semana', 'month' para 'este mes'."
                    ),
                ),
                "start_date": ToolSchemaParameter(
                    type="string",
                    description="Fecha inicio ISO-8601 (solo si period='custom'). Ej: '2026-03-01'",
                ),
                "end_date": ToolSchemaParameter(
                    type="string",
                    description="Fecha fin ISO-8601 (solo si period='custom'). Ej: '2026-03-15'",
                ),
                "category": ToolSchemaParameter(
                    type="string",
                    description=(
                        "Filtrar por categoría específica. "
                        "Usar el nombre exacto de la categoría del usuario. "
                        "Ej: 'Alimentación', 'Transporte'"
                    ),
                ),
                "type": ToolSchemaParameter(
                    type="string",
                    description=(
                        "Filtrar por tipo: 'expense' (solo gastos), 'income' (solo ingresos), "
                        "'all' (ambos, default). Usar cuando el usuario especifica."
                    ),
                ),
            },
            required=[],
        ),
    ),
    ToolSchema(
        name="ask_budget_status",
        description="Consulta el estado del presupuesto activo del usuario (cuanto ha gastado vs su limite)",
        parameters=ToolSchemaParameters(
            properties={},
            required=[],
        ),
    ),
    ToolSchema(
        name="ask_goal_status",
        description="Consulta el progreso de las metas de ahorro del usuario",
        parameters=ToolSchemaParameters(
            properties={},
            required=[],
        ),
    ),
    ToolSchema(
        name="greeting",
        description="Responde a saludos simples del usuario (hola, buenos dias, como estas, etc.)",
        parameters=ToolSchemaParameters(
            properties={},
            required=[],
        ),
    ),
]


def get_tool_schemas() -> List[ToolSchema]:
    """Return the list of available tool schemas."""
    return TOOL_SCHEMAS


def get_tool_schemas_dict() -> List[dict]:
    """Return tool schemas as dicts for JSON serialization."""
    return [tool.model_dump() for tool in TOOL_SCHEMAS]
