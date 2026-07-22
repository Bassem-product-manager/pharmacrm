import { create } from "zustand";

export interface Toast {
  id: number;
  text: string;
  tone: "success" | "info" | "error";
}

interface AppState {
  online: boolean;
  /** Sales waiting in the IndexedDB offline queue (queue itself lives in offline-queue.ts). */
  queuedCount: number;
  toasts: Toast[];
  setOnline: (online: boolean) => void;
  setQueuedCount: (n: number) => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;

export const useAppStore = create<AppState>((set) => ({
  online: true,
  queuedCount: 0,
  toasts: [],
  setOnline: (online) => set({ online }),
  setQueuedCount: (queuedCount) => set({ queuedCount }),
  toast: (text, tone = "success") => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
