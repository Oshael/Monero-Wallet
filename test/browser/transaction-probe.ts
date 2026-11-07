import {
  createWalletFull,
  openWalletFull,
  HttpClient,
  MoneroTxSet,
  MoneroUtils,
} from 'wallet-engine-client';
import type { CandidateWallet } from 'wallet-engine-client';
import { TransactionSigner } from '../../src/engine/transaction-signer.ts';
import {
  createIntent,
  encodeTransferRecovery,
  decodeTransferRecovery,
  TransferJournal,
} from '../../src/transactions/index.ts';
import type { SendIntent, PendingTransfer } from '../../src/transactions/index.ts';
import { EgressCapture } from './egress-capture.ts';
import { readChainState } from '../../src/engine/chain-state.ts';
import { readNodeStatus } from '../../src/engine/node-status.ts';

export async function runTransactionProbe(
  origin: string,
): Promise<Record<string, boolean | string>> {
  const capture = new EgressCapture();
  try {
    return await transactionScenario(origin, capture);
  } finally {
    capture.close();
  }
}

async function transactionScenario(
  origin: string,
  capture: EgressCapture,
): Promise<Record<string, boolean | string>> {
  const server = { uri: origin, username: 'fixture', password: 'disposable' };
  const sender = await restoredRegtestWallet(server);
  let recipient: CandidateWallet | undefined;
  let phase = 'fund';
  console.log('wallet-test-phase:fund');
  try {
    recipient = await restoredRegtestWallet(server);
    for (let batch = 0; batch < 9; batch++) {
      await generate(origin, await sender.getPrimaryAddress(), 20);
    }
    await sender.sync();
    console.log(`wallet-test-height:${String(await sender.getHeight())}`);
    console.log(
      `wallet-test-funded:${String((await sender.getUnlockedBalance()) > 1_000_000_000_000n)}`,
    );
    if ((await sender.getUnlockedBalance()) <= 1_000_000_000_000n) throw new Error('Not funded.');
    phase = 'view-only-snapshot';
    await assertViewOnlySnapshot(sender, server);
    phase = 'prepare';
    console.log('wallet-test-phase:prepare');
    const integrated = await MoneroUtils.getIntegratedAddress(
      'mainnet',
      await recipient.getPrimaryAddress(),
      '1122334455667788',
    );
    const intent = createIntent({
      address: integrated.getIntegratedAddress(),
      amount: '1000000000000',
      maximumFee: '100000000000',
    });
    const signer = new TransactionSigner(sender, {
      networkType: 'mainnet',
      regtest: true,
      password: 'disposable local wallet key password',
    });
    const prepared = await signer.prepare(intent, server);
    phase = 'checkpoint-unsigned';
    assertRecoveryRecord({ intent, ...prepared, signedHex: '', hash: '', status: 'prepared' });
    phase = 'sign';
    console.log('wallet-test-phase:sign');
    const nativeSign = sender.signTxs.bind(sender);
    sender.signTxs = async (unsignedHex) => {
      phase = 'native-sign';
      const result = await nativeSign(unsignedHex);
      phase = 'inspect-signed';
      console.log('wallet-test-phase:inspect-signed');
      return result;
    };
    const signed = await signer.sign(intent, prepared.unsignedHex, prepared.fee);
    phase = 'checkpoint-signed';
    assertRecoveryRecord({
      intent,
      fee: prepared.fee,
      unsignedHex: '',
      ...signed,
      status: 'broadcasting',
    });
    await assertAlteredIntentRejected(signer, intent, signed.signedHex);
    phase = 'invalid-native-set';
    await assertNativeFailureRecovery(sender);
    phase = 'broadcast';
    console.log('wallet-test-phase:broadcast');
    const hashes = await sender.submitTxs(signed.signedHex);
    if (hashes.length !== 1 || hashes[0] !== signed.hash) throw new Error('Hash mismatch.');
    phase = 'receive';
    console.log('wallet-test-phase:receive');
    await generate(origin, await sender.getPrimaryAddress(), 1);
    await recipient.sync();
    const received = await recipient.getBalance();
    if (received !== 1_000_000_000_000n) throw new Error('Receipt mismatch.');
    await assertConfirmation(sender, signed.hash, prepared.fee);
    phase = 'reorg';
    await assertReorgRecovery({
      origin,
      recipient,
      miner: await sender.getPrimaryAddress(),
      hash: signed.hash,
    });
    phase = 'spend-received-output';
    await assertReceivedOutputSpend({ origin, sender, recipient, server });
    capture.assertSecretsAbsent([
      await sender.getSeed(),
      await sender.getPrivateViewKey(),
      await sender.getPrivateSpendKey(),
      await recipient.getSeed(),
      await recipient.getPrivateViewKey(),
      await recipient.getPrivateSpendKey(),
      'disposable local wallet key password',
    ]);
    return {
      unsignedPreparation: true,
      locallyInspected: true,
      signedAfterApproval: true,
      broadcast: true,
      exactRecipientAmount: true,
      changedSignedIntentRejected: true,
      confirmedFeeMatches: true,
      privateCanariesAbsentFromEgress: true,
      nativeFailureRecovery: true,
      integratedDestination: true,
      detachedConfirmationRecovered: true,
      recoveryRecordRoundTrip: true,
      receivedOutputSpend: true,
      viewOnlyAuthority: true,
    };
  } catch (error) {
    return { failedAt: phase, diagnostic: classifyError(error) };
  } finally {
    try {
      await sender.close(false);
    } finally {
      await recipient?.close(false);
    }
  }
}

async function assertViewOnlySnapshot(
  wallet: CandidateWallet,
  server: Record<string, unknown>,
): Promise<void> {
  const data = await wallet.getData({ viewOnly: true });
  const [keys, cache] = data;
  let observer: CandidateWallet | undefined;
  try {
    observer = await openWalletFull({
      networkType: 'mainnet',
      regtest: true,
      proxyToWorker: false,
      password: 'disposable local wallet key password',
      keysData: keys,
      cacheData: cache,
      server,
    });
    if (!(await observer.isViewOnly()) || (await wallet.isViewOnly()))
      throw new Error('View-only authority mismatch.');
    await assertSpendKeyUnavailable(observer);
    if (
      (await observer.getPrimaryAddress()) !== (await wallet.getPrimaryAddress()) ||
      (await observer.getHeight()) !== (await wallet.getHeight()) ||
      (await observer.getBalance()) !== (await wallet.getBalance())
    )
      throw new Error('View-only state mismatch.');
  } finally {
    for (const bytes of data) bytes.fill(0);
    await observer?.close(false);
  }
}

async function assertSpendKeyUnavailable(wallet: CandidateWallet): Promise<void> {
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

async function assertReceivedOutputSpend(options: {
  origin: string;
  sender: CandidateWallet;
  recipient: CandidateWallet;
  server: { uri: string; username: string; password: string };
}): Promise<void> {
  await generate(options.origin, await options.sender.getPrimaryAddress(), 10);
  await options.recipient.sync();
  if ((await options.recipient.getUnlockedBalance()) !== 1_000_000_000_000n)
    throw new Error('Received output did not unlock.');
  const signer = new TransactionSigner(options.recipient, {
    networkType: 'mainnet',
    regtest: true,
    password: 'disposable local wallet key password',
  });
  const intent = createIntent({
    address: await options.sender.getPrimaryAddress(),
    amount: '100000000000',
    maximumFee: '100000000000',
  });
  const prepared = await signer.prepare(intent, options.server);
  const signed = await signer.sign(intent, prepared.unsignedHex, prepared.fee);
  await options.recipient.submitTxs(signed.signedHex);
  await generate(options.origin, await options.sender.getPrimaryAddress(), 1);
  await options.recipient.sync();
  if ((await options.recipient.getBalance()) !== 900_000_000_000n - BigInt(prepared.fee))
    throw new Error('Received-output change mismatch.');
}

function assertRecoveryRecord(pending: PendingTransfer): void {
  const bytes = encodeTransferRecovery(pending);
  try {
    const restored = decodeTransferRecovery(bytes);
    if (restored?.unsignedHex !== pending.unsignedHex || restored.signedHex !== pending.signedHex)
      throw new Error('Recovery transaction bytes changed.');
    if (
      pending.status === 'broadcasting' &&
      new TransferJournal(restored).view()?.status !== 'unknown'
    )
      throw new Error('Uncertain transfer was not recovered.');
  } finally {
    bytes.fill(0);
  }
}

async function assertAlteredIntentRejected(
  signer: TransactionSigner,
  intent: SendIntent,
  signedHex: string,
): Promise<void> {
  try {
    await signer.inspect({ ...intent, amount: '2' }, new MoneroTxSet({ signedTxHex: signedHex }));
  } catch {
    return;
  }
  throw new Error('Signed intent mismatch was accepted.');
}

async function assertNativeFailureRecovery(wallet: CandidateWallet): Promise<void> {
  const address = await wallet.getPrimaryAddress();
  for (let attempt = 0; attempt < 10; attempt++) {
    let rejected = false;
    try {
      await wallet.describeTxSet(new MoneroTxSet({ signedTxHex: '00' }));
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error instanceof WebAssembly.RuntimeError ||
        error instanceof TypeError
      )
        throw new Error('Native exception conversion failed.');
      rejected = true;
    }
    if (!rejected) throw new Error('Invalid native set was accepted.');
  }
  if ((await wallet.getPrimaryAddress()) !== address) throw new Error('Native state changed.');
}

async function assertConfirmation(
  sender: CandidateWallet,
  hash: string,
  fee: string,
): Promise<void> {
  await sender.sync();
  const outgoing = await sender.getTx(hash);
  if (!outgoing?.getIsConfirmed() || outgoing.getFee().toString() !== fee)
    throw new Error('Confirmation mismatch.');
}

async function assertReorgRecovery(options: {
  origin: string;
  recipient: CandidateWallet;
  miner: string;
  hash: string;
}): Promise<void> {
  const response = await HttpClient.request({
    uri: `${options.origin}/pop_blocks`,
    method: 'POST',
    username: 'fixture',
    password: 'disposable',
    body: JSON.stringify({ nblocks: 1 }),
    resolveWithFullResponse: true,
  });
  if (response.statusCode !== 200) throw new Error('Reorg fixture failed.');
  await options.recipient.sync();
  const chain = await readChainState(options.recipient, () =>
    readNodeStatus(
      { uri: options.origin, username: 'fixture', password: 'disposable' },
      'fakechain',
    ),
  );
  if (chain.synced) throw new Error('Detached wallet was considered fresh.');
  if (
    (await options.recipient.getTx(options.hash))?.getIsConfirmed() &&
    chain.walletHeight === chain.targetHeight
  )
    throw new Error('Detached transaction remained confirmed at the current tip.');
  await generate(options.origin, options.miner, 2);
  await options.recipient.sync();
  if (
    !(await options.recipient.getTx(options.hash))?.getIsConfirmed() ||
    (await options.recipient.getBalance()) !== 1_000_000_000_000n
  )
    throw new Error('Reorg receipt recovery failed.');
}

function classifyError(error: unknown): string {
  if (!(error instanceof Error)) return 'native-error';
  if ('code' in error && typeof error.code === 'string' && /^[a-z-]+$/.test(error.code))
    return error.code;
  const categories = [
    'not enough',
    'Not enough',
    'No outputs',
    'unlocked balance',
    'missing function',
    'Aborted',
    'change',
    'destinations',
    'undefined',
    'Invalid',
    'invalid',
    'ring',
    'decoy',
    'unconfirmed',
    'Rpc',
    'RPC',
    'unreachable',
    'signature',
    'table',
    'out of bounds',
    'memory',
    'indirect',
    'UnboundType',
    'no txset provided',
    'Cannot convert',
    'Cannot read properties',
    'already been used',
    'Regtest generation failed',
    'Egress fixture budget exceeded',
    'Not funded',
    'Confirmation mismatch',
    'Detached transaction remained confirmed',
    'Detached wallet was considered fresh',
    'Reorg fixture failed',
    'Reorg receipt recovery failed',
    'not found',
    'not connected',
    'No peers',
    'peers',
    'Daemon',
    'daemon',
    'get_connections',
    'requested real output',
    'View-only',
  ];
  const category = categories.filter((value) => error.message.includes(value)).join(',');
  if (category) return category;
  const frames = error.stack?.match(/wasm-function\[\d+\]:0x[0-9a-f]+/g)?.slice(0, 8) ?? [];
  return `${error.name}:${frames.join(',')}`;
}

async function restoredRegtestWallet(server: Record<string, unknown>): Promise<CandidateWallet> {
  const initial = await createWalletFull({
    networkType: 'mainnet',
    regtest: true,
    proxyToWorker: false,
  });
  let seed: string;
  try {
    seed = await initial.getSeed();
  } finally {
    await initial.close(false);
  }
  return createWalletFull({
    networkType: 'mainnet',
    regtest: true,
    proxyToWorker: false,
    server,
    seed,
    restoreHeight: 0,
    password: 'disposable local wallet key password',
  });
}

async function generate(origin: string, address: string, blocks: number): Promise<void> {
  const response = await HttpClient.request({
    uri: `${origin}/json_rpc`,
    method: 'POST',
    username: 'fixture',
    password: 'disposable',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'fixture',
      method: 'generateblocks',
      params: { amount_of_blocks: blocks, wallet_address: address },
    }),
    resolveWithFullResponse: true,
  });
  if (response.statusCode !== 200) throw new Error('Regtest generation failed.');
  const body: unknown = JSON.parse(response.body);
  if (typeof body !== 'object' || body === null) throw new Error('Regtest generation failed.');
  if ('error' in body) {
    const error = body.error;
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'number'
    ) {
      console.log(`wallet-test-rpc-error:${String(error.code)}`);
    }
    throw new Error('Regtest generation failed.');
  }
}
