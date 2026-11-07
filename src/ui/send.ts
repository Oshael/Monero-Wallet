import { formatAmount, parseAmount } from '../domain/validation.ts';
import type { WalletView } from '../domain/wallet-view.ts';
import type { WalletSession } from '../session/index.ts';
import { element, section } from './dom.ts';
import { actionForm, value } from './forms.ts';

interface SendScreen {
  element: HTMLElement;
  update: (status: { pending: WalletView['pending']; fresh: boolean }) => void;
}

export function sendPanel(options: {
  session: WalletSession;
  report: (message: string) => void;
}): SendScreen {
  const panel = section('Send stagenet XMR');
  const approval = element('div');
  const pending = element('div', { id: 'pending-send' });
  let rendered = '';
  panel.append(
    element(
      'p',
      {},
      'Review the full destination, amount and exact fee before authorizing a local signature. A separate action broadcasts the signed transaction.',
    ),
  );
  const prepareForm = actionForm({
    title: 'Prepare transaction for review',
    fields: [
      { label: 'Stagenet destination address', name: 'address' },
      { label: 'Amount in XMR', name: 'amount' },
      { label: 'Maximum miner fee in XMR', name: 'fee' },
    ],
    submit: async (form) => {
      await options.session.prepareSend({
        address: value(form, 'address'),
        amount: parseAmount(value(form, 'amount')).toString(),
        maximumFee: parseAmount(value(form, 'fee')).toString(),
      });
    },
    report: options.report,
  });
  prepareForm.addEventListener('input', () => {
    approval.replaceChildren();
  });
  panel.append(prepareForm, approval, pending);
  panel.append(
    actionForm({
      title: 'Broadcast approved transaction',
      fields: [],
      submit: async () => {
        const id = options.session.view?.pending?.id;
        if (!id) throw new Error('No pending transfer.');
        await options.session.broadcastSend(id);
      },
      report: options.report,
    }),
    actionForm({
      title: 'Reconcile pending transaction',
      fields: [],
      submit: async () => options.session.reconcileSend(),
      report: options.report,
    }),
    actionForm({
      title: 'Discard an unbroadcast transaction',
      fields: [],
      submit: async () => {
        const id = options.session.view?.pending?.id;
        if (!id) throw new Error('No pending transfer.');
        await options.session.cancelSend(id);
      },
      report: options.report,
    }),
    element(
      'p',
      {},
      'If broadcasting has an unknown result, reconcile it before preparing another spend. Retrying uses the same signed bytes and cannot create a second transaction.',
    ),
  );
  return {
    element: panel,
    update: (status) => {
      renderPending(pending, status);
      const current = status.pending ? `${status.pending.id}:${status.pending.status}` : 'empty';
      if (rendered === current) return;
      rendered = current;
      approval.replaceChildren();
      if (status.pending?.status === 'prepared')
        approval.append(
          review(status.pending, {
            approve: (id) => options.session.approveSend(id),
            report: options.report,
          }),
        );
    },
  };
}

function renderPending(
  container: HTMLElement,
  status: { pending: WalletView['pending']; fresh: boolean },
): void {
  const pending = status.pending;
  if (!pending) {
    container.replaceChildren(element('p', {}, 'No pending transaction.'));
    return;
  }
  const label = status.fresh ? 'Transaction' : 'Last saved transaction status';
  container.replaceChildren(
    element('p', {}, `${label}: ${pending.status} ${pending.hash}`),
    element(
      'p',
      {},
      `Amount: ${formatAmount(pending.amount)} XMR · Fee: ${formatAmount(pending.fee)} XMR · Stagenet`,
    ),
    element('p', {}, 'Destination:'),
    element('code', {}, pending.address),
  );
}

function review(
  preview: NonNullable<WalletView['pending']>,
  options: {
    approve: (id: string) => Promise<void>;
    report: (message: string) => void;
  },
): HTMLElement {
  const root = element('div');
  root.append(
    element('p', {}, `Destination: ${preview.address}`),
    element(
      'p',
      {},
      `Amount: ${formatAmount(preview.amount)} XMR · Exact fee: ${formatAmount(preview.fee)} XMR · Stagenet`,
    ),
    element(
      'p',
      {},
      `Approval expires ${new Date(preview.expiresAt).toLocaleString()}. Changing any field requires a new transaction.`,
    ),
    actionForm({
      title: 'Approve exact transaction and sign locally',
      fields: [],
      submit: async () => options.approve(preview.id),
      report: options.report,
    }),
  );
  return root;
}
