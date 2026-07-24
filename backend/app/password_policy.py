"""Password policy for PMS web login accounts.

Pattern example: Password@123

Rules:
- Minimum 8 characters
- At least one uppercase letter (A–Z)
- At least one lowercase letter (a–z)
- At least one digit (0–9)
- At least one special character (e.g. @ # $ ! % * ? & _)
- No spaces
"""
from __future__ import annotations

import re
from fastapi import HTTPException

PASSWORD_HINT = (
    "Min 8 characters, with at least 1 capital letter, 1 lowercase letter, "
    "1 digit, and 1 special character (e.g. Password@123)."
)

# Letters, digits, and common symbols; must include upper, lower, digit, special
_SPECIAL = r"@#$%!&*?_\-."
_POLICY_RE = re.compile(
    rf"^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[{re.escape(_SPECIAL)}])"
    rf"[A-Za-z0-9{_SPECIAL}]{{8,}}$"
)


def password_policy_error(password: str | None) -> str | None:
    """Return a human-readable error, or None if the password is valid."""
    if password is None:
        return PASSWORD_HINT
    pwd = str(password)
    if len(pwd) < 8:
        return "Password must be at least 8 characters"
    if any(ch.isspace() for ch in pwd):
        return "Password must not contain spaces"
    if not re.search(r"[A-Z]", pwd):
        return "Password must include at least one capital letter"
    if not re.search(r"[a-z]", pwd):
        return "Password must include at least one lowercase letter"
    if not re.search(r"[0-9]", pwd):
        return "Password must include at least one numeric digit"
    if not re.search(rf"[{re.escape(_SPECIAL)}]", pwd):
        return "Password must include at least one special character (e.g. @ # $ !)"
    if not _POLICY_RE.match(pwd):
        return PASSWORD_HINT
    return None


def validate_password_or_raise(password: str | None) -> str:
    err = password_policy_error(password)
    if err:
        raise HTTPException(status_code=400, detail=err)
    return str(password)
