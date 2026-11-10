/**
 * 用户目录：每个登录用户一个稳定的 UID，用于隔离文件。
 *
 * 存储：settings 表，key = `user@<login 小写>`，value = JSON
 *   { uid, login, name, avatar, createdAt, provider }
 *
 * UID 只由字母数字组成（不带斜杠），直接作为文件 ID 的目录前缀，
 * 因此文件名形如 `u1a2b3c4d/1794000000000_foo.jpg`，在 R2 里天然按用户分目录。
 */

import { getDatabase } from './databaseAdapter.js';

export const USER_KEY_PREFIX = 'user@';
const UID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const UID_LENGTH = 8;

function generateUid() {
    const bytes = crypto.getRandomValues(new Uint8Array(UID_LENGTH));
    let out = 'u';
    for (let i = 0; i < UID_LENGTH; i++) {
        out += UID_ALPHABET[bytes[i] % UID_ALPHABET.length];
    }
    return out;
}

export function normalizeLogin(login) {
    return String(login || '').trim().toLowerCase();
}

export async function getUserRecord(env, login) {
    const key = normalizeLogin(login);
    if (!key) return null;
    const db = getDatabase(env);
    const raw = await db.get(`${USER_KEY_PREFIX}${key}`);
    if (!raw) return null;
    try {
        const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!record || !record.uid) return null;
        return record;
    } catch {
        return null;
    }
}

/**
 * 读取用户，不存在则分配一个 UID 并落库。
 * profile 里的 name / avatar 会随登录更新，uid 永不改变。
 */
export async function getOrCreateUser(env, login, profile = {}) {
    const normalized = normalizeLogin(login);
    if (!normalized) return null;

    const existing = await getUserRecord(env, normalized);
    if (existing) {
        const next = {
            ...existing,
            name: profile.name ?? existing.name ?? '',
            avatar: profile.avatar ?? existing.avatar ?? '',
        };
        if (next.name !== existing.name || next.avatar !== existing.avatar) {
            const db = getDatabase(env);
            await db.put(`${USER_KEY_PREFIX}${normalized}`, JSON.stringify(next));
        }
        return next;
    }

    const record = {
        uid: generateUid(),
        login: normalized,
        name: profile.name || normalized,
        avatar: profile.avatar || '',
        provider: profile.provider || 'github',
        createdAt: Date.now(),
    };
    const db = getDatabase(env);
    await db.put(`${USER_KEY_PREFIX}${normalized}`, JSON.stringify(record));
    return record;
}

/**
 * 列出所有用户（管理员视图用）。
 */
export async function listUserRecords(env) {
    const db = getDatabase(env);
    const users = [];
    let cursor = null;
    while (true) {
        const result = await db.list({ prefix: USER_KEY_PREFIX, limit: 500, cursor });
        const keys = result?.keys || [];
        for (const item of keys) {
            const raw = await db.get(item.name);
            if (!raw) continue;
            try {
                const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (record?.uid) users.push(record);
            } catch {
                // 忽略损坏记录
            }
        }
        if (!result?.list_complete && result?.cursor && keys.length > 0) {
            cursor = result.cursor;
        } else {
            break;
        }
    }
    return users.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/**
 * 首个用户（用于 bootstrap 管理员）。
 */
export async function getBootstrapAdmin(env) {
    const users = await listUserRecords(env);
    return users.length > 0 ? users[0].login : null;
}
