require('dotenv').config();
const mongoose = require('mongoose');

const SOURCE_URI = process.env.SOURCE_MONGODB_URI || 'mongodb://127.0.0.1:27017/drainpulse';
const DEST_URI = process.env.MONGODB_URI;

if (!DEST_URI) {
  console.error('[MIGRATE] Missing MONGODB_URI environment variable for the destination Atlas cluster.');
  process.exit(1);
}

function redact(uri) {
  try {
    return uri.replace(/\/\/([^\/:]+):([^@]+)@/, '//.../');
  } catch {
    return uri;
  }
}

async function run() {
  console.log('[MIGRATE] Starting migration...');
  console.log(`[MIGRATE] Source: ${redact(SOURCE_URI)}`);
  console.log(`[MIGRATE] Destination: ${redact(DEST_URI)}`);

  const source = mongoose.createConnection(SOURCE_URI);
  const dest = mongoose.createConnection(DEST_URI);

  try {
    await source.asPromise();
    await dest.asPromise();
    console.log('[MIGRATE] Both database connections are open.');

    const collections = await source.db.listCollections().toArray();
    console.log(`[MIGRATE] Found ${collections.length} collection(s) in the local database.`);

    for (const col of collections) {
      const name = col.name;

      if (name.startsWith('system.')) {
        console.log(`[MIGRATE] Skipping system collection: ${name}`);
        continue;
      }

      const sourceCollection = source.db.collection(name);
      const destCollection = dest.db.collection(name);
      const docs = await sourceCollection.find({}).toArray();

      if (docs.length === 0) {
        console.log(`[MIGRATE] ${name}: 0 documents (skipping).`);
        continue;
      }

      try {
        const result = await destCollection.insertMany(docs, { ordered: false });
        console.log(`[MIGRATE] ${name}: Migrated ${result.insertedCount}/${docs.length} document(s).`);
      } catch (err) {
        if (err.writeErrors) {
          console.warn(`[MIGRATE] ${name}: Partial write. ${err.writeErrors.length} document(s) failed. ${err.insertedDocs ? err.insertedDocs.length : 0} were inserted.`);
        } else {
          console.error(`[MIGRATE] ${name}: Failed to insert documents.`, err.message);
        }
      }
    }

    console.log('[MIGRATE] Migration complete.');
  } catch (err) {
    console.error('[MIGRATE] Fatal error during migration:', err.message);
    process.exitCode = 1;
  } finally {
    await source.close();
    await dest.close();
    console.log('[MIGRATE] Both database connections closed.');
  }
}

run();
