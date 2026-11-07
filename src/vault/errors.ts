export type VaultErrorCode =
  | 'invalid-format'
  | 'unsupported-format'
  | 'too-large'
  | 'password-invalid'
  | 'authentication-failed'
  | 'locked'
  | 'password-changed-locked'
  | 'storage-failed'
  | 'revision-conflict';

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode) {
    super(code);
    this.name = 'VaultError';
    this.code = code;
  }
}
