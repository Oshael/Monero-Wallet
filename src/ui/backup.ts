import type { WalletSession } from '../session/index.ts';
import { element, section } from './dom.ts';
import { actionForm, value } from './forms.ts';

export function backupPanel(options: {
  session: WalletSession;
  report: (message: string) => void;
  signal: AbortSignal;
}): HTMLElement {
  const panel = section('Backup and recovery');
  panel.append(
    element(
      'p',
      {},
      'Write down your 25-word seed offline. Anyone with the seed can spend the wallet. Never share it with support.',
    ),
  );
  const seedView = element('pre', { 'aria-label': 'Wallet seed', hidden: '' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(timer);
    seedView.textContent = '';
    seedView.hidden = true;
  };
  panel.append(
    actionForm({
      title: 'Reveal seed for 30 seconds',
      fields: [{ label: 'Current password', name: 'password', type: 'password' }],
      submit: async (form) => {
        hide();
        const seed = await options.session.seed(value(form, 'password'));
        seedView.textContent = seed;
        seedView.hidden = false;
        timer = setTimeout(hide, 30_000);
      },
      report: options.report,
    }),
  );
  const hideButton = element('button', { type: 'button' }, 'Hide seed');
  hideButton.addEventListener('click', hide);
  panel.append(seedView, hideButton);
  panel.append(
    actionForm({
      title: 'Verify written seed',
      fields: [{ label: 'Enter the saved 25-word seed', name: 'seed', type: 'password' }],
      submit: async (form) => options.session.verifySeed(value(form, 'seed')),
      report: options.report,
    }),
  );
  panel.append(
    actionForm({
      title: 'Download encrypted backup',
      fields: [],
      submit: async () => {
        download(await options.session.exportBackup());
      },
      report: options.report,
    }),
  );
  panel.append(
    element(
      'p',
      {},
      'The encrypted backup includes wallet scan data and node settings. The seed alone recovers XMR, without labels and local metadata.',
    ),
  );
  panel.append(
    actionForm({
      title: 'Change password',
      fields: [
        { label: 'Current password', name: 'old', type: 'password' },
        { label: 'New password — at least 12 characters', name: 'next', type: 'password' },
      ],
      submit: async (form) =>
        options.session.changePassword(value(form, 'old'), value(form, 'next')),
      report: options.report,
    }),
  );
  panel.append(
    element(
      'p',
      {},
      'Previously exported backups keep their original password. Replacing local records cannot revoke copies of an old backup.',
    ),
  );
  options.signal.addEventListener('abort', hide, { once: true });
  // Background throttling can delay the timer. Hide on every visibility change.
  document.addEventListener('visibilitychange', hide, { signal: options.signal });
  return panel;
}

function download(backup: ArrayBuffer): void {
  const url = URL.createObjectURL(new Blob([backup], { type: 'application/octet-stream' }));
  const link = element('a', { href: url, download: 'wallet-backup.xmrvault' });
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
