function withinBudget(operation, label) {
  let timer;
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} deadline exceeded.`)), 5000);
    }),
  ]).finally(() => clearTimeout(timer));
}

module.exports = { withinBudget };
