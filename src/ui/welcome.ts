import type { WalletSession } from '../session/index.ts';
import { element, field, section } from './dom.ts';
import { actionForm, value } from './forms.ts';

interface WelcomeOptions {
  session: WalletSession;
  exists: boolean;
  report: (message: string) => void;
}

export function welcome(options: WelcomeOptions): HTMLElement {
  const container = section(options.exists ? 'Unlock your wallet' : 'Create a stagenet wallet');
  container.append(
    element(
      'p',
      {},
      'This development build supports stagenet test coins. Never enter the seed of a wallet with real funds.',
    ),
  );
  if (options.exists) unlockForm(container, options);
  else createForm(container, options);
  importForm(container, options);
  return container;
}

function createForm(container: HTMLElement, options: WelcomeOptions): void {
  container.append(
    actionForm({
      title: 'Create wallet',
      fields: [{ label: 'Password — at least 12 characters', name: 'password', type: 'password' }],
      submit: async (form) => options.session.create({ password: value(form, 'password') }),
      report: options.report,
    }),
  );
  container.append(
    actionForm({
      title: 'Restore from seed',
      fields: [
        { label: '25-word Monero seed', name: 'seed', type: 'password' },
        { label: 'Restore height (0 scans all history)', name: 'height', type: 'number' },
        { label: 'New password — at least 12 characters', name: 'password', type: 'password' },
      ],
      submit: async (form) =>
        options.session.create({
          password: value(form, 'password'),
          seed: value(form, 'seed'),
          restoreHeight: Number(value(form, 'height')),
        }),
      report: options.report,
    }),
  );
}

function unlockForm(container: HTMLElement, options: WelcomeOptions): void {
  container.append(
    actionForm({
      title: 'Unlock',
      fields: [{ label: 'Password', name: 'password', type: 'password' }],
      submit: async (form) => options.session.unlock(value(form, 'password')),
      report: options.report,
    }),
  );
  const recovery = element('details');
  recovery.append(element('summary', {}, 'Recover the previous local checkpoint'));
  recovery.append(
    element(
      'p',
      {},
      'Use this only if the latest checkpoint cannot open. Recent scan progress and changes may need recovery.',
    ),
  );
  recovery.append(
    actionForm({
      title: 'Recover previous checkpoint',
      fields: [{ label: 'Password', name: 'password', type: 'password' }],
      submit: async (form) => options.session.recoverPrevious(value(form, 'password')),
      report: options.report,
    }),
  );
  container.append(recovery);
}

function importForm(container: HTMLElement, options: WelcomeOptions): void {
  const details = element('details');
  details.append(element('summary', {}, 'Import encrypted backup'));
  if (options.exists)
    details.append(
      element(
        'p',
        {},
        'Import replaces the current local wallet after the backup opens successfully. A previous encrypted checkpoint is retained.',
      ),
    );
  details.append(
    actionForm({
      title: 'Open encrypted backup',
      fields: [
        { label: 'Backup file', name: 'backup', type: 'file' },
        { label: 'Backup password', name: 'password', type: 'password' },
      ],
      submit: async (form) => {
        const file = field(form, 'backup').files?.[0];
        if (!file || file.size > 128 * 1024 * 1024 + 68) throw new Error('Invalid backup.');
        await options.session.importBackup(await file.arrayBuffer(), value(form, 'password'));
      },
      report: options.report,
    }),
  );
  container.append(details);
}
