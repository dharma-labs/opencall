import type { ChatMessage, HistoryEntry, Preferences } from '../../types';

const PREFERENCES_KEY = 'opencall.preferences.v1';
const DB_NAME = 'opencall';
const DB_VERSION = 1;
const STORE = 'conversations';

export const DEFAULT_PREFERENCES: Preferences = {
  displayName: 'Guest',
  // On by default so the History tab has something in it. Settings can turn it off.
  keepHistory: true,
  encrypt: true,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  micDeviceId: null,
  camDeviceId: null,
  // Without STUN, two devices on different networks can never reach each other.
  usePublicStun: true,
  // Carriers and office NATs often defeat hole-punching, so the shared relay is
  // on by default; a link that never connects is worse than a relay.
  useFreeRelay: true,
  signalingBrokers: '',
  customIceServers: '',
  theme: 'midnight',
  accent: 'auto',
  wallpaper: true,
};

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    /* storage unavailable (private mode) — preferences simply stay session-only */
  }
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'session' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

interface ConversationRecord {
  session: string;
  updatedAt: number;
  messages: ChatMessage[];
  peer?: string;
}

export async function saveConversation(session: string, messages: ChatMessage[], peer?: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const record: ConversationRecord = { session, updatedAt: Date.now(), messages: messages.slice(-500), peer };
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

/** Summarises every stored conversation for the History tab, newest first. */
export async function listConversations(): Promise<HistoryEntry[]> {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise<HistoryEntry[]>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => {
      const records = Array.isArray(request.result) ? (request.result as ConversationRecord[]) : [];
      resolve(
        records
          .filter((record) => typeof record?.session === 'string')
          .map((record) => {
            const messages = Array.isArray(record.messages) ? record.messages : [];
            const last = [...messages].reverse().find((message) => message.sender !== 'system');
            return {
              session: record.session,
              peer: record.peer ?? 'Peer',
              updatedAt: record.updatedAt ?? 0,
              messageCount: messages.length,
              lastMessage: last ? `${last.sender === 'local' ? 'You: ' : ''}${last.text}`.slice(0, 120) : null,
            };
          })
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
    };
    request.onerror = () => resolve([]);
  });
}

export async function loadConversation(session: string): Promise<ChatMessage[]> {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise<ChatMessage[]>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(session);
    request.onsuccess = () => {
      const record = request.result as ConversationRecord | undefined;
      resolve(Array.isArray(record?.messages) ? record!.messages : []);
    };
    request.onerror = () => resolve([]);
  });
}

export async function clearConversation(session: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(session);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
