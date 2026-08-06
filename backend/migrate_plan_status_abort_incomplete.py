"""Expand production_plans.status ENUM with aborted + incomplete."""
from sqlalchemy import text
from app.models import engine


def main():
    with engine.begin() as conn:
        try:
            conn.execute(text(
                "ALTER TABLE production_plans MODIFY COLUMN status "
                "ENUM('pending','running','completed','paused','cancelled','aborted','incomplete') "
                "DEFAULT 'pending'"
            ))
            print("[OK] production_plans.status ENUM includes aborted, incomplete")
        except Exception as exc:
            print(f"[SKIP] production_plans.status ENUM update: {exc}")


if __name__ == "__main__":
    main()
