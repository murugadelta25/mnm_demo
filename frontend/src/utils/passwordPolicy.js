/** Shared PMS web-login password policy (must match backend/app/password_policy.py).
 *  Pattern example: Password@123
 */

export const PASSWORD_HINT =
  'Min 8 characters, with at least 1 capital, 1 lowercase, 1 digit, and 1 special character (e.g. Password@123).';

const SPECIAL = /[@#$%!&*?_\-.]/;

/**
 * @param {string} password
 * @returns {string|null} error message, or null if valid
 */
export function passwordPolicyError(password) {
  if (password == null) return PASSWORD_HINT;
  const pwd = String(password);
  if (pwd.length < 8) return 'Password must be at least 8 characters';
  if (/\s/.test(pwd)) return 'Password must not contain spaces';
  if (!/[A-Z]/.test(pwd)) return 'Password must include at least one capital letter';
  if (!/[a-z]/.test(pwd)) return 'Password must include at least one lowercase letter';
  if (!/[0-9]/.test(pwd)) return 'Password must include at least one numeric digit';
  if (!SPECIAL.test(pwd)) {
    return 'Password must include at least one special character (e.g. @ # $ !)';
  }
  // Allowed charset only
  if (!/^[A-Za-z0-9@#$%!&*?_\-.]+$/.test(pwd)) {
    return PASSWORD_HINT;
  }
  return null;
}

export function isPasswordPolicyOk(password) {
  return passwordPolicyError(password) == null;
}
