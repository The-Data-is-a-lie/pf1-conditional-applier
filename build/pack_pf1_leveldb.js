/**
 * Compile a JSON array of Foundry Item documents into a LevelDB compendium pack that FoundryVTT v13
 * can read directly -- the same on-disk format the pf1 system and pf-content module ship.
 *
 * Each document is stored under key `!items!<_id>` with the value being the document itself (no
 * `_key` field; `_id` matches the key), mirroring a real pf1 pack. The target pack dir is wiped and
 * rewritten each run so rebuilds are clean.
 *
 * Requires the `classic-level` package (the exact LevelDB binding Foundry uses), which `npm install`
 * pulls in as a devDependency of this repo.
 *
 * IMPORTANT: Foundry holds an exclusive lock on every pack it has open. Only run this against a pack
 * Foundry is NOT currently serving -- a brand-new pack dir (Foundry learns about it on restart) is
 * safe; an existing one requires Foundry to be closed.
 *
 * Usage:
 *     node pack_pf1_leveldb.js <items.json> <pack-dir>
 */
import fs from 'node:fs';
import { ClassicLevel } from 'classic-level';

async function main() {
  const [, , itemsPath, packDir] = process.argv;
  if (!itemsPath || !packDir) {
    console.error('usage: node pack_pf1_leveldb.js <items.json> <pack-dir>');
    process.exit(2);
  }
  const docs = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
  if (!Array.isArray(docs)) throw new Error('items file must be a JSON array of documents');

  fs.mkdirSync(packDir, { recursive: true });
  const db = new ClassicLevel(packDir, { keyEncoding: 'utf8', valueEncoding: 'json' });
  await db.open();

  // Clean rebuild: drop every existing entry first.
  const oldKeys = [];
  for await (const k of db.keys()) oldKeys.push(k);
  if (oldKeys.length) await db.batch(oldKeys.map((key) => ({ type: 'del', key })));

  const seen = new Set();
  const ops = [];
  for (const doc of docs) {
    if (!doc || !doc._id) throw new Error(`document missing _id: ${doc && doc.name}`);
    if (seen.has(doc._id)) throw new Error(`duplicate _id ${doc._id} (${doc.name})`);
    seen.add(doc._id);
    ops.push({ type: 'put', key: `!items!${doc._id}`, value: doc });
  }
  await db.batch(ops);
  await db.close();
  console.log(`packed ${ops.length} item(s) -> ${packDir} (cleared ${oldKeys.length} old key(s))`);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
