import { WalletSession } from '../../src/session/index.ts';

const password = 'disposable client synchronization fixture';

export async function runSyncProbe(options: {
  restoreHeight: number;
  minimumHeight: number;
  uri: string;
}): Promise<Record<string, number | boolean>> {
  const session = new WalletSession();
  const started = performance.now();
  let seed = '';
  try {
    document.body.dataset.phase = 'create';
    await session.create({ password });
    seed = await session.seed(password);
    session.lock();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await clearFixtureDatabase();
    document.body.dataset.phase = 'restore';
    await session.create({ password, seed, restoreHeight: options.restoreHeight });
    await session.verifySeed(seed);
    seed = '';
    await session.connect({ uri: options.uri, username: 'fixture', password: 'disposable' });
    await session.startSync();
    document.body.dataset.phase = 'scan';
    await waitForScan(session, options.minimumHeight);
    await session.stopSync();
    document.body.dataset.phase = 'checkpoint';
    const height = session.view?.height ?? 0;
    const backup = await session.exportBackup();
    session.lock();
    document.body.dataset.phase = 'unlock';
    await session.unlock(password);
    const reopenedHeight = session.view?.height ?? 0;
    document.body.dataset.phase = 'complete';
    return {
      restoreHeight: options.restoreHeight,
      height,
      reopenedHeight,
      checkpointRecovered: reopenedHeight >= height,
      encryptedBackupBytes: backup.byteLength,
      elapsedMs: Math.round(performance.now() - started),
    };
  } finally {
    seed = '';
    session.lock();
  }
}

function waitForScan(session: WalletSession, minimumHeight: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finish(new Error('Synchronization fixture deadline exceeded.'));
    }, 15 * 60_000);
    const inspect = () => {
      const view = session.view;
      if (!view) {
        finish(new Error('Wallet unexpectedly locked.'));
        return;
      }
      document.body.dataset.height = String(view.height);
      document.body.dataset.sync = view.sync;
      if (view.sync === 'waiting-node') {
        finish(new Error('Synchronization node is not ready.'));
        return;
      }
      if (view.sync === 'failed') finish(new Error('Synchronization fixture failed.'));
      else if (view.height >= minimumHeight && view.sync !== 'syncing') finish();
    };
    const finish = (error?: Error) => {
      clearTimeout(timer);
      session.removeEventListener('change', inspect);
      session.removeEventListener('operationfailed', failed);
      // Leave the session's current operation before requesting a checkpoint.
      setTimeout(() => {
        if (error) reject(error);
        else resolve();
      }, 0);
    };
    const failed = () => {
      finish(new Error('Synchronization operation failed.'));
    };
    session.addEventListener('change', inspect);
    session.addEventListener('operationfailed', failed);
    inspect();
  });
}

function clearFixtureDatabase(): Promise<void> {
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
