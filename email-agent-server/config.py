from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # MongoDB
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "email_agent"
    mongodb_use_public_dns: bool = False

    # Google OAuth
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str = "http://localhost:8000/auth/callback"

    # LLM — Gemini primary, Groq fallback
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"

    # Frontend
    frontend_url: str = "http://localhost:3000"
    cors_extra_origins: str = ""  # comma-separated extra allowed origins

    # Security
    secret_key: str

    # Ingest scheduler
    ingest_interval_seconds: int = 900      # 15 minutes
    ingest_batch_size: int = 20
    bootstrap_query: str = "newer_than:1d"  # first session — today's emails only

    # Gmail Push (Pub/Sub)
    gmail_push_enabled: bool = True
    gmail_pubsub_topic: str = ""            # projects/{project}/topics/{topic}
    gmail_pubsub_subscription: str = ""

    # Auto-reply behaviour
    auto_send_enabled: bool = True          # master switch for auto-replies

    # Gmail list limits (legacy helpers still reference these)
    attention_list_max_results: int = 20
    sync_backlog_max_results: int = 20

    # Cache TTLs
    attention_cache_ttl_seconds: int = 300
    analyze_cache_ttl_seconds: int = 3600

    # Cleanup engine
    cleanup_batch_size: int = 50
    cleanup_interval_seconds: int = 3600

    # DB retention (MongoDB only — does not touch Gmail)
    db_retention_days: int = 60
    db_retention_interval_seconds: int = 86400  # once per day
    db_retention_batch_size: int = 500

    # Pipeline concurrency — max emails processed in parallel per ingest cycle
    llm_concurrency: int = 3

    # Server
    port: int = 8000

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )


settings = Settings()
