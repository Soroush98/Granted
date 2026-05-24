// Tiny client-side IndexedDB wrapper. Holds the most-recently-picked resume
// PDF so /search can show a preview without re-uploading. Same-origin only,
// cleared by the user or when a new file is picked.

const DB = "granted";
const STORE = "resume";
const KEY = "current";

type StashEntry = { name: string; mimeType: string; blob: Blob };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function stashResume(file: File): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ name: file.name, mimeType: file.type, blob: file }, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadStashedResume(): Promise<StashEntry | null> {
  const db = await openDb();
  const entry = await new Promise<StashEntry | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as StashEntry | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return entry;
}

export async function clearStashedResume(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
