import { formatAmount } from '../domain/validation.ts';
import type { WalletView } from '../domain/wallet-view.ts';
import type { WalletSession } from '../session/index.ts';
import { element, section } from './dom.ts';
import { connectionPanel } from './connection.ts';
import { scannerDeletionPanel } from './scanner-deletion.ts';
import { receivingPanel } from './receive.ts';
import { backupPanel } from './backup.ts';
import { sendPanel } from './send.ts';

interface WalletScreen {
  element: HTMLElement;
  update: (view: WalletView) => void;
}

export function walletScreen(options: {
  session: WalletSession;
  report: (message: string) => void;
  signal: AbortSignal;
}): WalletScreen {
  const root = element('div');
  const overview = section('Stagenet wallet');
  const balances = element('p', { role: 'status', id: 'wallet-balances' });
  const syncState = element('p', { id: 'wallet-sync' });
  const address = element('code', { id: 'wallet-address' });
  const backupState = element('p', { id: 'backup-state' });
  const lock = element('button', { type: 'button' }, 'Lock wallet');
  const sends = sendPanel(options);
  const deletions = scannerDeletionPanel(options);
  lock.addEventListener('click', () => {
    options.session.lock();
  });
  overview.append(balances, syncState, address, backupState, lock);
  root.append(
    overview,
    connectionPanel(options),
    deletions.element,
    receivingPanel(options),
    sends.element,
    backupPanel(options),
  );
  return {
    element: root,
    update: (view) => {
      balances.textContent = `Total: ${formatAmount(view.balance)} · Unlocked: ${formatAmount(view.unlockedBalance)} stagenet XMR`;
      const labels = {
        'waiting-node': 'Waiting for the selected node',
        'waiting-scanner': 'Waiting for the service to scan this wallet',
      };
      const status =
        view.sync === 'waiting-node' || view.sync === 'waiting-scanner'
          ? labels[view.sync]
          : view.sync;
      syncState.textContent = `${status} · Scanned ${String(view.height)} / ${String(view.targetHeight)}. Balances may be stale until synchronization completes.`;
      address.textContent = view.address;
      backupState.textContent = view.backupVerified
        ? 'Written seed verified.'
        : 'Verify your written seed before receiving a meaningful amount.';
      deletions.update(view.lightService);
      sends.update({ pending: view.pending, fresh: view.sync === 'synced' });
    },
  };
}
