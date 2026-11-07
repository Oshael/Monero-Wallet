import { nodeConnection, WalletError } from '../domain/validation.ts';
import type { WalletSession } from '../session/index.ts';
import { element, section } from './dom.ts';
import { actionForm, value } from './forms.ts';

export function connectionPanel(options: {
  session: WalletSession;
  report: (message: string) => void;
}): HTMLElement {
  const panel = section('Node and synchronization');
  panel.append(
    element(
      'p',
      {},
      'Select a compatible stagenet node. Its operator sees your IP and request metadata. Wallet keys remain local.',
    ),
  );
  panel.append(
    actionForm({
      title: 'Connect to selected node',
      fields: [
        { label: 'Stagenet node URL (HTTPS)', name: 'uri', type: 'url' },
        { label: 'Node username (optional)', name: 'username', required: false },
        { label: 'Node password (optional)', name: 'password', type: 'password', required: false },
      ],
      submit: async (form) => {
        const connection = nodeConnection({
          uri: value(form, 'uri'),
          username: value(form, 'username'),
          password: value(form, 'password'),
        });
        const origin = `${new URL(connection.uri).origin}/*`;
        if (!(await chrome.permissions.request({ origins: [origin] })))
          throw new WalletError('node-permission-denied');
        await options.session.connect(connection);
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
