"""Env-driven settings via pydantic-settings. Loads from `.env` automatically."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_service_role_key: str

    ollama_base_url: str = "http://localhost:11434"
    ollama_llm_model: str = "gemma2:2b"
    ollama_embed_model: str = "nomic-embed-text"  # legacy; embeddings now use Voyage

    voyage_api_key: str
    voyage_embed_model: str = "voyage-3.5"

    scraper_user_agent: str = Field(
        default="GrantedBot/0.1 (+https://granted.example/bot)"
    )
    scraper_concurrency: int = 4

    web_base_url: str = "http://localhost:3000"
    revalidate_secret: str = "changeme"


settings = Settings()  # type: ignore[call-arg]
