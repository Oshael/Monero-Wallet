import { openWalletFull, HttpClient } from 'wallet-engine-client';
import type { CandidateWallet } from 'wallet-engine-client';
import { WalletError } from '../../src/domain/validation.ts';
import { LightWalletClient } from '../../src/engine/light-wallet/client.ts';
import type { LightWalletData } from '../../src/engine/light-wallet/data.ts';
import { TransactionSigner } from '../../src/engine/transaction-signer.ts';
import { readNodeStatus } from '../../src/engine/node-status.ts';
import { createIntent } from '../../src/transactions/index.ts';
import { EgressCapture } from './egress-capture.ts';
import { generate, restoredRegtestWallet } from './regtest-wallet.ts';

const password = 'disposable local wallet key password';

export async function runLightWalletProbe(
  origin: string,
  scanner: string,
): Promise<Record<string, boolean | string>> {
  const wallets: CandidateWallet[] = [];
  const capture = new EgressCapture();
  let client: LightWalletClient | undefined;
  const server = { uri: origin, username: 'fixture', password: 'disposable' };
  let phase = 'create';
  try {
    const funder = await restoredRegtestWallet(server);
    wallets.push(funder);
    const wallet = await restoredRegtestWallet(server);
    wallets.push(wallet);
    const destination = await restoredRegtestWallet(server);
    wallets.push(destination);
    const subaddress = await wallet.createSubaddress(0, 'LWS receipt');
    const credentials = {
      address: await wallet.getPrimaryAddress(),
      view_key: await wallet.getPrivateViewKey(),
    };
    phase = 'register';
    client = await LightWalletClient.open({
      uri: scanner,
      network: 'mainnet',
      restoreHeight: 0,
      credentials,
    });
    phase = 'fund';
    for (let batch = 0; batch < 9; batch++) {
      await generate(origin, await funder.getPrimaryAddress(), 20);
    }
    await funder.sync();
    const funding = await funder.createTx({
      accountIndex: 0,
      destinations: [
        { address: credentials.address, amount: '200000000000' },
        { address: subaddress.getAddress(), amount: '300000000000' },
        { address: await wallet.getAddress(0, 999), amount: '10000000000' },
      ],
      canSplit: false,
      relay: true,
    });
    phase = 'legacy-pool-receipt';
    await wallet.sync();
    const fundingHash = funding.getHash();
    requireContract(fundingHash !== undefined);
    await wallet.getTx(fundingHash ?? '');
    requireContract((await wallet.getBalance()) > 0n);
    await generate(origin, await funder.getPrimaryAddress(), 12);
    phase = 'import';
    const data = await scannerData(client, origin);
    await wallet.importLightWalletData(JSON.stringify({ ...data, adopt_legacy: true }));
    phase = 'receipt-balance';
    requireContract((await wallet.getBalance()) === 510_000_000_000n);
    phase = 'receipt-unlocked';
    requireContract((await wallet.getUnlockedBalance()) === 510_000_000_000n);
    phase = 'tampered-data';
    await assertInvalidDataPreservesState(wallet, data);
    phase = 'reopen';
    await assertNativeCacheRecovery(wallet, data.height);
    phase = 'subaddress-spend';
    const transfer = await spendFromLightCheckpoint(wallet, server, {
      address: await destination.getPrimaryAddress(),
      capture,
      data,
    });
    await wallet.importLightWalletData(JSON.stringify(data));
    requireContract((await wallet.getUnlockedBalance()) === 210_000_000_000n);
    await generate(origin, await funder.getPrimaryAddress(), 12);
    phase = 'settlement-data';
    const settled = await scannerData(client, origin);
    phase = 'settlement-import';
    await wallet.importLightWalletData(JSON.stringify(settled));
    phase = 'settlement-balance';
    requireContract((await wallet.getBalance()) === 260_000_000_000n - BigInt(transfer.fee));
    phase = 'settlement-confirmation';
    requireContract((await wallet.getTx(transfer.hash))?.getIsConfirmed() === true);
    phase = 'detached-confirmation';
    await detachBlocks(origin, 12);
    await removeFromPool(origin, transfer.hash);
    await generate(origin, await funder.getPrimaryAddress(), 1);
    const detached = await scannerData(client, origin);
    await wallet.importLightWalletData(JSON.stringify(detached));
    requireContract((await wallet.getTx(transfer.hash))?.getIsConfirmed() === false);
    requireContract((await wallet.getUnlockedBalance()) === 210_000_000_000n);
    const retried = await wallet.submitTxs(transfer.signedHex);
    requireContract(retried.length === 1 && retried[0] === transfer.hash);
    await generate(origin, await funder.getPrimaryAddress(), 12);
    const restored = await scannerData(client, origin);
    await wallet.importLightWalletData(JSON.stringify(restored));
    requireContract((await wallet.getTx(transfer.hash))?.getIsConfirmed() === true);
    requireContract((await wallet.getBalance()) === 260_000_000_000n - BigInt(transfer.fee));
    phase = 'keys-only-outgoing-recovery';
    await assertKeysOnlyOutgoingRecovery({ wallet, server, data: restored, hash: transfer.hash });
    phase = 'destination-receipt';
    await destination.sync();
    requireContract((await destination.getBalance()) === 250_000_000_000n);
    phase = 'egress';
    capture.assertSecretsAbsent([
      await wallet.getSeed(),
      await wallet.getPrivateSpendKey(),
      password,
    ]);
    capture.assertSecretRestricted(
      credentials.view_key,
      [
        'login',
        'import_wallet_request',
        'get_address_info',
        'get_address_txs',
        'get_unspent_outs',
      ].map((method) => `${scanner}/${method}`),
    );
    return {
      primaryAndSubaddressReceipt: true,
      legacyPoolReceiptReconciled: true,
      lastSupportedSubaddressRecovered: true,
      exactUnlockedBalance: true,
      nativeOwnershipAndCommitmentChecks: true,
      rejectedDataPreservesState: true,
      omittedKnownReceiptRejected: true,
      nativeCacheRecovered: true,
      subaddressUnsignedPreparation: true,
      preparationAvoidsLocalChainScan: true,
      signedBytesSurviveReorderedOutputs: true,
      outgoingRecoveredWithoutLocalPendingRecord: true,
      inspectedLocalSignature: true,
      exactRecipientAmount: true,
      exactFeeAndChange: true,
      confirmedLocalSend: true,
      staleScannerCannotReleasePendingInput: true,
      detachedConfirmationRetainsPendingSpend: true,
      seedAndSpendKeyAbsentFromEgress: true,
      viewKeyRestrictedToScannerBodies: true,
    };
  } catch (error) {
    return { failedAt: phase, diagnostic: diagnostic(error) };
  } finally {
    client?.dispose();
    const closed = await Promise.allSettled(wallets.map((wallet) => wallet.close(false)));
    capture.close();
    if (closed.some((result) => result.status === 'rejected')) {
      throw new Error('Light fixture cleanup failed.');
    }
  }
}

async function detachBlocks(origin: string, blocks: number): Promise<void> {
  const response = await HttpClient.request({
    uri: `${origin}/pop_blocks`,
    method: 'POST',
    username: 'fixture',
    password: 'disposable',
    body: JSON.stringify({ nblocks: blocks }),
    resolveWithFullResponse: true,
  });
  if (response.statusCode !== 200) throw new Error('Reorg fixture failed.');
}

async function removeFromPool(origin: string, hash: string): Promise<void> {
  const response = await HttpClient.request({
    uri: `${origin}/json_rpc`,
    method: 'POST',
    username: 'fixture',
    password: 'disposable',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'fixture',
      method: 'flush_txpool',
      params: { txids: [hash] },
    }),
    resolveWithFullResponse: true,
  });
  if (response.statusCode !== 200) throw new Error('Reorg pool fixture failed.');
  const value: unknown = JSON.parse(response.body);
  if (typeof value !== 'object' || value === null || 'error' in value) {
    throw new Error('Reorg pool fixture failed.');
  }
}

async function scannerData(client: LightWalletClient, origin: string): Promise<LightWalletData> {
  const deadline = performance.now() + 60_000;
  while (performance.now() < deadline) {
    try {
      return await client.read(() =>
        readNodeStatus({ uri: origin, username: 'fixture', password: 'disposable' }, 'fakechain'),
      );
    } catch (error) {
      if (!(error instanceof WalletError)) throw error;
      if (!['light-scanner-behind', 'light-scan-changed'].includes(error.code)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Light scanner deadline.');
}

async function assertInvalidDataPreservesState(
  wallet: CandidateWallet,
  data: LightWalletData,
): Promise<void> {
  const output = data.outputs[0];
  if (!output) throw new Error('Light fixture missing receipt.');
  const variants = [
    { ...data, outputs: [] },
    { ...data, outputs: [{ ...output, amount: (BigInt(output.amount) + 1n).toString() }] },
    {
      ...data,
      outputs: [{ ...output, recipient: { major: 0, minor: (output.recipient.minor + 1) % 1000 } }],
    },
    { ...data, outputs: [output, output] },
    {
      ...data,
      outputs: [{ ...output, global_index: (BigInt(output.global_index) + 1n).toString() }],
    },
  ];
  const balance = await wallet.getBalance();
  for (const value of variants) {
    let rejected = false;
    try {
      await wallet.importLightWalletData(JSON.stringify(value));
    } catch (error) {
      if (!(error instanceof Error) || error instanceof WebAssembly.RuntimeError) throw error;
      rejected = true;
    }
    requireContract(rejected);
    requireContract((await wallet.getBalance()) === balance);
    requireContract((await wallet.getHeight()) === data.height);
  }
}

async function assertNativeCacheRecovery(wallet: CandidateWallet, height: number): Promise<void> {
  const [keys, cache] = await wallet.getData();
  requireContract(keys !== undefined && cache !== undefined);
  let recovered: CandidateWallet | undefined;
  try {
    recovered = await openWalletFull({
      networkType: 'mainnet',
      regtest: true,
      proxyToWorker: false,
      keysData: keys,
      cacheData: cache,
      password,
    });
    await recovered.restoreLightWalletHeight(height);
    requireContract((await recovered.getBalance()) === (await wallet.getBalance()));
    requireContract((await recovered.getSubaddresses(0))[1]?.getLabel() === 'LWS receipt');
  } finally {
    keys?.fill(0);
    cache?.fill(0);
    await recovered?.close(false);
  }
}

async function assertKeysOnlyOutgoingRecovery(input: {
  wallet: CandidateWallet;
  server: Record<string, unknown>;
  data: LightWalletData;
  hash: string;
}): Promise<void> {
  const [keys, cache] = await input.wallet.getData();
  let recovered: CandidateWallet | undefined;
  try {
    recovered = await openWalletFull({
      networkType: 'mainnet',
      regtest: true,
      proxyToWorker: false,
      keysData: keys,
      password,
      server: input.server,
      isTrustedDaemon: false,
    });
    await recovered.importLightWalletData(JSON.stringify(input.data));
    const [transaction] = await recovered.getTxs({
      hashes: [input.hash],
      transferQuery: { isIncoming: false },
    });
    requireContract(transaction?.getIsConfirmed() === true);
    requireContract((await recovered.getBalance()) === (await input.wallet.getBalance()));
    requireContract((await recovered.getSubaddresses(0)).length === 1000);
  } finally {
    keys?.fill(0);
    cache?.fill(0);
    await recovered?.close(false);
  }
}

async function spendFromLightCheckpoint(
  wallet: CandidateWallet,
  server: { uri: string; username: string; password: string },
  options: { address: string; capture: EgressCapture; data: LightWalletData },
): Promise<{ hash: string; fee: string; signedHex: string }> {
  const signer = new TransactionSigner(wallet, {
    password,
    networkType: 'mainnet',
    regtest: true,
  });
  const intent = createIntent({
    address: options.address,
    amount: '250000000000',
    maximumFee: '100000000000',
  });
  const mark = options.capture.mark();
  const prepared = await signer.prepare(intent, server, {
    kind: 'light',
    height: await wallet.getHeight(),
  });
  options.capture.assertNoRequestsSince(mark, [
    '/get_blocks.bin',
    '/get_hashes.bin',
    '/get_blocks_by_height.bin',
  ]);
  const signed = await signer.sign(intent, prepared.unsignedHex, prepared.fee);
  await wallet.importLightWalletData(
    JSON.stringify({
      ...options.data,
      outputs: [...options.data.outputs].reverse(),
    }),
  );
  const hashes = await wallet.submitTxs(signed.signedHex);
  requireContract(hashes.length === 1 && hashes[0] === signed.hash);
  return { hash: signed.hash, fee: prepared.fee, signedHex: signed.signedHex };
}

function requireContract(condition: boolean): void {
  if (!condition) throw new Error('Light wallet invariant failed.');
}

function diagnostic(error: unknown): string {
  if (error instanceof WalletError) return error.code;
  if (error instanceof WebAssembly.RuntimeError) return 'native-fatal';
  const message = error instanceof Error ? error.message : '';
  const categories = [
    'Invalid',
    'light',
    'Light',
    'undefined',
    'funds',
    'output',
    'ring',
    'daemon',
    'RPC',
    'Unbound',
    'invariant',
    'deadline',
    'not found',
    'merge',
    'cache',
  ];
  return categories.filter((category) => message.includes(category)).join('-') || 'unclassified';
}
