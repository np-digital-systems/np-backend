/**
 * How short a password may be, everywhere.
 *
 * One constant rather than a number written into each DTO: the rule used to
 * disagree with itself — an account could be created with eight characters and
 * then be unable to reset to anything under twelve — and a scattered literal is
 * how that happens. Every place that accepts a password imports this.
 *
 * The database enforces that staff *have* a password (`staff_need_password`),
 * not how long it is, so this is the only floor there is.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** Argon2 hashes are stored, so the ceiling only exists to bound the work. */
export const PASSWORD_MAX_LENGTH = 128;
