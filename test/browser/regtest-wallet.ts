import { createWalletFull, HttpClient } from 'wallet-engine-client';
import type { CandidateWallet } from 'wallet-engine-client';

export async function restoredRegtestWallet(
  server: Record<string, unknown>,
): Promise<CandidateWallet> {
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

export async function generate(origin: string, address: string, blocks: number): Promise<void> {
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
