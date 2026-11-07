import { WalletSession } from '../session/index.ts';
import { element } from './dom.ts';
import { welcome } from './welcome.ts';
import { walletScreen } from './wallet.ts';

const session = new WalletSession();
const app = document.querySelector('#app');
const status = document.querySelector('#status');
if (!(app instanceof HTMLElement) || !(status instanceof HTMLElement))
  throw new Error('Missing wallet shell.');
const root = app;
const message = status;
let screen: ReturnType<typeof walletScreen> | undefined;
let lifetime: AbortController | undefined;
let revision = 0;

function report(value: string): void {
  message.textContent = value;
}

async function render(): Promise<void> {
  const current = ++revision;
  const view = session.view;
  if (view) {
    if (!screen) {
      lifetime = new AbortController();
      screen = walletScreen({ session, report, signal: lifetime.signal });
      root.replaceChildren(screen.element);
    }
    screen.update(view);
    return;
  }
  lifetime?.abort();
  lifetime = undefined;
  screen = undefined;
  root.replaceChildren(element('p', {}, 'Opening local wallet storage…'));
  const exists = await session.exists();
  if (current !== revision) return;
  root.replaceChildren(welcome({ session, exists, report }));
}

function update(): void {
  void render().catch(() => {
    report('Local wallet storage could not be opened.');
  });
}

session.addEventListener('change', update);
session.addEventListener('operationfailed', () => {
  report('An operation failed. Stop the scan or lock and reopen to recover the last saved state.');
});
window.addEventListener('pagehide', () => {
  session.lock();
  lifetime?.abort();
});
update();
