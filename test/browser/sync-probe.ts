import { WalletSession } from '../../src/session/index.ts';
import { waitForFixtureLockRelease } from './fixture-lock.ts';
import { recordWorkerFailures } from './worker-diagnostics.ts';

const password = 'disposable client synchronization fixture';

interface ProbeOptions {
  restoreHeight: number;
  minimumHeight: number;
  uri: string;
}

export async function runSyncProbe(
  options: ProbeOptions,
): Promise<Record<string, number | boolean>> {
  return measureSession(options, initializeRestoration);
}

export async function resumeSyncProbe(
  options: ProbeOptions,
): Promise<Record<string, number | boolean>> {
  return measureSession(options, async (session) => {
    document.body.dataset.phase = 'open';
    await session.unlock(password);
  });
}

async function initializeRestoration(session: WalletSession, options: ProbeOptions): Promise<void> {
  let seed = '';
  try {
    document.body.dataset.phase = 'create';
    await session.create({ password });
    seed = await session.seed(password);
    session.lock();
    await waitForFixtureLockRelease();
    await clearFixtureDatabase();
    document.body.dataset.phase = 'restore';
    await session.create({ password, seed, restoreHeight: options.restoreHeight });
    await session.verifySeed(seed);
    seed = '';
  } finally {
    seed = '';
  }
}

async function measureSession(
  options: ProbeOptions,
  initialize: (session: WalletSession, options: ProbeOptions) => Promise<void>,
): Promise<Record<string, number | boolean>> {
  const session = new WalletSession();
  const started = performance.now();
  const restoreDiagnostics = recordWorkerFailures();
  try {
    await initialize(session, options);
    const fromCheckpointHeight = session.view?.height ?? 0;
    await session.connect({ uri: options.uri, username: 'fixture', password: 'disposable' });
    await session.startSync();
    document.body.dataset.phase = 'scan';
    await waitForScan(session, options.minimumHeight);
    document.body.dataset.phase = 'stop';
    await session.stopSync();
    document.body.dataset.phase = 'checkpoint';
    const height = session.view?.height ?? 0;
    const backup = await session.exportBackup();
    session.lock();
    await waitForFixtureLockRelease();
    document.body.dataset.phase = 'unlock';
    await session.unlock(password);
    const reopenedHeight = session.view?.height ?? 0;
    document.body.dataset.phase = 'complete';
    return {
      restoreHeight: options.restoreHeight,
      fromCheckpointHeight,
      height,
      reopenedHeight,
      checkpointRecovered: reopenedHeight >= height,
      encryptedBackupBytes: backup.byteLength,
      elapsedMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    recordProbeFailure(error);
    throw error;
  } finally {
    session.lock();
    restoreDiagnostics();
  }
}

function recordProbeFailure(error: unknown): void {
  const code =
    error instanceof Error && 'code' in error ? error.code : document.body.dataset.workerFailure;
  document.body.dataset.failure =
    typeof code === 'string' && /^[a-z-]{1,64}$/.test(code) ? code : 'unclassified';
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
