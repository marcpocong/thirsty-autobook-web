import { open, readFile, rename, unlink } from 'node:fs/promises';
export async function atomicJson(path, value) {
    const temporary = `${path}.${process.pid}.tmp`;
    const file = await open(temporary, 'w');
    try {
        await file.writeFile(JSON.stringify(value));
        await file.sync();
    }
    finally {
        await file.close();
    }
    await rename(temporary, path);
}
export function lifecycleWriter(path, identity) {
    return async (stage, evidence = {}) => {
        const current = JSON.parse(await readFile(path, 'utf8'));
        if (current.pid !== identity.pid || current.runID !== identity.runID)
            throw Error('LOCK_REPLACED');
        await atomicJson(path, { ...current, stage, stageAt: new Date().toISOString(), ...evidence });
    };
}
export async function removeOwnedRecord(path, pid, runID) {
    const current = JSON.parse(await readFile(path, 'utf8'));
    if (current.pid !== pid || current.runID !== runID)
        throw Error('LOCK_REPLACED');
    await unlink(path);
}
//# sourceMappingURL=checkout-lifecycle.js.map