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
                    description="Monto de la transaccion en CLP (pesos chilenos). Siempre positivo.",
                ),
                "category": ToolSchemaParameter(
                    type="string",
                    description="Nombre de la categoria (ej: comida, transporte, entretenimiento, arriendo, servicios)",
                ),
                "posted_at": ToolSchemaParameter(
                    type="string",
                    description="Fecha de la transaccion en formato ISO-8601 (YYYY-MM-DD). Si no se especifica, usar fecha de hoy.",
                ),
                "payment_method": ToolSchemaParameter(
                    type="string",
                    description="Metodo de pago usado (ej: efectivo, tarjeta, debito, credito). Si no se menciona, el backend usara el metodo por defecto del usuario.",
                ),
                "description": ToolSchemaParameter(
                    type="string",
                    description="Descripcion opcional del gasto (ej: almuerzo con amigos, uber al trabajo)",
                ),
            },
            required=["amount", "category"],
        ),
    ),
    ToolSchema(
        name="ask_balance",
        description="Consulta el saldo actual del usuario en sus cuentas/metodos de pago",
        parameters=ToolSchemaParameters(
            properties={},
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
