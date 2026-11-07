import type { WalletSession } from '../session/index.ts';
import { element, section } from './dom.ts';
import { actionForm, value } from './forms.ts';

export function receivingPanel(options: {
  session: WalletSession;
  report: (message: string) => void;
}): HTMLElement {
  const panel = section('Receive');
  const addresses = element('ul');
  const show = (entries: { address: string; label: string }[]) => {
    addresses.replaceChildren(
      ...entries.map((entry) => {
        const row = element('li');
        row.append(element('span', {}, entry.label), element('code', {}, entry.address));
        return row;
      }),
    );
  };
  panel.append(
    actionForm({
      title: 'Show receiving addresses',
      fields: [],
      submit: async () => {
        show(await options.session.addresses());
      },
      report: options.report,
    }),
    actionForm({
      title: 'Create receiving address',
      fields: [{ label: 'Address label', name: 'label', required: false }],
      submit: async (form) => {
        const entries = await options.session.addresses(value(form, 'label'));
        show(entries);
      },
      report: options.report,
    }),
    addresses,
  );
  return panel;
}
