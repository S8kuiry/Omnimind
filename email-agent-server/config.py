from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # MongoDB — same OmniMind database as the Next.js client
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "OmniMind"
    mongodb_use_public_dns: bool = True

    @field_validator("mongodb_uri", mode="before")
    @classmethod
    def strip_uri_comment(cls, value: str) -> str:
        if isinstance(value, str):
            return value.split("#", 1)[0].strip()
        return value

    # Google OAuth
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str = "http://localhost:8000/auth/callback"

    # LLM (Gemini primary; Groq optional legacy)
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    groq_api_key: str = ""

    # Frontend
    frontend_url: str = "http://localhost:3000"

    # Security
    secret_key: str = "super-secret-dev-key-change-me"

    # Server
    port: int = 8000

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
