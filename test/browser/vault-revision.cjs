async function vaultRevision(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('xmr-wallet-vault');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Fixture database failed.'));
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('encrypted-vault', 'readonly');
        const request = transaction.objectStore('encrypted-vault').get('active');
        let revision;
        request.onsuccess = () => {
          revision = request.result?.revision;
        };
        transaction.oncomplete = () => {
          if (typeof revision === 'string') resolve(revision);
          else reject(new Error('Fixture revision unavailable.'));
        };
        transaction.onabort = () => reject(new Error('Fixture transaction failed.'));
      });
    } finally {
      database.close();
    }
  });
}

module.exports = { vaultRevision };
