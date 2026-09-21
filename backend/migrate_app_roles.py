"""Create app_roles table and migrate users.role ENUM → VARCHAR(50)."""
from sqlalchemy import inspect, text

from app.models import engine, SessionLocal, AppRole
from app.role_seeds import BUILTIN_ROLE_SEEDS
from app.role_definitions import ensure_roles_table_and_seed


def main() -> None:
    AppRole.__table__.create(bind=engine, checkfirst=True)

    insp = inspect(engine)
    if insp.has_table("users"):
        cols = insp.get_columns("users")
        role_col = next((c for c in cols if c["name"] == "role"), None)
        if role_col:
            enums = getattr(role_col.get("type"), "enums", None)
            if enums:
                with engine.begin() as conn:
                    conn.execute(text(
                        "ALTER TABLE users MODIFY COLUMN role VARCHAR(50) NOT NULL"
                    ))
                print("[OK] users.role → VARCHAR(50)")

    db = SessionLocal()
    try:
        ensure_roles_table_and_seed(db)
        print(f"[OK] app_roles seeded ({len(BUILTIN_ROLE_SEEDS)} built-in roles)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
