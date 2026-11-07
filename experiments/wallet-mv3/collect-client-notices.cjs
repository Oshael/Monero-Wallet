const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const source = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);

function packageRoot(filename) {
  const start = filename.indexOf('node_modules/');
  const matches = Array.from(filename.matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/?]+)/g));
  const last = matches.at(-1);
  if (start < 0 || !last) return undefined;
  const relative = filename.slice(start, last.index + last[0].length);
  if (
    !/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(relative) ||
    relative.includes('..')
  )
    throw new Error('Invalid source map package path.');
  return relative;
}

async function packageNotice(relative) {
  const directory = path.join(source, relative);
  const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  const files = (await fs.readdir(directory))
    .filter((name) => /^(?:licen[cs]e(?:[._-].*)?|copying(?:[._-].*)?)$/i.test(name))
    .sort();
  if (!files.length) throw new Error(`Missing license text for shipped package: ${metadata.name}`);
  const notices = [];
  for (const filename of files) {
    const data = await fs.readFile(path.join(directory, filename));
    if (data.byteLength === 0 || data.byteLength > 512 * 1024)
      throw new Error('Invalid dependency notice.');
    notices.push(
      `\n${filename} SHA-256: ${createHash('sha256').update(data).digest('hex')}\n\n${data.toString('utf8')}`,
    );
  }
  return {
    name: metadata.name,
    version: metadata.version,
    license: metadata.license,
    text: `\n=== ${metadata.name} ${metadata.version} ===\nSource: ${relative}\nLicense metadata: ${JSON.stringify(metadata.license)}\n${notices.join('\n')}\n`,
  };
}

async function main() {
  const raw = await fs.readFile(path.join(output, 'wallet-engine-client.js.map'));
  if (raw.byteLength > 100 * 1024 * 1024) throw new Error('Source map budget exceeded.');
  const map = JSON.parse(raw.toString('utf8'));
  const packages = [...new Set(map.sources.map(packageRoot).filter(Boolean))].sort();
  const notices = [];
  for (const relative of packages) notices.push(await packageNotice(relative));
  const text = notices.map((notice) => notice.text).join('\n');
  if (text.length > 8 * 1024 * 1024) throw new Error('Dependency notice budget exceeded.');
  await fs.writeFile(path.join(output, 'client-NOTICES.txt'), text);
  console.log(
    JSON.stringify(notices.map(({ name, version, license }) => ({ name, version, license }))),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
