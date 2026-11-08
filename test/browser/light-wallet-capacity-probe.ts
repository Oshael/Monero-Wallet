import { WalletError } from '../../src/domain/validation.ts';
import { LightWalletClient } from '../../src/engine/light-wallet/client.ts';
import { TransactionSigner } from '../../src/engine/transaction-signer.ts';
import { readNodeStatus } from '../../src/engine/node-status.ts';
import { createIntent } from '../../src/transactions/index.ts';
import { EgressCapture } from './egress-capture.ts';
import { generate, restoredRegtestWallet } from './regtest-wallet.ts';
import type { CandidateWallet } from 'wallet-engine-client';

const password = 'disposable local wallet key password';
export async function runLightWalletCapacity(
  origin: string,
  scanner: string,
): Promise<Record<string, number | boolean | string>> {
  return capacityScenario(origin, scanner, 1000);
}

export async function runLightWalletInputsProbe(
  origin: string,
  scanner: string,
): Promise<Record<string, number | boolean | string>> {
  return capacityScenario(origin, scanner, 64);
}

async function capacityScenario(
  origin: string,
  scanner: string,
  count: number,
): Promise<Record<string, number | boolean | string>> {
  const capture = new EgressCapture();
  const wallets: CandidateWallet[] = [];
  let client: LightWalletClient | undefined;
  let phase = 'create';
  try {
    const server = { uri: origin, username: 'fixture', password: 'disposable' };
    const funder = await restoredRegtestWallet(server);
    wallets.push(funder);
    const wallet = await restoredRegtestWallet(server);
    wallets.push(wallet);
    const viewKey = await wallet.getPrivateViewKey();
    client = await LightWalletClient.open({
      uri: scanner,
      network: 'mainnet',
      restoreHeight: 0,
      credentials: { address: await wallet.getPrimaryAddress(), view_key: viewKey },
    });
    phase = 'fund';
    await fundReceipts({ origin, funder, wallet, count });
    phase = 'scanner';
    const data = await currentData(client, origin);
    requireCapacity(data.outputs.length === count);
    phase = 'native-import';
    const importStarted = performance.now();
    await wallet.importLightWalletData(JSON.stringify(data));
    const importMs = Math.round(performance.now() - importStarted);
    const expected = 1_000_000_000n * BigInt(count);
    requireCapacity((await wallet.getBalance()) === expected);
    requireCapacity((await wallet.getUnlockedBalance()) === expected);
    requireCapacity((await wallet.getSubaddresses(0)).length === count);
    phase = 'prepare';
    const signer = new TransactionSigner(wallet, {
      password,
      networkType: 'mainnet',
      regtest: true,
    });
    const intent = createIntent({
      address: await funder.getPrimaryAddress(),
      amount: '50000000000',
      maximumFee: '10000000000',
    });
    const mark = capture.mark();
    const prepareStarted = performance.now();
    const prepared = await signer.prepare(intent, server, { kind: 'light', height: data.height });
    const prepareMs = Math.round(performance.now() - prepareStarted);
    capture.assertNoRequestsSince(mark, [
      '/get_blocks.bin',
      '/get_hashes.bin',
      '/get_blocks_by_height.bin',
    ]);
    const signStarted = performance.now();
    phase = 'sign';
    const signed = await signer.sign(intent, prepared.unsignedHex, prepared.fee);
    const signMs = Math.round(performance.now() - signStarted);
    requireCapacity(signed.signedHex.length > 0);
    phase = 'cache';
    const serialized = await wallet.getData();
    const cacheBytes = serialized.reduce((total, bytes) => total + bytes.byteLength, 0);
    for (const bytes of serialized) bytes.fill(0);
    phase = 'egress';
    capture.assertSecretsAbsent([
      await wallet.getSeed(),
      await wallet.getPrivateSpendKey(),
      await funder.getSeed(),
      await funder.getPrivateViewKey(),
      await funder.getPrivateSpendKey(),
      password,
    ]);
    capture.assertSecretRestricted(
      viewKey,
      [
        'login',
        'import_wallet_request',
        'get_address_info',
        'get_address_txs',
        'get_unspent_outs',
      ].map((method) => `${scanner}/${method}`),
    );
    return {
      outputs: count,
      exactUnlockedBalance: true,
      signedLocally: true,
      preparationAvoidsLocalChainScan: true,
      privateCanariesPreserved: true,
      importMs,
      prepareMs,
      signMs,
      cacheBytes,
    };
  } catch (error) {
    return {
      failedAt: phase,
      diagnostic: capacityDiagnostic(error),
      capturedRequests: capture.mark(),
    };
  } finally {
    client?.dispose();
    const closed = await Promise.allSettled(wallets.map((wallet) => wallet.close(false)));
    capture.close();
    if (closed.some((result) => result.status === 'rejected'))
      throw new Error('Capacity fixture cleanup failed.');
  }
}

function capacityDiagnostic(error: unknown): string {
  if (error instanceof WalletError) return error.code;
  if (error instanceof WebAssembly.RuntimeError) return 'native-fatal';
  const message = diagnosticMessage(error).toLowerCase();
  const categories = [
    'too large',
    'not enough',
    'Not enough',
    'funds',
    'No outputs',
    'No transaction',
    'ring',
    'commitment',
    'key image',
    'Invalid',
    'Unbound',
    'daemon',
    'RPC',
    'deadline',
    'intent',
    'fee',
    'source',
    'budget',
    'exceeded',
    'too big',
    'balance',
    'timeout',
    'out',
    'Failed',
    'scan request',
    'tx',
    'possible',
    'construct',
    'key',
    'mask',
    'spend',
    'unlock',
    'response',
    'function',
    'undefined',
    'size',
    'argument',
    'assert',
    'expected',
    'must',
    'not',
  ];
  return (
    categories.filter((category) => message.includes(category.toLowerCase())).join('-') ||
    `contract-${typeof error}`
  );
}

function diagnosticMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return error.message;
  return '';
}

async function fundReceipts(input: {
  origin: string;
  funder: CandidateWallet;
  wallet: CandidateWallet;
  count: number;
}): Promise<void> {
  const miner = await input.funder.getPrimaryAddress();
  for (let batch = 0; batch < 12; batch++) await generate(input.origin, miner, 20);
  await input.funder.sync();
  for (let start = 0; start < input.count; start += 14) {
    const destinations = [];
    for (let index = start; index < Math.min(start + 14, input.count); index++) {
      destinations.push({ address: await input.wallet.getAddress(0, index), amount: '1000000000' });
    }
    await input.funder.createTx({ accountIndex: 0, destinations, canSplit: false, relay: true });
  }
  for (let batch = 0; batch < 3; batch++) await generate(input.origin, miner, 10);
}

async function currentData(client: LightWalletClient, origin: string) {
  const deadline = performance.now() + 120_000;
  while (performance.now() < deadline) {
    try {
      return await client.read(() =>
        readNodeStatus({ uri: origin, username: 'fixture', password: 'disposable' }, 'fakechain'),
      );
    } catch (error) {
      if (
        !(error instanceof WalletError) ||
        !['light-scanner-behind', 'light-scan-changed'].includes(error.code)
      )
        throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Capacity scanner deadline.');
}

function requireCapacity(condition: boolean): void {
  if (!condition) throw new Error('Capacity invariant failed.');
}
