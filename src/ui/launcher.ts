const button = document.querySelector('#open-wallet');
button?.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('wallet.html') }).catch(() => {
    button.textContent = 'Wallet tab could not open. Try again.';
  });
});
