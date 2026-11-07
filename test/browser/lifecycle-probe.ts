import { WalletSession } from '../../src/session/index.ts';
import { waitForFixtureLockRelease } from './fixture-lock.ts';

const password = 'disposable live-stagenet wallet password';
const session = new WalletSession();

session.addEventListener('change', () => {
  const view = session.view;
  document.body.dataset.height = String(view?.height ?? 0);
  document.body.dataset.sync = view?.sync ?? 'locked';
});
window.addEventListener('pagehide', () => {
  session.lock();
});

export async function beginOldScan(): Promise<{ address: string }> {
  let seed = '';
  try {
    await session.create({ password });
    seed = await session.seed(password);
    session.lock();
    await waitForFixtureLockRelease();
    await clearFixtureStorage();
    await session.create({ password, seed, restoreHeight: 0 });
    await session.verifySeed(seed);
    await session.connect({
      uri: 'http://127.0.0.1:38081',
      username: 'fixture',
      password: 'disposable',
    });
    await session.startSync();
    return { address: session.view?.address ?? '' };
  } finally {
    seed = '';
  }
}

export async function openCheckpoint(): Promise<{ address: string; height: number }> {
  await session.unlock(password);
  return { address: session.view?.address ?? '', height: session.view?.height ?? 0 };
}

export async function restartScan(): Promise<void> {
  await session.startSync();
}

export async function checkpoint(): Promise<{ height: number; encryptedBytes: number }> {
  await session.stopSync();
  const height = session.view?.height ?? 0;
  const data = await session.exportBackup();
  return { height, encryptedBytes: data.byteLength };
}

function clearFixtureStorage(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('xmr-wallet-vault');
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(new Error('Fixture reset failed.'));
    };
    request.onblocked = () => {
      reject(new Error('Fixture reset blocked.'));
    };
  });
}
