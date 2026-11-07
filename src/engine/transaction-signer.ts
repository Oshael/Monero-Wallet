import { createWalletFull, MoneroTxSet, MoneroUtils } from 'wallet-engine-client';
import type { CandidateTransaction, CandidateWallet } from 'wallet-engine-client';
import { WalletError } from '../domain/validation.ts';
import type { NodeConnection } from '../domain/validation.ts';
import { inspectTransaction } from '../transactions/index.ts';
import type { InspectedTransaction, SendIntent } from '../transactions/index.ts';

export class TransactionSigner {
  readonly #wallet: CandidateWallet;
  readonly #network: { networkType: 'stagenet' | 'mainnet'; regtest: boolean };

  constructor(
    wallet: CandidateWallet,
    network: { networkType: 'stagenet' | 'mainnet'; regtest: boolean } = {
      networkType: 'stagenet',
      regtest: false,
    },
  ) {
    this.#wallet = wallet;
    this.#network = network;
  }

  async prepare(
    intent: SendIntent,
    node: NodeConnection,
  ): Promise<{ unsignedHex: string; fee: string }> {
    if (!(await MoneroUtils.isValidAddress(intent.address, this.#network.networkType))) {
      throw new WalletError('invalid-address');
    }
    const observer = await createWalletFull({
      ...this.#network,
      proxyToWorker: false,
      primaryAddress: await this.#wallet.getPrimaryAddress(),
      privateViewKey: await this.#wallet.getPrivateViewKey(),
      server: node,
      isTrustedDaemon: false,
    });
    try {
      await observer.setDaemonConnection({ ...node }, false);
      await observer.importOutputs(await this.#wallet.exportOutputs(true));
      const keyImages = await this.#wallet.exportKeyImages(true);
      await observer.importKeyImages(keyImages.getKeyImages(), keyImages.getOffset());
      // Imported outputs retain their heights; unlock rules also require a current chain tip.
      await observer.sync(await this.#wallet.getHeight());
      const transaction = await observer.createTx({
        accountIndex: 0,
        address: intent.address,
        amount: intent.amount,
        relay: false,
        canSplit: false,
      });
      const unsignedHex = transaction.getTxSet().getUnsignedTxHex();
      if (!unsignedHex) throw new WalletError('unsigned-transaction-unavailable');
      const fee = await this.inspect(intent, new MoneroTxSet({ unsignedTxHex: unsignedHex }));
      return { unsignedHex, fee };
    } finally {
      await observer.close(false);
    }
  }

  async inspect(intent: SendIntent, set: MoneroTxSet): Promise<string> {
    const described = await this.#wallet.describeTxSet(set);
    const transactions = described.getTxs();
    if (transactions.length !== 1 || !transactions[0])
      throw new WalletError('transaction-intent-mismatch');
    const transaction = describe(transactions[0]);
    let ownsChange = transaction.changeAmount === '0';
    if (!ownsChange) {
      try {
        await this.#wallet.getAddressIndex(transaction.changeAddress);
        ownsChange = true;
      } catch {
        throw new WalletError('transaction-change-mismatch');
      }
    }
    inspectTransaction({ intent, transaction, ownsChange });
    return transaction.fee;
  }

  async sign(
    intent: SendIntent,
    unsignedHex: string,
    fee: string,
  ): Promise<{ signedHex: string; hash: string }> {
    const set = new MoneroTxSet({ unsignedTxHex: unsignedHex });
    if ((await this.inspect(intent, set)) !== fee)
      throw new WalletError('transaction-fee-mismatch');
    const signed = await this.#wallet.signTxs(unsignedHex);
    const signedHex = signed.getSignedTxHex();
    const hash = signed.getTxs()[0]?.getHash();
    if (!signedHex || !hash || !/^[0-9a-f]{64}$/.test(hash))
      throw new WalletError('signing-failed');
    const actualFee = await this.inspect(intent, new MoneroTxSet({ signedTxHex: signedHex }));
    if (actualFee !== fee) throw new WalletError('transaction-fee-mismatch');
    return { signedHex, hash };
  }
}

function describe(transaction: CandidateTransaction): InspectedTransaction {
  return {
    destinations: transaction
      .getOutgoingTransfer()
      .getDestinations()
      .map((destination) => ({
        address: destination.getAddress(),
        amount: destination.getAmount().toString(),
      })),
    fee: transaction.getFee().toString(),
    changeAddress: transaction.getChangeAddress(),
    changeAmount: transaction.getChangeAmount().toString(),
    unlockTime: (transaction.getUnlockTime() ?? 0n).toString(),
  };
}
