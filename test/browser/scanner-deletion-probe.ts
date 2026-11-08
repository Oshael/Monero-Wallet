// Disposable fixture only. Credentials never leave this browser except as the
// intentionally shared view key to the fixed local scanner.
import { openWalletFull, shutdown } from 'wallet-engine-client';
import type { CandidateWallet } from 'wallet-engine-client';
import { Vault } from '../../src/vault/index.ts';
import { decodeSnapshot } from '../../src/engine/snapshot.ts';
import { LightWalletClient } from '../../src/engine/light-wallet/client.ts';

const password = 'disposable live-stagenet wallet password';
const scanner = 'http://127.0.0.1:38084';

export async function registerDisposableScanner(): Promise<void> {
  await withWallet(async (wallet) => {
    const client = await LightWalletClient.open({
      uri: scanner,
      network: 'stagenet',
      restoreHeight: 0,
      credentials: {
        address: await wallet.getPrimaryAddress(),
        view_key: await wallet.getPrivateViewKey(),
      },
    });
    client.dispose();
  });
}

export async function disposableAccountExists(): Promise<boolean> {
  return withWallet(async (wallet) => {
    const response = await fetch(`${scanner}/get_address_info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: await wallet.getPrimaryAddress(),
        view_key: await wallet.getPrivateViewKey(),
      }),
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
      credentials: 'omit',
    });
    await response.arrayBuffer();
    if (response.status === 200) return true;
    if (response.status === 403) return false;
    throw new Error('Unexpected account status in disposable fixture');
  });
}

async function withWallet<T>(operation: (wallet: CandidateWallet) => Promise<T>): Promise<T> {
  const opened = await Vault.open(password);
  let decoded;
  let wallet: CandidateWallet | undefined;
  try {
    decoded = decodeSnapshot(opened.snapshot);
    wallet = await openWalletFull({
      networkType: 'stagenet',
      proxyToWorker: false,
      password: decoded.metadata.enginePassword,
      keysData: decoded.keys,
      cacheData: decoded.cache,
    });
    return await operation(wallet);
  } finally {
    decoded?.keys.fill(0);
    decoded?.cache.fill(0);
    new Uint8Array(opened.snapshot).fill(0);
    opened.vault.close();
    try {
      await wallet?.close(false);
    } finally {
      await shutdown();
    }
  }
}
