// The only password length rule: the DB (`staff_need_password`) checks presence, not length.
// Shared by every DTO that accepts a password.
export const PASSWORD_MIN_LENGTH = 8;

// The maximum only bounds Argon2 hashing work.
export const PASSWORD_MAX_LENGTH = 128;
