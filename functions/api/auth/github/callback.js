/**
 * GitHub OAuth 回调
 * GET /api/auth/github/callback
 *
 * 需要环境变量：
 *   GITHUB_CLIENT_ID        GitHub OAuth App 的 Client ID
 *   GITHUB_CLIENT_SECRET    GitHub OAuth App 的 Client Secret
 *   GITHUB_ALLOWED_USERS    允许登录的 GitHub 用户名，逗号分隔；留空 = 不限制（任何人可登录）
 *   管理员                写死在 utils/auth/adminPolicy.js（仅 GitHub 的 hekbobo），不再读环境变量
 *   GITHUB_REDIRECT_URI     可选，需与 OAuth App 中配置的回调地址一致
 */

import { createSession } from '../../../utils/auth/sessionManager.js';
import { getOrCreateUser } from '../../../utils/userDirectory.js';
import { isSuperAdmin } from '../../../utils/auth/adminPolicy.js';

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
    let ghName = '';
    let ghAvatar = '';
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
        ghName = String(user.name || '').trim();
        ghAvatar = String(user.avatar_url || '');
    } catch (error) {
        console.error('GitHub user fetch failed:', error);
        return fail('读取 GitHub 账号信息失败');
    }

    if (!login) return fail('无法识别 GitHub 账号');

    // 3. 白名单校验（未配置 = 不限制；配置了则严格校验）
    const allowed = parseList(env.GITHUB_ALLOWED_USERS);
    if (allowed.length > 0 && !allowed.includes(login)) {
        return fail(`账号 ${login} 不在允许名单内`);
    }

    // 3.5 分配（或复用）用户 UID —— 文件隔离的根，uid 一旦确定永不改变
    let userRecord = null;
    try {
        userRecord = await getOrCreateUser(env, login, {
            name: ghName,
            avatar: ghAvatar,
            provider: 'github',
        });
    } catch (error) {
        console.error('Create user record failed:', error);
        return fail('创建用户记录失败，请检查数据库配置');
    }
    if (!userRecord?.uid) return fail('无法分配用户 UID');

    // 管理员身份写死在 adminPolicy.js：只有 GitHub 的 hekbobo 会额外拿到 admin 会话。
    // 不再读 GITHUB_ADMIN_USERS，也不再走「最早注册账号自动接管」的 bootstrap。
    const admin = isSuperAdmin(login, 'github');

    // 4. 建立会话（管理员额外发一枚 admin 会话，保证管理后台可用）
    //    昵称、头像、uid 存进会话，供左上角控件与上传路径使用
    const profile = {
        provider: 'github',
        name: ghName,
        avatar: ghAvatar,
        uid: userRecord.uid,
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
