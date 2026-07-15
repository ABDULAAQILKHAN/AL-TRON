/** Mirrors AUTH-PRO's password policy: min 8 chars, upper, lower, number, special (@$!%*?&). */
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

export const PASSWORD_REGEX_MESSAGE =
  'password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character (@$!%*?&)';
