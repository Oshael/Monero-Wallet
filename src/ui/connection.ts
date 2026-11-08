import { nodeConnection, WalletError } from '../domain/validation.ts';
import type { WalletSession } from '../session/index.ts';
import { element, field, section } from './dom.ts';
import { actionForm, value } from './forms.ts';

export function connectionPanel(options: {
  session: WalletSession;
  report: (message: string) => void;
}): HTMLElement {
  const panel = section('Light wallet service');
  panel.append(
    element(
      'p',
      {},
      'Select the stagenet scanner and its matching node. Scanning runs on the service. Your private view key lets the scanner discover incoming payments. The node sees your IP and lookups for received outputs and transactions. Your seed and private spend key stay on this device; transactions are approved and signed here.',
    ),
  );
  panel.append(
    actionForm({
      title: 'Use selected light wallet service',
      fields: [
        { label: 'Stagenet scanner URL (HTTPS)', name: 'scanner', type: 'url' },
        { label: 'Matching stagenet node URL (HTTPS)', name: 'uri', type: 'url' },
        { label: 'Node username (optional)', name: 'username', required: false },
        { label: 'Node password (optional)', name: 'password', type: 'password', required: false },
        {
          label:
            'I agree to share my private view key with this scanner. Locking the wallet or changing its password does not revoke that key.',
          name: 'view-consent',
          type: 'checkbox',
        },
      ],
      submit: async (form) => {
        if (!field(form, 'view-consent').checked) throw new WalletError('light-consent-required');
        const scanner = nodeConnection({ uri: value(form, 'scanner'), username: '', password: '' });
        const connection = nodeConnection({
          uri: value(form, 'uri'),
          username: value(form, 'username'),
          password: value(form, 'password'),
        });
        const origins = [
          ...new Set([scanner.uri, connection.uri].map((uri) => `${new URL(uri).origin}/*`)),
        ];
        if (!(await chrome.permissions.request({ origins })))
          throw new WalletError('node-permission-denied');
        await options.session.connectLight({ uri: scanner.uri, node: connection });
        field(form, 'view-consent').checked = false;
      },
      report: options.report,
    }),
  );
  panel.append(
    actionForm({
      title: 'Synchronize',
      fields: [],
      submit: async () => options.session.startSync(),
      report: options.report,
    }),
  );
  panel.append(
    actionForm({
      title: 'Stop and save scan',
      fields: [],
      submit: async () => options.session.stopSync(),
      report: options.report,
    }),
  );
  return panel;
}
