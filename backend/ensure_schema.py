"""Startup schema guard for live deployments.

Runs safe, idempotent checks so `git pull` + `./run.sh restart` on an existing
Ubuntu DB keeps data intact while creating missing tables and additive columns.

Never drops tables, truncates, or deletes rows.
"""

from __future__ import annotations

from sqlalchemy import inspect, text

from app.models import (
    Base,
    engine,
    ensure_mobile_schema,
    DeviationAlertLog,
    DeviationEscalationCase,
    ToolGroup,
    ToolGroupMember,
)


def _ensure_column(table: str, column: str, ddl: str) -> bool:
    insp = inspect(engine)
    if not insp.has_table(table):
        return False
    cols = {c["name"] for c in insp.get_columns(table)}
    if column in cols:
        return False
    with engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))
    return True


def _run_safe(label: str, fn) -> None:
    try:
        fn()
        print(f"[schema-guard] {label}: ok")
    except Exception as exc:
        print(f"[schema-guard] {label}: skipped ({exc})")


def main() -> int:
    created = []
    altered = []

    # Create any ORM tables that are missing on older deployments (additive only).
    try:
        before = set(inspect(engine).get_table_names())
        Base.metadata.create_all(bind=engine, checkfirst=True)
        after = set(inspect(engine).get_table_names())
        for name in sorted(after - before):
            created.append(name)
        if not (after - before):
            print("[schema-guard] all ORM tables already present (create_all checkfirst)")
    except Exception as exc:
        print(f"[schema-guard] create_all skipped: {exc}")

    # Mobile/operator schema used by dashboard status + allocations.
    if ensure_mobile_schema(engine):
        created.append("mobile/operator schema")

    # Explicit ensure for historically drift-prone tables.
    for model, name in (
        (DeviationAlertLog, "deviation_alert_log"),
        (DeviationEscalationCase, "deviation_escalation_cases"),
        (ToolGroup, "tool_groups"),
        (ToolGroupMember, "tool_group_members"),
    ):
        model.__table__.create(bind=engine, checkfirst=True)
        if name not in created:
            created.append(name)

    # Columns that caused real production drift/errors.
    column_specs = (
        ("breakdown_tickets", "raised_by_name", "raised_by_name VARCHAR(120) NULL"),
        ("deviation_alert_log", "escalation_level", "escalation_level INT DEFAULT 0"),
        ("parts", "tool_group_id", "tool_group_id INT NULL"),
        ("stations", "is_enabled", "is_enabled INT NOT NULL DEFAULT 1"),
        ("machines", "is_enabled", "is_enabled INT NOT NULL DEFAULT 1"),
        ("work_orders", "outstanding_qty", "outstanding_qty INT DEFAULT 0"),
        ("work_orders", "outstanding_status", "outstanding_status VARCHAR(20) DEFAULT 'none'"),
        ("work_orders", "consumed_by_wo_id", "consumed_by_wo_id INT NULL"),
        ("production_plans", "work_order_id", "work_order_id INT NULL"),
    )
    for table, column, ddl in column_specs:
        if _ensure_column(table, column, ddl):
            altered.append(f"{table}.{column}")

    # ENUM / feature migrations (idempotent; skip on failure).
    try:
        from migrate_work_orders import main as work_orders_migrate
        _run_safe("work_orders", work_orders_migrate)
    except Exception as exc:
        print(f"[schema-guard] work_orders import skipped: {exc}")

    try:
        from migrate_plan_status_abort_incomplete import main as plan_status_migrate
        _run_safe("plan_status_abort_incomplete", plan_status_migrate)
    except Exception as exc:
        print(f"[schema-guard] plan_status import skipped: {exc}")

    try:
        from migrate_entity_enabled import main as entity_enabled_migrate
        _run_safe("entity_enabled", entity_enabled_migrate)
    except Exception as exc:
        print(f"[schema-guard] entity_enabled import skipped: {exc}")

    print("[schema-guard] completed")
    if created:
        print(f"[schema-guard] ensured tables/features: {', '.join(created)}")
    if altered:
        print(f"[schema-guard] added columns: {', '.join(altered)}")
    if not created and not altered:
        print("[schema-guard] no structural changes needed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
