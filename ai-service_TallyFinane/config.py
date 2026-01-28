from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # OpenAI
    OPENAI_API_KEY: str
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_TIMEOUT: float = 25.0  # seconds for LLM call
    OPENAI_TEMPERATURE_PHASE_A: float = 0.3
    OPENAI_TEMPERATURE_PHASE_B: float = 0.7

    # Service
    SERVICE_VERSION: str = "1.0.0"

    # Limits
    MAX_RETRIES: int = 1
    ENDPOINT_TIMEOUT: float = 30.0  # seconds

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
