import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { extract } from 'tar';

import { getStoreDir } from '../../../lib/store.ts';
import type { StoreOptions } from '../../../lib/types.ts';
import { fetchWithRetry } from './http.ts';

export async function downloadAndExtract(
  url: string,
  packageName: string,
  version: string,
  onProgress?: (stage: string) => void,
  options?: StoreOptions
): Promise<string> {
  const storeDir = getStoreDir(options);
  const outputDir = path.join(storeDir, `${packageName}@${version}`);

  // Clean up existing directory if present
  try {
    await fsp.rm(outputDir, { recursive: true });
  } catch {
    // Directory doesn't exist, that's fine
  }

  // Create parent directories (handles scoped packages like @tanstack/react-query)
  await fsp.mkdir(path.dirname(outputDir), { recursive: true });

  // Create a temp directory for extraction
  const tempDir = await fsp.mkdtemp(path.join(storeDir, '.tmp-'));

  try {
    onProgress?.('downloading');

    const response = await fetchWithRetry(url);
    if (!response.ok) {
      throw new Error(
        `Failed to download: ${response.status} ${response.statusText}`
      );
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    onProgress?.('extracting');

    // Convert web stream to node stream and pipe to tar extractor
    const reader = response.body.getReader();

    const nodeStream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      },
    });

    // Create tar extractor
    const extractor = extract({
      cwd: tempDir,
      strip: 1, // Remove the top-level directory from the archive
    });

    // Pipe the response to the extractor
    const webStream = nodeStream as unknown as ReadableStream<Uint8Array>;
    const nodeReadable = Readable.fromWeb(webStream);

    await new Promise<void>((resolve, reject) => {
      nodeReadable.pipe(extractor);
      extractor.on('finish', resolve);
      extractor.on('error', reject);
      nodeReadable.on('error', reject);
    });

    // Move temp directory to final location
    await fsp.rename(tempDir, outputDir);

    return outputDir;
  } catch (error) {
    // Clean up temp directory on error
    try {
      await fsp.rm(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}
