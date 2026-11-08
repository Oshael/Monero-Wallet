import type { LightServiceView } from '../domain/light-service.ts';
import { WalletError } from '../domain/validation.ts';
import type { WalletSession } from '../session/index.ts';
import { element, field, section } from './dom.ts';
import { actionForm } from './forms.ts';

export function scannerDeletionPanel(options: {
  session: WalletSession;
  report: (message: string) => void;
}): { element: HTMLElement; update: (view: LightServiceView | undefined) => void } {
  const panel = section('Scanner registration and deletion');
  const status = element('p', { id: 'light-registration', role: 'status' });
  panel.append(
    status,
    element(
      'p',
      {},
      'The scanner keeps its registration until you request deletion, including while the wallet is locked. This stage has no scanner database backups. Deleting a registration keeps your local wallet and recovery data. Previously learned information cannot be revoked, and residual bytes may remain in encrypted storage.',
    ),
    actionForm({
      title: 'Delete selected scanner registration',
      fields: [
        {
          label:
            'Stop this scanner registration and request deletion. Keep my local wallet, seed, labels and transfer history.',
          name: 'delete-consent',
          type: 'checkbox',
        },
      ],
      submit: async (form) => {
        if (!field(form, 'delete-consent').checked)
          throw new WalletError('scanner-deletion-consent-required');
        const uri = options.session.view?.lightService?.uri;
        if (!uri) throw new WalletError('light-service-required');
        await deletionPermissions([new URL(uri).origin]);
        field(form, 'delete-consent').checked = false;
        await options.session.deleteLightAccount();
        requireCompletedDeletion(options.session);
      },
      report: options.report,
    }),
    actionForm({
      title: 'Retry pending scanner deletion',
      fields: [],
      submit: async () => {
        const origins = options.session.view?.lightService?.deletionOrigins ?? [];
        if (origins.length === 0) throw new WalletError('no-pending-scanner-deletion');
        await deletionPermissions(origins);
        await options.session.retryLightDeletions();
        requireCompletedDeletion(options.session);
      },
      report: options.report,
    }),
  );
  return {
    element: panel,
    update: (view) => {
      status.textContent = registrationStatus(view);
      panel.hidden = !view?.uri;
    },
  };
}

async function deletionPermissions(origins: string[]): Promise<void> {
  if (
    !(await chrome.permissions.request({
      origins: [...new Set(origins.map((origin) => `${origin}/*`))],
    }))
  ) {
    throw new WalletError('node-permission-denied');
  }
}

function requireCompletedDeletion(session: WalletSession): void {
  if (session.view?.lightService?.pendingDeletions !== 0)
    throw new WalletError('scanner-deletion-pending');
}

function registrationStatus(view: LightServiceView | undefined): string {
  if (!view?.uri) return 'No scanner selected.';
  const messages = {
    connected: 'Selected scanner; synchronization can register this wallet.',
    deleting:
      'Deletion requested. Synchronization is disabled until you explicitly select a service again.',
    deleted:
      'Requested registration deleted from the active server database. Synchronization remains disabled until fresh consent.',
  };
  const pending = view.pendingDeletions
    ? ` ${String(view.pendingDeletions)} deletion request(s) still need confirmation. Retry to continue; earlier scanners remain tracked.`
    : '';
  return `${new URL(view.uri).origin}: ${messages[view.phase]}${pending}`;
}
