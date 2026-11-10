/**
 * 当前登录用户信息
 * GET /api/auth/github/me
 *
 * 返回会话里保存的 GitHub 昵称/头像/登录名，供页面左上角的用户信息控件使用。
 * 未登录返回 401 + { authenticated: false }。
 */

import { validateSession } from '../../../utils/auth/sessionManager.js';

export async function onRequestGet(context) {
    const { request, env } = context;

    const userResult = await validateSession(env, request, 'user');
    const adminResult = await validateSession(env, request, 'admin');

    if (!userResult.valid && !adminResult.valid) {
        return json({ authenticated: false }, 401);
    }

    const session = userResult.valid ? userResult.session : adminResult.session;
    const login = session.username || '';

    return json({
        authenticated: true,
        login,
        name: session.name || '',
        avatar: session.avatar || '',
        provider: session.provider || 'password',
        admin: adminResult.valid,
    });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
        },
    });
}
