export async function waitForFixtureLockRelease(): Promise<void> {
  // Workers terminate synchronously; Chromium acknowledges Web Lock release
  // asynchronously. Immediate fixture reacquisition must wait for that boundary.
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const state = await navigator.locks.query();
    if (!state.held?.some((lock) => lock.name === 'xmr-wallet-unlocked-session')) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Lock release fixture deadline.');
}
