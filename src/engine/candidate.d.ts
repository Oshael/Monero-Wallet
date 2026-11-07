declare module 'wallet-engine-client' {
  export interface CandidateSubaddress {
    getAddress(): string;
    getLabel(): string | undefined;
  }

  export interface CandidateWallet {
    getPrimaryAddress(): Promise<string>;
    getSeed(): Promise<string>;
    getPrivateViewKey(): Promise<string>;
    getPrivateSpendKey(): Promise<string>;
    isViewOnly(): Promise<boolean>;
    createTx(config: Record<string, unknown>): Promise<CandidateTransaction>;
    describeTxSet(set: CandidateTxSet): Promise<CandidateTxSet>;
    signTxs(unsignedHex: string): Promise<CandidateTxSet>;
    submitTxs(signedHex: string): Promise<string[]>;
    getTx(hash: string): Promise<CandidateTransaction | undefined>;
    getAddressIndex(address: string): Promise<unknown>;
    getHeight(): Promise<number>;
    getRestoreHeight(): Promise<number>;
    getDaemonHeight(): Promise<number>;
    getDaemonMaxPeerHeight(): Promise<number>;
    isDaemonSynced(): Promise<boolean>;
    getBalance(): Promise<bigint>;
    getUnlockedBalance(): Promise<bigint>;
    getData(options?: { viewOnly?: boolean }): Promise<Uint8Array<ArrayBuffer>[]>;
    createSubaddress(accountIndex: number, label: string): Promise<CandidateSubaddress>;
    getSubaddresses(accountIndex: number): Promise<CandidateSubaddress[]>;
    setDaemonConnection(connection: Record<string, unknown>, trusted: boolean): Promise<void>;
    sync(listenerOrHeight?: MoneroWalletListener | number): Promise<unknown>;
    stopSyncing(): Promise<void>;
    close(save: boolean): Promise<void>;
  }

  export interface CandidateTransaction {
    getHash(): string | undefined;
    getFee(): bigint;
    getChangeAddress(): string;
    getChangeAmount(): bigint;
    getUnlockTime(): bigint | undefined;
    getTxSet(): CandidateTxSet;
    getOutgoingTransfer(): { getDestinations(): { getAddress(): string; getAmount(): bigint }[] };
    getIsConfirmed(): boolean;
    getIsFailed(): boolean;
  }

  export class MoneroTxSet implements CandidateTxSet {
    constructor(config: { unsignedTxHex?: string; signedTxHex?: string });
    getUnsignedTxHex(): string | undefined;
    getSignedTxHex(): string | undefined;
    getTxs(): CandidateTransaction[];
  }

  export interface CandidateTxSet {
    getUnsignedTxHex(): string | undefined;
    getSignedTxHex(): string | undefined;
    getTxs(): CandidateTransaction[];
  }

  export const MoneroUtils: {
    isValidAddress(address: string, networkType: string): Promise<boolean>;
    getIntegratedAddress(
      networkType: string,
      address: string,
      paymentId: string,
    ): Promise<{
      getIntegratedAddress(): string;
    }>;
  };
  export const HttpClient: {
    request(options: Record<string, unknown>): Promise<{ statusCode: number; body: string }>;
  };

  export class MoneroWalletListener {
    onSyncProgress(height: number, startHeight: number, endHeight: number): Promise<void>;
    onBalancesChanged(balance: bigint, unlockedBalance: bigint): Promise<void>;
  }

  export const LibraryUtils: {
    setWorkerLoader(loader: () => Worker): void;
    setLogLevel(level: number): Promise<void>;
    getWasmMemoryUsed(): Promise<number>;
  };

  export function createWalletFull(config: Record<string, unknown>): Promise<CandidateWallet>;
  export function openWalletFull(config: Record<string, unknown>): Promise<CandidateWallet>;
  export function shutdown(): Promise<void>;
}
