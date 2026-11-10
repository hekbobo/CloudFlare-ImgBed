/**
 * 会话管理工具
 * 使用数据库存储会话，通过 HttpOnly Cookie 传递会话 Token
 * 管理端和用户端使用独立的 Cookie（admin_session / user_session）
 */

import { generateSessionToken } from './passwordHash.js';
import { getDatabase } from '../databaseAdapter.js';
import { fetchSecurityConfig } from '../sysConfig.js';
import { normalizeSessionMaxAgeDays, sessionMaxAgeDaysToTtl } from './sessionConfig.js';

const SESSION_PREFIX = 'manage@session@';

// Cookie 名称映射
const COOKIE_NAMES = {
    admin: 'admin_session',
    user: 'user_session',
};

/**
 * 创建新会话
 * @param {Object} env - 环境变量
 * @param {string} authType - 认证类型 ('admin' | 'user')
 * @param {string} [username] - 用户名（管理员登录时使用）
 * @returns {Promise<{token: string, cookie: string}>}
 */
export async function createSession(env, authType, username = '', profile = {}) {
    // 读取安全策略配置
    const securityConfig = await fetchSecurityConfig(env);
    const accessConfig = securityConfig.access || {};
    const secure = accessConfig.sessionSecure ?? false;
    const rawMaxAgeDays = authType === 'admin'
        ? (accessConfig.adminSessionMaxAge ?? 14)
        : (accessConfig.userSessionMaxAge ?? 14);
    const maxAgeDays = normalizeSessionMaxAgeDays(rawMaxAgeDays);
    const maxAge = sessionMaxAgeDaysToTtl(maxAgeDays);

    const db = getDatabase(env);
    const token = generateSessionToken();
    const sessionData = {
        // 第三方登录附带的资料（昵称、头像等），不覆盖身份字段
        ...profile,
        authType,
        username,
        createdAt: Date.now(),
        expiresAt: Date.now() + maxAge * 1000,
    };

    await db.put(`${SESSION_PREFIX}${token}`, JSON.stringify(sessionData), {
        expirationTtl: maxAge,
    });

    const cookieName = COOKIE_NAMES[authType] || 'session';
    const cookie = buildSessionCookie(cookieName, token, maxAge, secure);
    return { token, cookie };
}

/**
 * 验证会话（按 authType 读取对应的 Cookie）
 * @param {Object} env - 环境变量
 * @param {Request} request - 请求对象
 * @param {string} authType - 要验证的认证类型 ('admin' | 'user')
 * @returns {Promise<{valid: boolean, session?: Object}>}
 */
export async function validateSession(env, request, authType) {
    const cookieName = COOKIE_NAMES[authType] || 'session';
    const token = getCookieValue(request, cookieName);
    if (!token) {
        return { valid: false };
    }

    const db = getDatabase(env);
    const sessionStr = await db.get(`${SESSION_PREFIX}${token}`);
    if (!sessionStr) {
        return { valid: false };
    }

    try {
        const session = JSON.parse(sessionStr);
        // 验证 authType 匹配
        if (session.authType !== authType) {
            return { valid: false };
        }
        if (Date.now() > session.expiresAt) {
            await db.delete(`${SESSION_PREFIX}${token}`);
            return { valid: false };
        }
        return { valid: true, session };
    } catch {
        return { valid: false };
    }
}

/**
 * 就地修正会话内容（例如用户目录里的 uid 变更后同步会话）
 * 保留原有 expiresAt 与剩余 TTL，不延长会话寿命
 * @param {Object} env - 环境变量
 * @param {Request} request - 请求对象
 * @param {string} authType - 认证类型 ('admin' | 'user')
 * @param {Object} patch - 要覆盖的字段
 * @returns {Promise<boolean>} 是否写回成功
 */
export async function patchSession(env, request, authType, patch) {
    const cookieName = COOKIE_NAMES[authType] || 'session';
    const token = getCookieValue(request, cookieName);
    if (!token || !patch) return false;

    const db = getDatabase(env);
    const key = `${SESSION_PREFIX}${token}`;
    const raw = await db.get(key);
    if (!raw) return false;

    let session;
    try {
        session = JSON.parse(raw);
    } catch {
        return false;
    }

    const next = { ...session, ...patch };
    // 剩余寿命不足一分钟就不再写回，避免变相续期
    const ttl = Math.floor((Number(next.expiresAt || 0) - Date.now()) / 1000);
    if (!Number.isFinite(ttl) || ttl < 60) return false;

    await db.put(key, JSON.stringify(next), { expirationTtl: ttl });
    return true;
}

/**
 * 验证任意有效会话（不限 authType，用于 sessionCheck 接口）
 * @param {Object} env - 环境变量
 * @param {Request} request - 请求对象
 * @returns {Promise<{valid: boolean, session?: Object}>}
 */
export async function validateAnySession(env, request) {
    // 优先检查 admin，再检查 user
    const adminResult = await validateSession(env, request, 'admin');
    if (adminResult.valid) return adminResult;

    const userResult = await validateSession(env, request, 'user');
    if (userResult.valid) return userResult;

    return { valid: false };
}

/**
 * 销毁会话
 * @param {Object} env - 环境变量
 * @param {Request} request - 请求对象
 * @param {string} [authType] - 要销毁的认证类型，不传则销毁所有
 * @returns {Promise<string|string[]>} 清除 Cookie 的 Set-Cookie 头
 */
export async function destroySession(env, request, authType) {
    // 读取安全策略配置
    const securityConfig = await fetchSecurityConfig(env);
    const secure = securityConfig.access?.sessionSecure ?? false;

    const db = getDatabase(env);

    if (authType) {
        // 销毁指定类型的会话
        const cookieName = COOKIE_NAMES[authType] || 'session';
        const token = getCookieValue(request, cookieName);
        if (token) {
            await db.delete(`${SESSION_PREFIX}${token}`);
        }
        return buildSessionCookie(cookieName, '', 0, secure);
    } else {
        // 销毁所有类型的会话
        const cookies = [];
        for (const [type, cookieName] of Object.entries(COOKIE_NAMES)) {
            const token = getCookieValue(request, cookieName);
            if (token) {
                await db.delete(`${SESSION_PREFIX}${token}`);
            }
            cookies.push(buildSessionCookie(cookieName, '', 0, secure));
        }
        return cookies;
    }
}

/**
 * 按认证类型批量清除会话
 * @param {Object} env - 环境变量
 * @param {string} authType - 要清除的认证类型 ('admin' | 'user')
 * @returns {Promise<number>} 清除的会话数量
 */
export async function destroySessionsByAuthType(env, authType) {
    const db = getDatabase(env);
    let destroyed = 0;

    let cursor = undefined;
    let hasMore = true;

    while (hasMore) {
        const listOptions = { prefix: SESSION_PREFIX };
        if (cursor) {
            listOptions.cursor = cursor;
        }

        const result = await db.list(listOptions);
        const keys = result.keys || [];

        for (const key of keys) {
            try {
                const sessionStr = await db.get(key.name);
                if (sessionStr) {
                    const session = JSON.parse(sessionStr);
                    if (session.authType === authType) {
                        await db.delete(key.name);
                        destroyed++;
                    }
                }
            } catch {
                await db.delete(key.name);
                destroyed++;
            }
        }

        cursor = result.cursor;
        hasMore = !result.list_complete && cursor;
    }

    return destroyed;
}

/**
 * 从请求中提取指定 Cookie 的值
 * @param {Request} request - 请求对象
 * @param {string} name - Cookie 名称
 * @returns {string|null}
 */
function getCookieValue(request, name) {
    const cookieHeader = request.headers.get('Cookie');
    if (!cookieHeader) return null;

    const regex = new RegExp('(^|;\\s*)' + name + '=([^;]+)');
    const match = cookieHeader.match(regex);
    return match ? match[2] : null;
}

/**
 * 构建 Set-Cookie 头的值
 * @param {string} name - Cookie 名称
 * @param {string} token - 会话 Token
 * @param {number} maxAge - 最大存活时间（秒）
 * @param {boolean} secure - 是否添加 Secure 属性
 * @returns {string}
 */
function buildSessionCookie(name, token, maxAge, secure = false) {
    const parts = [
        `${name}=${token}`,
        `Path=/`,
        `HttpOnly`,
        // Lax 而非 Strict：OAuth 回调是「跨站 → 本站」的顶层跳转，
        // Strict 会让浏览器在回跳那一跳丢掉会话 Cookie，导致登录后又被门禁打回登录页。
        `SameSite=Lax`,
        `Max-Age=${maxAge}`,
    ];
    if (secure) {
        parts.push('Secure');
    }
    return parts.join('; ');
}
