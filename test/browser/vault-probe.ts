import { Vault } from '../../src/vault/index.ts';
import { VaultStorage } from '../../src/vault/storage.ts';

const password = 'original browser fixture';
const replacement = 'replacement browser fixture';

function snapshot(canary: string): ArrayBuffer {
  return new TextEncoder().encode(canary).buffer;
}

async function rejectsPassword(candidate: string): Promise<boolean> {
  let opened;
  try {
    opened = await Vault.open(candidate);
    new Uint8Array(opened.snapshot).fill(0);
    return false;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'authentication-failed';
  } finally {
    opened?.vault.close();
  }
}

export async function runVaultFlow(): Promise<Record<string, boolean | number>> {
  const canary = `private fixture ${crypto.randomUUID()}`;
  let vault: Vault | undefined;
  try {
    vault = await Vault.create(password);
    await vault.save(snapshot(canary));
    const backup = await vault.exportBackup();
    vault.close();
    const wrongPasswordRejected = await rejectsPassword('wrong browser password');
    const opened = await Vault.open(password);
    vault = opened.vault;
    const restored = new TextDecoder().decode(opened.snapshot) === canary;
    new Uint8Array(opened.snapshot).fill(0);
    await vault.changePassword({
      oldPassword: password,
      newPassword: replacement,
      snapshot: snapshot(canary),
    });
    vault.close();
    const oldPasswordRejected = await rejectsPassword(password);
    const current = await Vault.open(replacement);
    vault = current.vault;
    const newPasswordWorks = new TextDecoder().decode(current.snapshot) === canary;
    new Uint8Array(current.snapshot).fill(0);
    const storage = new VaultStorage();
    const active = await storage.read();
    const previous = await storage.read('previous');
    if (!active || !previous) throw new Error('Missing encrypted records.');
    const noPlaintext = [active, previous].every(
      (record) => !new TextDecoder().decode(record.envelope).includes(canary),
    );
    vault.close();
    const exported = await Vault.importBackup(backup, password);
    vault = exported.vault;
    const oldExportStillWorks = new TextDecoder().decode(exported.snapshot) === canary;
    new Uint8Array(exported.snapshot).fill(0);
    return {
      wrongPasswordRejected,
      restored,
      oldPasswordRejected,
      newPasswordWorks,
      noPlaintext,
      oldExportStillWorks,
      encryptedBytes: active.envelope.byteLength + previous.envelope.byteLength,
    };
  } finally {
    vault?.close();
  }
}
