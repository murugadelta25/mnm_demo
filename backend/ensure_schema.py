"""Startup schema guard for live deployments.

Runs safe, idempotent checks to ensure critical tables/columns exist across:
- Web app flows
- Mobile/operator integration flows
- Newly added Tool Group / Factory integrations
"""

from __future__ import annotations

from sqlalchemy import inspect, text

from app.models import (
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


def main() -> int:
    created = []
    altered = []

    # Mobile/operator schema used by dashboard status + allocations.
    if ensure_mobile_schema(engine):
        created.append("mobile/operator schema")

    # Core app tables that may be absent in older deployments.
    for model, name in (
        (DeviationAlertLog, "deviation_alert_log"),
        (DeviationEscalationCase, "deviation_escalation_cases"),
        (ToolGroup, "tool_groups"),
        (ToolGroupMember, "tool_group_members"),
    ):
        model.__table__.create(bind=engine, checkfirst=True)
        created.append(name)

    # Columns that caused real production drift/errors.
    if _ensure_column("breakdown_tickets", "raised_by_name", "raised_by_name VARCHAR(120) NULL"):
        altered.append("breakdown_tickets.raised_by_name")
    if _ensure_column("deviation_alert_log", "escalation_level", "escalation_level INT DEFAULT 0"):
        altered.append("deviation_alert_log.escalation_level")
    if _ensure_column("parts", "tool_group_id", "tool_group_id INT NULL"):
        altered.append("parts.tool_group_id")

    print("[schema-guard] completed")
    if created:
        print(f"[schema-guard] ensured tables/features: {', '.join(created)}")
    if altered:
        print(f"[schema-guard] added columns: {', '.join(altered)}")
    if not created and not altered:
        print("[schema-guard] no changes needed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

