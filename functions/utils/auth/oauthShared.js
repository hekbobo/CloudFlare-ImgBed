/**
 * OAuth 登录公共工具（GitHub / Google 共用）
 *
 * 把「白名单校验 → 分配或复用 UID → 签发会话」这段两个 provider 完全相同的逻辑
 * 收在一处，避免两边各写一份后规则慢慢漂移（尤其是管理员 bootstrap 与白名单为空拒绝登录）。
 */

import { createSession } from './sessionManager.js';
import { getOrCreateUser } from '../userDirectory.js';
import { isSuperAdmin } from './adminPolicy.js';

/** 逗号分隔的配置项统一转小写数组 */
export function parseList(value) {
    if (!value) return [];
    return String(value)
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
}

export function getCookie(cookieHeader, name) {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}

/** 登录失败：带着原因回到首页，由登录门禁读取 login_error 渲染提示 */
export function failRedirect(origin, message, extraCookies = []) {
    const target = new URL('/', origin);
    target.searchParams.set('login_error', message);

    const headers = new Headers();
    headers.set('Location', target.toString());
    headers.set('Cache-Control', 'no-store');
    for (const cookie of extraCookies) headers.append('Set-Cookie', cookie);
    return new Response(null, { status: 302, headers });
}

/** 清掉 state Cookie（成功或失败都要清，防止重放） */
export function clearStateCookie(name, secure) {
    const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (secure) parts.push('Secure');
    return parts.join('; ');
}

export function stateCookie(name, state, secure) {
    const parts = [`${name}=${state}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=600'];
    if (secure) parts.push('Secure');
    return parts.join('; ');
}

/**
 * 白名单校验 + 用户目录登记 + 会话签发。
 *
 * 管理员身份由 adminPolicy.js 写死决定，调用方无需（也无法）再传名单。
 *
 * @returns {{ ok: true, headers: Headers } | { ok: false, message: string }}
 */
export async function establishSession(options) {
    const {
        env,
        login,
        name,
        avatar,
        provider,
        displayName,
        allowedList,
        allowedEnvName,
        stateCookieName,
        secure,
    } = options;

    const clearCookie = stateCookieName ? clearStateCookie(stateCookieName, secure) : null;

    // 白名单未配置 = 不限制（任何账号都可登录）；配置了则严格校验。
    // 想恢复限制时填上 ${allowedEnvName} 即可，无需改代码。
    if (allowedList.length > 0 && !allowedList.includes(login)) {
        return { ok: false, message: `账号 ${login} 不在允许名单内`, clearCookie };
    }
    if (allowedList.length === 0) {
        console.warn(`[auth] ${allowedEnvName} 未配置，${provider} 登录不做账号限制`);
    }

    let record = null;
    try {
        record = await getOrCreateUser(env, login, { name, avatar, provider });
    } catch (error) {
        console.error('Create user record failed:', error);
        return { ok: false, message: '创建用户记录失败，请检查数据库配置', clearCookie };
    }
    if (!record?.uid) {
        return { ok: false, message: '无法分配用户 UID', clearCookie };
    }

    // 管理员判定：写死在 adminPolicy.js（只有 GitHub 的 hekbobo）。
    // 不再读 GITHUB_ADMIN_USERS / GOOGLE_ADMIN_USERS，也不再走「最早注册账号自动接管」的 bootstrap，
    // 避免多套来源叠加后出现「不知道从哪冒出来的管理员」。
    const admin = isSuperAdmin(login, provider);

    const profile = {
        provider,
        name: displayName || name,
        avatar,
        uid: record.uid,
    };

    const headers = new Headers();
    try {
        const { cookie: userCookie } = await createSession(env, 'user', login, profile);
        headers.append('Set-Cookie', userCookie);
        if (admin) {
            const { cookie: adminCookie } = await createSession(env, 'admin', login, profile);
            headers.append('Set-Cookie', adminCookie);
        }
    } catch (error) {
        console.error('Create session failed:', error);
        return { ok: false, message: '创建会话失败，请检查数据库配置', clearCookie };
    }

    if (clearCookie) headers.append('Set-Cookie', clearCookie);
    headers.set('Location', '/');
    headers.set('Cache-Control', 'no-store');

    return { ok: true, headers };
}
