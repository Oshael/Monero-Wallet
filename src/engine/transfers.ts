import type { CandidateWallet } from 'wallet-engine-client';
import { WalletError } from '../domain/validation.ts';
import type { NodeConnection } from '../domain/validation.ts';
import { previewTransfer, TransferJournal } from '../transactions/index.ts';
import type {
  PendingTransfer,
  SendIntent,
  SendPreview,
  TransferStatus,
} from '../transactions/index.ts';
import { TransactionSigner } from './transaction-signer.ts';

export class WalletTransfers {
  readonly #wallet: CandidateWallet;
  readonly #signer: TransactionSigner;
  readonly #journal: TransferJournal;

  constructor(wallet: CandidateWallet, pending: PendingTransfer | null, password: string) {
    this.#wallet = wallet;
    this.#signer = new TransactionSigner(wallet, { password });
    this.#journal = new TransferJournal(pending);
  }

  snapshot(): PendingTransfer | null {
    return this.#journal.snapshot();
  }

  view(): TransferStatus | null {
    return this.#journal.view();
  }

  async prepare(intent: SendIntent, node: NodeConnection): Promise<SendPreview> {
    this.#journal.assertCanPrepare();
    const created = await this.#signer.prepare(intent, node);
    const pending: PendingTransfer = {
      intent,
      ...created,
      signedHex: '',
      hash: '',
      status: 'prepared',
    };
    this.#journal.prepared(pending);
    return previewTransfer(pending);
  }

  async approve(id: string): Promise<void> {
    const pending = this.#journal.require(id, ['prepared']);
    if (Date.now() > pending.intent.expiresAt) throw new WalletError('approval-expired');
    const signed = await this.#signer.sign(pending.intent, pending.unsignedHex, pending.fee);
    this.#journal.signed(id, signed);
  }

  armBroadcast(id: string): void {
    this.#journal.arm(id);
  }

  async broadcast(id: string): Promise<void> {
    const pending = this.#journal.require(id, ['broadcasting']);
    try {
      const hashes = await this.#wallet.submitTxs(pending.signedHex);
      if (hashes.length !== 1 || hashes[0] !== pending.hash)
        throw new WalletError('broadcast-response-mismatch');
      this.#journal.broadcastResult(id, true);
    } catch {
      this.#journal.broadcastResult(id, false);
    }
  }

  async reconcile(): Promise<void> {
    const pending = this.#journal.snapshot();
    if (!pending?.hash) return;
    const transaction = await this.#wallet.getTx(pending.hash);
    if (!transaction || transaction.getIsFailed()) {
      this.#journal.unobserved(pending.intent.id);
      return;
    }
    this.#journal.observed(pending.intent.id, transaction.getIsConfirmed());
  }

  cancel(id: string): void {
    this.#journal.cancel(id);
  }
}
