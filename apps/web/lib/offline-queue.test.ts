/**
 * Session 5 mandated test 5: mock offline → log sale → come online → sale
 * synced exactly once. Run: npm run test -w @pharmacrm/web
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  countQueuedSales,
  enqueueSale,
  flushSaleQueue,
  listQueuedSales,
  type QueuedSalePayload,
} from "./offline-queue";

const payload = (clientRef: string): QueuedSalePayload => ({
  clientRef,
  customerId: "cltestcustomer000000000001",
  items: [{ nameText: "بنادول", qty: 2 }],
  totalEgp: 100,
  redeemPoints: 0,
});

async function drainAll() {
  const accept = vi.fn(async () => ({ ok: true, status: 201 }));
  await flushSaleQueue(accept);
}

describe("offline sale queue", () => {
  beforeEach(async () => {
    await drainAll();
    expect(await countQueuedSales()).toBe(0);
  });

  it("syncs an offline sale exactly once when the connection returns", async () => {
    const ref = "11111111-1111-4111-8111-111111111111";
    await enqueueSale(payload(ref));
    expect(await countQueuedSales()).toBe(1);

    // still offline: POST fails at the network layer → item stays queued
    const offlinePost = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    let r = await flushSaleQueue(offlinePost);
    expect(r.synced).toBe(0);
    expect(r.remaining).toBe(1);

    // back online: POST succeeds → item removed
    const sent: QueuedSalePayload[] = [];
    const onlinePost = vi.fn(async (p: QueuedSalePayload) => {
      sent.push(p);
      return { ok: true, status: 201 };
    });
    r = await flushSaleQueue(onlinePost);
    expect(r.synced).toBe(1);
    expect(r.remaining).toBe(0);
    expect(sent[0]!.clientRef).toBe(ref); // same clientRef ⇒ server-side idempotency

    // a second flush finds nothing — the sale was sent EXACTLY once
    r = await flushSaleQueue(onlinePost);
    expect(r.synced).toBe(0);
    expect(onlinePost).toHaveBeenCalledTimes(1);
  });

  it("re-enqueueing the same clientRef stores one item; redeemPoints forced to 0 (R11)", async () => {
    const ref = "22222222-2222-4222-8222-222222222222";
    await enqueueSale({ ...payload(ref), redeemPoints: 40 });
    await enqueueSale({ ...payload(ref), redeemPoints: 40 });
    const items = await listQueuedSales();
    expect(items).toHaveLength(1);
    expect(items[0]!.payload.redeemPoints).toBe(0);
  });

  it("server 5xx keeps the item; a duplicate replay (200) still clears it", async () => {
    const ref = "33333333-3333-4333-8333-333333333333";
    await enqueueSale(payload(ref));

    let r = await flushSaleQueue(vi.fn(async () => ({ ok: false, status: 503 })));
    expect(r.remaining).toBe(1);

    // the earlier attempt actually landed server-side → replay returns 200
    r = await flushSaleQueue(vi.fn(async () => ({ ok: true, status: 200 })));
    expect(r.synced).toBe(1);
    expect(r.remaining).toBe(0);
  });
});
