/**
 * Google OAuth 回调
 * GET /api/auth/google/callback
 *
 * 需要环境变量：
 *   GOOGLE_CLIENT_ID        Google OAuth 2.0 客户端 ID
 *   GOOGLE_CLIENT_SECRET    Google OAuth 2.0 客户端密钥
 *   GOOGLE_ALLOWED_USERS    允许登录的邮箱，逗号分隔；留空 = 不限制（任何 Google 账号可登录）
 *
 * 管理员身份写死在 utils/auth/adminPolicy.js（仅 GitHub 的 hekbobo）。
 * Google 登录拿不到 admin 会话，即使用 GOOGLE_ADMIN_USERS 配置了邮箱也不会生效。
 *   GOOGLE_REDIRECT_URI     可选，需与 Google 控制台里配置的重定向地址一致
 *
 * 账号标识用邮箱（login = email），与 GitHub 用户名共用同一套 user@<login> 目录，
 * 因此两边登录得到的账号互不覆盖：同一个人的 GitHub 与 Google 身份是两条记录、两个 UID。
 */

import {
    clearStateCookie,
    establishSession,
    failRedirect,
    getCookie,
    parseList,
} from '../../../utils/auth/oauthShared.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const origin = url.origin;
    const secure = url.protocol === 'https:';

    const fail = (message, cookies) =>
        failRedirect(origin, message, cookies || [clearStateCookie('g_oauth_state', secure)]);

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
        return fail('Google 登录未配置');
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const stateCookie = getCookie(request.headers.get('Cookie'), 'g_oauth_state');

    if (!code) {
        const reason = url.searchParams.get('error_description') || url.searchParams.get('error') || '未获取到授权码';
        return fail(reason);
    }
    if (!state || !stateCookie || state !== stateCookie) {
        return fail('state 校验失败，请重新登录');
    }

    // 1. 用 code 换 access_token（Google 要求 form-urlencoded）
    let accessToken = '';
    try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: env.GOOGLE_CLIENT_ID,
                client_secret: env.GOOGLE_CLIENT_SECRET,
                redirect_uri: env.GOOGLE_REDIRECT_URI || `${origin}/api/auth/google/callback`,
                grant_type: 'authorization_code',
            }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || tokenData.error) {
            return fail(tokenData.error_description || tokenData.error || '换取 Google 令牌失败');
        }
        accessToken = tokenData.access_token || '';
    } catch (error) {
        console.error('Google token exchange failed:', error);
        return fail('换取 Google 令牌失败');
    }

    if (!accessToken) return fail('Google 未返回访问令牌');

    // 2. 取用户信息（OIDC userinfo，scope 只有 openid email profile）
    let email = '';
    let displayName = '';
    let picture = '';
    try {
        const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!userRes.ok) return fail(`读取 Google 账号信息失败（${userRes.status}）`);
        const profile = await userRes.json();

        email = String(profile.email || '').trim().toLowerCase();
        displayName = String(profile.name || '').trim();
        picture = String(profile.picture || '');

        const verified = profile.email_verified === true || profile.email_verified === 'true';
        if (!email) return fail('无法识别 Google 账号邮箱');
        if (!verified) return fail('该 Google 账号邮箱未验证，已拒绝登录');
    } catch (error) {
        console.error('Google userinfo failed:', error);
        return fail('读取 Google 账号信息失败');
    }

    // 3. 白名单 + UID + 会话
    const result = await establishSession({
        env,
        login: email,
        name: displayName || email,
        displayName: displayName || email,
        avatar: picture,
        provider: 'google',
        allowedList: parseList(env.GOOGLE_ALLOWED_USERS),
        allowedEnvName: 'GOOGLE_ALLOWED_USERS',
        stateCookieName: 'g_oauth_state',
        secure,
    });

    if (!result.ok) {
        return fail(result.message, result.clearCookie ? [result.clearCookie] : []);
    }

    return new Response(null, { status: 302, headers: result.headers });
}
