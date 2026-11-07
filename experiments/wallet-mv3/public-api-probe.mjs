import { createWalletFull, openWalletFull, shutdown, LibraryUtils } from 'monero-candidate';

globalThis.runPublicWalletProbe = async (
  candidate = 'monero.worker.js',
  first = 'monero.worker.js',
) => {
  let workerFile = first;
  LibraryUtils.setWorkerLoader(() => new Worker(workerFile));
  let wallet;
  let phase = 'create';
  try {
    wallet = await createWalletFull({ networkType: 'stagenet', password: 'disposable' });
    const address = await wallet.getPrimaryAddress();
    await wallet.createAccount('Fixture account');
    await wallet.createSubaddress(0, 'Fixture subaddress');
    phase = 'export';
    const [keysData, cacheData] = await wallet.getData();
    await wallet.close(false);
    wallet = undefined;
    await shutdown();

    phase = 'wrong-password';
    let wrongPasswordRejected = false;
    try {
      wallet = await openWalletFull({
        networkType: 'stagenet',
        password: 'wrong',
        keysData,
        cacheData,
      });
    } catch {
      wrongPasswordRejected = true;
    }
    if (wallet) {
      await wallet.close(false);
      wallet = undefined;
    }
    await shutdown();

    phase = 'reopen';
    workerFile = candidate;
    wallet = await openWalletFull({
      networkType: 'stagenet',
      password: 'disposable',
      keysData,
      cacheData,
    });
    const accounts = await wallet.getAccounts(true);
    const subaddresses = await wallet.getSubaddresses(0);
    const addressMatches = address === (await wallet.getPrimaryAddress());
    const [newKeys, newCache] = await wallet.getData();
    phase = 'view-only-clone';
    await assertViewOnlyClone(wallet);
    await wallet.close(false);
    wallet = undefined;
    await shutdown();
    phase = 'backward-reopen';
    workerFile = first;
    wallet = await openWalletFull({
      networkType: 'stagenet',
      password: 'disposable',
      keysData: newKeys,
      cacheData: newCache,
    });
    return {
      keysBytes: keysData.byteLength,
      cacheBytes: cacheData.byteLength,
      addressMatches,
      backwardAddressMatches: address === (await wallet.getPrimaryAddress()),
      accountsPreserved:
        accounts.length === 2 && accounts[1].getSubaddresses()[0].getLabel() === 'Fixture account',
      subaddressPreserved:
        subaddresses.length === 2 && subaddresses[1].getLabel() === 'Fixture subaddress',
      wrongPasswordRejected,
      viewOnlySnapshot: true,
      backwardSpendAuthority: !(await wallet.isViewOnly()),
    };
  } catch (error) {
    return { failedAt: phase, diagnostic: classifyFailure(error) };
  } finally {
    try {
      if (wallet) await wallet.close(false);
    } finally {
      await shutdown();
    }
  }
};

async function assertViewOnlyClone(wallet) {
  const data = await wallet.getData({ viewOnly: true });
  const [keysData, cacheData] = data;
  let observer;
  try {
    observer = await openWalletFull({
      networkType: 'stagenet',
      password: 'disposable',
      keysData,
      cacheData,
    });
    if (!(await observer.isViewOnly()) || (await wallet.isViewOnly()))
      throw new Error('View-only authority mismatch.');
    await assertSpendKeyRejected(observer);
    if ((await observer.getPrimaryAddress()) !== (await wallet.getPrimaryAddress()))
      throw new Error('View-only address mismatch.');
  } finally {
    for (const bytes of data) bytes.fill(0);
    await observer?.close(false);
  }
}

async function assertSpendKeyRejected(wallet) {
  try {
    await wallet.getPrivateSpendKey();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'The wallet is watch-only. Cannot retrieve spend key.'
    )
      return;
    throw error;
  }
  throw new Error('View-only authority mismatch.');
}

function classifyFailure(error) {
  const message = error instanceof Error ? error.message : '';
  const known = [
    'Invalid password',
    'invalid password',
    'BindingError',
    'HEAP',
    'Cannot read',
    'undefined',
    'not defined',
    'not a function',
    'missing function',
    'memory access',
    'deserialize',
    'archive',
    'buffer',
    'wallet file',
    'Aborted',
    'View-only',
  ];
  const categories = known.filter((token) => message.includes(token));
  const property = message.match(/reading '([A-Za-z0-9_]{1,32})'/)?.[1];
  if (property) categories.push(`property:${property}`);
  return categories;
}
