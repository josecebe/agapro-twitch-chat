import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../artifacts/', import.meta.url));

export async function artifactPath(name) {
    if (path.basename(name) !== name) throw Error('Artifact name must be a filename');
    await mkdir(directory, { recursive: true });
    return path.join(directory, name);
}
