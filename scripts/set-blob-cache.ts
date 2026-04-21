/**
 * Sets Cache-Control on every existing blob in the container.
 *
 * Usage:
 *   AZURE_STORAGE_CONNECTION_STRING="..." \
 *   AZURE_STORAGE_CONTAINER_NAME=pollysblob \
 *   npx tsx scripts/set-blob-cache.ts
 */

import { BlobServiceClient } from '@azure/storage-blob';

const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING!;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'uploads';
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

async function run() {
    const service = BlobServiceClient.fromConnectionString(connStr);
    const container = service.getContainerClient(containerName);

    let count = 0;
    for await (const blob of container.listBlobsFlat()) {
        const client = container.getBlobClient(blob.name);
        const props = await client.getProperties();
        await client.setHTTPHeaders({
            blobContentType: props.contentType,
            blobCacheControl: CACHE_CONTROL,
        });
        count++;
        if (count % 10 === 0) console.log(`  patched ${count} blobs…`);
    }
    console.log(`Done. Patched ${count} blobs.`);
}

run().catch(e => { console.error(e); process.exit(1); });
