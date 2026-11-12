from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://tiffin:tiffin@localhost:5432/tiffin"
    jwt_secret: str = "dev-secret-change-me"
    jwt_ttl_hours: int = 12
    platform_admin_email: str = "admin@tiffin.app"
    platform_admin_password: str = "admin12345"
    cors_origins: str = "http://localhost:3000"
    seed_demo: bool = True
    trial_days: int = 14

    @property
    def sqlalchemy_url(self) -> str:
        # Vercel / Neon hand out postgres:// or postgresql:// URLs; force the psycopg3 driver.
        url = self.database_url
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url


settings = Settings()
