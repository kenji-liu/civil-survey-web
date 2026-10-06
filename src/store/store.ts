// 專案狀態：不可變更新、復原/重做、IndexedDB 自動存檔
import { useSyncExternalStore } from 'react';
import { newProject, normalizeProject, type Project } from '../core/model';

const DB_NAME = 'civil-web';
const STORE = 'kv';
const KEY = 'current-project';
const MAX_HISTORY = 60;

let state: Project = newProject();
let past: Project[] = [];
let future: Project[] = [];
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveStatus: 'saved' | 'saving' | 'error' | 'idle' = 'idle';

function emit() { listeners.forEach(l => l()); }

export function getProject() { return state; }

export function update(fn: (p: Project) => Project, undoable = true) {
  const next = fn(state);
  if (next === state) return;
  if (undoable) {
    past.push(state);
    if (past.length > MAX_HISTORY) past.shift();
    future = [];
  }
  state = { ...next, updatedAt: new Date().toISOString() };
  scheduleSave();
  emit();
}

/** 只改單一欄位的捷徑 */
export function patch<K extends keyof Project>(key: K, value: Project[K], undoable = true) {
  update(p => ({ ...p, [key]: value }), undoable);
}

export function replaceProject(p: Project) {
  past.push(state);
  future = [];
  state = p;
  scheduleSave();
  emit();
}

export function undo() {
  const prev = past.pop();
  if (!prev) return;
  future.push(state);
  state = prev;
  scheduleSave();
  emit();
}

export function redo() {
  const next = future.pop();
  if (!next) return;
  past.push(state);
  state = next;
  scheduleSave();
  emit();
}

export function canUndo() { return past.length > 0; }
export function canRedo() { return future.length > 0; }
export function getSaveStatus() { return saveStatus; }

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useProject(): Project {
  return useSyncExternalStore(subscribe, getProject);
}

export function useSaveStatus() {
  return useSyncExternalStore(subscribe, getSaveStatus);
}

// ---------- IndexedDB ----------
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const v = await new Promise<T | undefined>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return v;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveStatus = 'saving';
  saveTimer = setTimeout(async () => {
    try {
      await idbSet(KEY, state);
      saveStatus = 'saved';
    } catch {
      saveStatus = 'error';
    }
    emit();
  }, 700);
}

/** 啟動時讀回上次的專案；回傳是否有找到 */
export async function loadSaved(): Promise<boolean> {
  try {
    const saved = await idbGet<Project>(KEY);
    if (!saved) return false;
    state = normalizeProject(saved);
    saveStatus = 'saved';
    emit();
    return true;
  } catch {
    return false;
  }
}
