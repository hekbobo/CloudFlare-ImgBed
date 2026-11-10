/**
 * GitHub OAuth 回调
 * GET /api/auth/github/callback
 *
 * 需要环境变量：
 *   GITHUB_CLIENT_ID        GitHub OAuth App 的 Client ID
 *   GITHUB_CLIENT_SECRET    GitHub OAuth App 的 Client Secret
 *   GITHUB_ALLOWED_USERS    允许登录的 GitHub 用户名，逗号分隔（必填，留空则拒绝所有人）
 *   GITHUB_ADMIN_USERS      可选，拥有管理后台权限的用户，逗号分隔；不填则默认等于 GITHUB_ALLOWED_USERS
 *   GITHUB_REDIRECT_URI     可选，需与 OAuth App 中配置的回调地址一致
 */

import { createSession } from '../../../utils/auth/sessionManager.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const origin = url.origin;

    const fail = (message) => {
        const target = new URL('/', origin);
        target.searchParams.set('login_error', message);
        return new Response(null, {
            status: 302,
            headers: { Location: target.toString(), 'Cache-Control': 'no-store' },
        });
    };

    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
        return fail('GitHub OAuth 未配置');
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const stateCookie = getCookie(request.headers.get('Cookie'), 'gh_oauth_state');

    if (!code) {
        const reason = url.searchParams.get('error_description') || url.searchParams.get('error') || '未获取到授权码';
        return fail(reason);
    }
    if (!state || !stateCookie || state !== stateCookie) {
        return fail('state 校验失败，请重新登录');
    }

    // 1. 用 code 换 access_token
    let accessToken = '';
    try {
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'cloudflare-imgbed',
            },
            body: JSON.stringify({
                client_id: env.GITHUB_CLIENT_ID,
                client_secret: env.GITHUB_CLIENT_SECRET,
                code,
                redirect_uri: env.GITHUB_REDIRECT_URI || `${origin}/api/auth/github/callback`,
            }),
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error) {
            return fail(tokenData.error_description || tokenData.error);
        }
        accessToken = tokenData.access_token || '';
    } catch (error) {
        console.error('GitHub token exchange failed:', error);
        return fail('换取 GitHub 令牌失败');
    }

    if (!accessToken) return fail('GitHub 未返回访问令牌');

    // 2. 取用户信息
    let login = '';
    try {
        const userRes = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'cloudflare-imgbed',
            },
        });
        if (!userRes.ok) return fail(`读取 GitHub 账号信息失败（${userRes.status}）`);
        const user = await userRes.json();
        login = String(user.login || '').toLowerCase();
    } catch (error) {
        console.error('GitHub user fetch failed:', error);
        return fail('读取 GitHub 账号信息失败');
    }

    if (!login) return fail('无法识别 GitHub 账号');

    // 3. 白名单校验（留空 = 全部拒绝，避免误开放）
    const allowed = parseList(env.GITHUB_ALLOWED_USERS);
    if (allowed.length === 0) {
        return fail('站点未配置 GITHUB_ALLOWED_USERS，已拒绝登录');
    }
    if (!allowed.includes(login)) {
        return fail(`账号 ${login} 不在允许名单内`);
    }

    const adminList = parseList(env.GITHUB_ADMIN_USERS);
    const effectiveAdmins = adminList.length > 0 ? adminList : allowed;

    // 4. 建立会话（管理员额外发一枚 admin 会话，保证管理后台可用）
    const headers = new Headers();
    try {
        const { cookie: userCookie } = await createSession(env, 'user', login);
        headers.append('Set-Cookie', userCookie);
        if (effectiveAdmins.includes(login)) {
            const { cookie: adminCookie } = await createSession(env, 'admin', login);
            headers.append('Set-Cookie', adminCookie);
        }
    } catch (error) {
        console.error('Create session failed:', error);
        return fail('创建会话失败，请检查数据库配置');
    }

    headers.append('Set-Cookie', 'gh_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    headers.set('Location', '/');
    headers.set('Cache-Control', 'no-store');

    return new Response(null, { status: 302, headers });
}

function parseList(value) {
    if (!value) return [];
    return String(value)
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
}

function getCookie(cookieHeader, name) {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}
