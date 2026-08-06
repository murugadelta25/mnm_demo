"""Create work_orders table, link production_plans.work_order_id, outstanding columns."""
from sqlalchemy import inspect, text
from app.models import engine, WorkOrder


def _ensure_column(conn, table: str, column: str, ddl: str):
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns(table)} if insp.has_table(table) else set()
    if column in cols:
        print(f"[SKIP] {table}.{column} exists")
        return
    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))
    print(f"[OK] {table}.{column} column added")


def main():
    insp = inspect(engine)
    if not insp.has_table("work_orders"):
        WorkOrder.__table__.create(bind=engine)
        print("[OK] work_orders table created")
    else:
        print("[SKIP] work_orders table exists")

    if insp.has_table("production_plans"):
        cols = {c["name"] for c in insp.get_columns("production_plans")}
        if "work_order_id" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE production_plans ADD COLUMN work_order_id INT NULL"
                ))
                try:
                    conn.execute(text(
                        "ALTER TABLE production_plans ADD CONSTRAINT fk_plan_work_order "
                        "FOREIGN KEY (work_order_id) REFERENCES work_orders(id)"
                    ))
                except Exception:
                    pass
            print("[OK] production_plans.work_order_id column added")
        else:
            print("[SKIP] production_plans.work_order_id exists")

    if not insp.has_table("work_orders"):
        return

    with engine.begin() as conn:
        # Expand status ENUM to include closed (MySQL). Ignore if already applied / non-MySQL.
        try:
            conn.execute(text(
                "ALTER TABLE work_orders MODIFY COLUMN status "
                "ENUM('draft','in_progress','completed','cancelled','closed') "
                "DEFAULT 'draft'"
            ))
            print("[OK] work_orders.status ENUM includes closed")
        except Exception as exc:
            print(f"[SKIP] work_orders.status ENUM update: {exc}")

        _ensure_column(conn, "work_orders", "outstanding_qty", "outstanding_qty INT DEFAULT 0")
        _ensure_column(
            conn,
            "work_orders",
            "outstanding_status",
            "outstanding_status VARCHAR(20) DEFAULT 'none'",
        )
        _ensure_column(
            conn,
            "work_orders",
            "consumed_by_wo_id",
            "consumed_by_wo_id INT NULL",
        )


if __name__ == "__main__":
    main()
