"""Add is_enabled columns to stations and machines (soft-disable)."""
from sqlalchemy import text, inspect
from app.models import engine


def _add_column_if_missing(conn, table: str, column: str, ddl: str):
    # Inspect via the same connection that runs ALTER so we do not race on
    # stale metadata from a different engine-level connection/pool checkout.
    insp = inspect(conn)
    cols = {c["name"] for c in insp.get_columns(table)}
    if column in cols:
        print(f"[SKIP] {table}.{column} already exists")
        return
    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))
    print(f"[OK] Added {table}.{column}")


def main():
    with engine.begin() as conn:
        try:
            _add_column_if_missing(
                conn, "stations", "is_enabled", "is_enabled INT NOT NULL DEFAULT 1"
            )
        except Exception as exc:
            print(f"[SKIP] stations.is_enabled: {exc}")
        try:
            _add_column_if_missing(
                conn, "machines", "is_enabled", "is_enabled INT NOT NULL DEFAULT 1"
            )
        except Exception as exc:
            print(f"[SKIP] machines.is_enabled: {exc}")


if __name__ == "__main__":
    main()
