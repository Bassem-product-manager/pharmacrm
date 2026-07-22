import type { CreateSaleInput } from "@pharmacrm/shared";

/**
 * Offline queue for sale logs ONLY (docs/03 T4). IndexedDB is the durable
 * store (survives reloads); zustand only mirrors the count for the UI.
 *
 * Exactly-once: every queued payload carries the clientRef minted at capture
 * time. Retries re-send the SAME clientRef, and the server's unique constraint
 * turns any duplicate into a 200 replay — so an item is deleted only after the
 * server acknowledged it, and re-sending after a lost response is harmless.
 * Redemption is never queued (R11): payloads are stored with redeemPoints 0.
 */
export type QueuedSalePayload = CreateSaleInput & { clientRef: string };

export interface QueuedSale {
  clientRef: string;
  payload: QueuedSalePayload;
  queuedAt: number;
}

const DB_NAME = "pharmacrm-offline";
const DB_VERSION = 1;
const STORE = "sale-queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "clientRef" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

export async function enqueueSale(payload: QueuedSalePayload): Promise<void> {
  const item: QueuedSale = {
    clientRef: payload.clientRef,
    payload: { ...payload, redeemPoints: 0 }, // R11: no redemption offline
    queuedAt: Date.now(),
  };
  await tx("readwrite", (s) => s.put(item)); // keyPath clientRef → re-enqueue is a no-op overwrite
}

export async function listQueuedSales(): Promise<QueuedSale[]> {
  const all = await tx<QueuedSale[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedSale[]>);
  return all.sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function countQueuedSales(): Promise<number> {
  return tx<number>("readonly", (s) => s.count());
}

async function removeQueuedSale(clientRef: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(clientRef));
}

/** POST adapter result — `ok` for 2xx; status used to classify failures. */
export type PostSale = (payload: QueuedSalePayload) => Promise<{ ok: boolean; status: number }>;

/** Auth/rate-limit/server errors keep the item for a later retry. */
const RETRYABLE_STATUSES = new Set([401, 403, 408, 429]);

let flushing = false;

/**
 * Drain the queue oldest-first. An item is removed only after the server
 * accepted it (2xx — 200 replay counts) or permanently rejected it (other
 * 4xx). Network errors, 5xx, and retryable statuses stop the pass; the
 * remaining items wait for the next 'online' event. A concurrency latch keeps
 * simultaneous triggers (online event + app start) from double-sending.
 */
export async function flushSaleQueue(post: PostSale): Promise<{ synced: number; remaining: number }> {
  if (flushing) return { synced: 0, remaining: await countQueuedSales() };
  flushing = true;
  try {
    let synced = 0;
    for (const item of await listQueuedSales()) {
      let res: { ok: boolean; status: number };
      try {
        res = await post(item.payload);
      } catch {
        break; // network failure — still offline, retry on next trigger
      }
      if (res.ok) {
        await removeQueuedSale(item.clientRef);
        synced++;
      } else if (res.status >= 500 || RETRYABLE_STATUSES.has(res.status)) {
        break;
      } else {
        await removeQueuedSale(item.clientRef); // permanent 4xx — drop, don't poison the queue
      }
    }
    return { synced, remaining: await countQueuedSales() };
  } finally {
    flushing = false;
  }
}
