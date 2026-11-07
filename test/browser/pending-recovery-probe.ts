import { createWalletFull, shutdown } from 'wallet-engine-client';
import { encodeSnapshot } from '../../src/engine/snapshot.ts';
import { createIntent } from '../../src/transactions/index.ts';
import { VaultCipher } from '../../src/vault/cipher.ts';

export async function downloadPendingRecovery(): Promise<number> {
  const enginePassword = 'a'.repeat(64);
  const wallet = await createWalletFull({
    networkType: 'stagenet',
    proxyToWorker: false,
    password: enginePassword,
  });
  let cipher: VaultCipher | undefined;
  let snapshot: ArrayBuffer | undefined;
  let data: Uint8Array<ArrayBuffer>[] = [];
  try {
    const address = await wallet.getPrimaryAddress();
    data = await wallet.getData();
    const [keys, cache] = data;
    if (!keys || !cache) throw new Error('Fixture native data missing.');
    snapshot = encodeSnapshot({
      keys,
      cache,
      metadata: {
        version: 1,
        network: 'stagenet',
        enginePassword,
        restoreHeight: 0,
        backupVerified: true,
        node: null,
        // Recovery/UI fixture only: these invalid unsigned bytes are never signed or relayed.
        pending: {
          intent: createIntent({ address, amount: '1', maximumFee: '10' }),
          fee: '1',
          unsignedHex: 'ab'.repeat(100_000),
          signedHex: '',
          hash: '',
          status: 'prepared',
        },
      },
    });
    cipher = await VaultCipher.create('disposable browser wallet password');
    const envelope = await cipher.seal(snapshot);
    const url = URL.createObjectURL(new Blob([envelope], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pending-recovery.xmrvault';
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    return await wallet.getRestoreHeight();
  } finally {
    if (snapshot) new Uint8Array(snapshot).fill(0);
    for (const bytes of data) bytes.fill(0);
    cipher?.destroy();
    await wallet.close(false);
    await shutdown();
  }
}
