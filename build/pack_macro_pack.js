/**
 * Compile a JSON array of Foundry documents into a LevelDB compendium pack -- the on-disk format
 * FoundryVTT v11+ reads directly, with the collection prefix parameterised so it can build the
 * Macro pack this module ships.
 *
 * Each document is stored under `!<collection>!<_id>`, value = the document itself. The pack dir is
 * wiped and rewritten each run so rebuilds are clean.
 *
 *     npm install                                      # pulls the classic-level devDependency
 *     npm run pack:macros                              # -> packs/macros
 *     node build/pack_macro_pack.js <docs.json> <pack-dir> [collection=macros]
 *
 * IMPORTANT: Foundry holds an exclusive lock on every pack it has open. CLOSE FOUNDRY before
 * rebuilding an existing pack, or the open() below fails with a lock error.
 */
import fs from "node:fs";
import { ClassicLevel } from "classic-level";

const [, , docsPath, packDir, collection = "macros"] = process.argv;
if (!docsPath || !packDir) {
  console.error("usage: node build/pack_macro_pack.js <docs.json> <pack-dir> [collection]");
  process.exit(2);
}

const docs = JSON.parse(fs.readFileSync(docsPath, "utf8"));
if (!Array.isArray(docs)) throw new Error("source file must be a JSON array of documents");

fs.mkdirSync(packDir, { recursive: true });
const db = new ClassicLevel(packDir, { keyEncoding: "utf8", valueEncoding: "json" });
await db.open();

// Clean rebuild: drop every existing entry first, so a renamed or removed document can't linger.
const oldKeys = [];
for await (const k of db.keys()) oldKeys.push(k);
if (oldKeys.length) await db.batch(oldKeys.map(key => ({ type: "del", key })));

const seen = new Set();
const ops = [];
for (const doc of docs) {
  if (!doc?._id) throw new Error(`document missing _id: ${doc && doc.name}`);
  // Foundry ids are exactly 16 chars of its own alphabet; a shorter one loads but collides badly on
  // import, so fail loudly here rather than shipping it.
  if (!/^[A-Za-z0-9]{16}$/.test(doc._id)) throw new Error(`_id must be 16 alphanumerics: ${doc._id}`);
  if (seen.has(doc._id)) throw new Error(`duplicate _id ${doc._id} (${doc.name})`);
  seen.add(doc._id);
  ops.push({ type: "put", key: `!${collection}!${doc._id}`, value: doc });
}
await db.batch(ops);
await db.close();
console.log(`packed ${ops.length} ${collection} doc(s) -> ${packDir} (cleared ${oldKeys.length} old key(s))`);
