import { createWalletFull, openWalletFull } from 'wallet-engine-client';
import type { CandidateWallet } from 'wallet-engine-client';
import { WalletError } from '../domain/validation.ts';
import type { WalletView } from '../domain/wallet-view.ts';
import type { WorkerResult } from '../runtime/worker-host.ts';
import { isTransferCommand, isConnectionCommand } from './messages.ts';
import type {
  EngineCommand,
  EngineReply,
  TransferCommand,
  ConnectionCommand,
  LightDeletionCommand,
} from './messages.ts';
import { decodeSnapshot, encodeSnapshot } from './snapshot.ts';
import type { EngineMetadata } from './snapshot.ts';
import { WalletConnection } from './connection.ts';
import { WalletTransfers } from './transfers.ts';

interface UnlockedWallet {
  wallet: CandidateWallet;
  metadata: Omit<EngineMetadata, 'pending' | 'node' | 'light'>;
  address: string;
  connection: WalletConnection;
  transfers: WalletTransfers;
}

export class EngineRuntime {
  #unlocked: UnlockedWallet | undefined;

  async execute(command: EngineCommand): Promise<WorkerResult<EngineReply>> {
    if (isTransferCommand(command)) return this.#transfer(command);
    if (isConnectionCommand(command)) return this.#setConnection(command);
    switch (command.kind) {
      case 'create':
        return this.#create(command);
      case 'open':
        return this.#open(command.snapshot);
      case 'view':
        return this.#view();
      case 'snapshot':
        return this.#snapshot();
      case 'seed':
        return { value: { kind: 'seed', seed: await this.#ready().wallet.getSeed() } };
      case 'verify-seed':
        return this.#verifySeed(command.seed);
      case 'start-sync':
        return this.#startSync();
      default:
        return this.#receivingOrStop(command);
    }
  }

  async #receivingOrStop(
    command: Extract<EngineCommand, { kind: 'addresses' | 'subaddress' | 'stop-sync' }>,
  ): Promise<WorkerResult<EngineReply>> {
    if (command.kind === 'stop-sync') {
      await this.#active().connection.stop();
      return this.#view();
    }
    return this.#addresses(command);
  }

  async #transfer(command: TransferCommand): Promise<WorkerResult<EngineReply>> {
    const active = this.#ready();
    switch (command.kind) {
      case 'prepare-send':
        return this.#prepareSend(command);
      case 'approve-send':
        await active.transfers.approve(command.id);
        break;
      case 'arm-send':
        active.transfers.armBroadcast(command.id);
        break;
      case 'broadcast-send':
        await active.transfers.broadcast(command.id);
        break;
      case 'cancel-send':
        active.transfers.cancel(command.id);
        break;
      case 'reconcile-send':
        await active.transfers.reconcile();
        break;
    }
    if (command.kind === 'broadcast-send') await active.connection.state.afterBroadcast();
    if (command.kind === 'reconcile-send') await active.connection.state.refreshBalances();
    return this.#view();
  }

  async #prepareSend(
    command: Extract<TransferCommand, { kind: 'prepare-send' }>,
  ): Promise<WorkerResult<EngineReply>> {
    const active = this.#ready();
    const node = active.connection.snapshot().node;
    if (!node || !active.metadata.backupVerified)
      throw new WalletError('verified-backup-and-node-required');
    await active.connection.state.assertSpendable();
    return {
      value: {
        kind: 'send-preview',
        preview: await active.transfers.prepare(
          command.intent,
          node,
          active.connection.preparation(),
        ),
      },
    };
  }

  #startSync(): WorkerResult<EngineReply> {
    const unlocked = this.#ready();
    unlocked.connection.start();
    return this.#view();
  }

  async #create(
    command: Extract<EngineCommand, { kind: 'create' }>,
  ): Promise<WorkerResult<EngineReply>> {
    if (this.#unlocked) throw new WalletError('already-unlocked');
    const metadata: EngineMetadata = {
      version: 1,
      network: 'stagenet',
      enginePassword: Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
      restoreHeight: command.restoreHeight,
      backupVerified: false,
      node: null,
      pending: null,
    };
    const seed = command.seed.trim().replace(/\s+/g, ' ');
    const restore = seed ? { seed, restoreHeight: command.restoreHeight } : {};
    const wallet = await createWalletFull({
      networkType: 'stagenet',
      proxyToWorker: false,
      password: metadata.enginePassword,
      ...restore,
    });
    try {
      if (!seed) metadata.restoreHeight = await wallet.getRestoreHeight();
      await this.#attach(wallet, metadata);
    } catch (error) {
      await wallet.close(false);
      throw error;
    }
    return this.#view();
  }

  async #open(snapshot: ArrayBuffer): Promise<WorkerResult<EngineReply>> {
    if (this.#unlocked) throw new WalletError('already-unlocked');
    let decoded;
    try {
      decoded = decodeSnapshot(snapshot);
      const { metadata, keys, cache } = decoded;
      const server = metadata.node ? { server: metadata.node } : {};
      const wallet = await openWalletFull({
        networkType: metadata.network,
        proxyToWorker: false,
        password: metadata.enginePassword,
        keysData: keys,
        cacheData: cache,
        ...server,
      });
      try {
        if (metadata.light && metadata.light.height > 0) {
          await wallet.restoreLightWalletHeight(metadata.light.height);
        }
        await this.#attach(wallet, metadata);
      } catch (error) {
        await wallet.close(false);
        throw error;
      }
      return this.#view();
    } finally {
      new Uint8Array(snapshot).fill(0);
      decoded?.keys.fill(0);
      decoded?.cache.fill(0);
    }
  }

  async #attach(wallet: CandidateWallet, metadata: EngineMetadata): Promise<void> {
    const { pending, node, light, ...settings } = metadata;
    const connection = await WalletConnection.create(wallet, {
      node,
      ...(light === undefined ? {} : { light }),
      network: settings.network,
      restoreHeight: settings.restoreHeight,
    });
    this.#unlocked = {
      wallet,
      metadata: settings,
      address: await wallet.getPrimaryAddress(),
      connection,
      transfers: new WalletTransfers(wallet, pending, settings.enginePassword),
    };
  }

  async #snapshot(): Promise<WorkerResult<EngineReply>> {
    const { wallet, metadata, transfers, connection } = this.#ready();
    const data = await wallet.getData();
    const [keys, cache] = data;
    if (!keys || !cache) throw new WalletError('snapshot-failed');
    try {
      const snapshot = encodeSnapshot({
        metadata: { ...metadata, ...connection.snapshot(), pending: transfers.snapshot() },
        keys,
        cache,
      });
      return { value: { kind: 'snapshot', snapshot }, transfer: [snapshot] };
    } finally {
      keys.fill(0);
      cache.fill(0);
    }
  }

  async #verifySeed(seed: string): Promise<WorkerResult<EngineReply>> {
    const active = this.#ready();
    const actual = await active.wallet.getSeed();
    if (actual !== seed.trim().replace(/\s+/g, ' ')) throw new WalletError('backup-mismatch');
    active.metadata.backupVerified = true;
    return this.#view();
  }

  async #setConnection(command: ConnectionCommand): Promise<WorkerResult<EngineReply>> {
    if (command.kind !== 'node' && command.kind !== 'light-service')
      return this.#lightDeletion(command);
    const active = this.#ready();
    if (command.kind === 'node') await active.connection.selectNode(command.node);
    else await active.connection.selectLight(command);
    return this.#view();
  }

  async #lightDeletion(command: LightDeletionCommand): Promise<WorkerResult<EngineReply>> {
    const connection = this.#active().connection;
    switch (command.kind) {
      case 'request-light-deletion':
        await connection.requestLightDeletion();
        break;
      case 'prepare-light-deletion':
        await connection.prepareLightDeletion();
        break;
      case 'finish-light-deletion':
        await connection.finishLightDeletion();
        break;
    }
    return this.#view();
  }

  async #addresses(
    command: Extract<EngineCommand, { kind: 'addresses' | 'subaddress' }>,
  ): Promise<WorkerResult<EngineReply>> {
    const { wallet } = this.#ready();
    const addresses = await wallet.getSubaddresses(0);
    if (command.kind === 'subaddress') {
      if (addresses.length >= 1000) throw new WalletError('too-many-addresses');
      addresses.push(await wallet.createSubaddress(0, command.label));
    }
    return {
      value: {
        kind: 'addresses',
        addresses: addresses.map((entry) => ({
          address: entry.getAddress(),
          label: entry.getLabel() ?? '',
        })),
      },
    };
  }

  #view(): WorkerResult<EngineReply> {
    const active = this.#active();
    const lightService = active.connection.lightServiceView();
    const view: WalletView = {
      address: active.address,
      ...active.connection.state.view(),
      backupVerified: active.metadata.backupVerified,
      ...(lightService === undefined ? {} : { lightService }),
      pending: active.transfers.view(),
    };
    return { value: { kind: 'view', view } };
  }

  #active(): UnlockedWallet {
    if (!this.#unlocked) throw new WalletError('wallet-locked');
    this.#unlocked.connection.assertHealthy();
    return this.#unlocked;
  }

  #ready(): UnlockedWallet {
    const active = this.#active();
    if (active.connection.state.status === 'syncing') throw new WalletError('sync-busy');
    return active;
  }
}
