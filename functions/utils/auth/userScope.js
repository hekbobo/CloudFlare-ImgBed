/**
 * 请求身份范围：把一次请求的「谁在操作」解析成 { isAdmin, login, uid }。
 *
 * 隔离口径：
 * - 新上传的文件 ID 形如 `<uid>/xxx.jpg`，同时 metadata.Owner = uid；
 * - 普通用户只能列出 / 操作自己 uid 前缀的文件；
 * - 管理员（admin 会话）可以看全部、操作全部；
 * - 没有 uid 前缀的历史文件只归管理员，普通用户看不到也动不了。
 */

import { validateSession } from './sessionManager.js';
import { getOrCreateUser } from '../userDirectory.js';

/**
 * @returns {Promise<null | {isAdmin: boolean, login: string, uid: string, name: string}>}
 */
export async function resolveUserScope(context) {
    const { env, request } = context || {};
    if (!env || !request) return null;

    // 管理员会话优先（管理员同时也有 user 会话，以 admin 为准）
    let session = null;
    let isAdmin = false;

    const adminResult = await validateSession(env, request, 'admin');
    if (adminResult?.valid) {
        session = adminResult.session;
        isAdmin = true;
    } else {
        const userResult = await validateSession(env, request, 'user');
        if (userResult?.valid) session = userResult.session;
    }

    if (!session) return null;

    const login = String(session.username || '').toLowerCase();
    let uid = session.uid || '';

    // 老会话没有 uid（是在引入用户目录之前创建的），这时按 login 补一次
    if (!uid && login) {
        const record = await getOrCreateUser(env, login, {
            name: session.name,
            avatar: session.avatar,
            provider: session.provider,
        });
        uid = record?.uid || '';
    }

    return {
        isAdmin,
        login,
        uid,
        name: session.name || login,
    };
}

/**
 * 文件 ID 是否属于当前用户。
 * 管理员放行一切；普通用户只认 `<uid>/` 前缀。
 */
export function canAccessFileId(scope, fileId) {
    if (!scope) return false;
    if (scope.isAdmin) return true;
    if (!scope.uid) return false;
    const id = String(fileId || '');
    if (!id) return false;
    // 兼容被 URL 编码过的路径请求
    const decoded = id.includes('%2F') ? id.replace(/%2F/gi, '/') : id;
    return decoded.startsWith(`${scope.uid}/`);
}

/**
 * 批量校验，返回第一个越权的文件 ID（没有则为 null）。
 */
export function findUnauthorizedFileId(scope, fileIds) {
    const list = Array.isArray(fileIds) ? fileIds : [fileIds];
    for (const id of list) {
        if (!canAccessFileId(scope, id)) return id;
    }
    return null;
}

/**
 * 把目标路径归一化到当前用户目录下。
 * 前端有时传完整 ID（已含 `<uid>/`），有时只传文件名/目录，两种情况都要兜住，
 * 避免普通用户把文件写到别人目录或根目录。
 */
export function ensureOwnerPrefix(scope, targetId) {
    if (!scope || scope.isAdmin || !scope.uid) return targetId;
    const clean = String(targetId || '').replace(/^\/+/, '');
    if (!clean) return `${scope.uid}/`;
    if (clean === scope.uid || clean.startsWith(`${scope.uid}/`)) return clean;
    return `${scope.uid}/${clean}`;
}

export function forbiddenResponse(message = 'You can only operate on your own files') {    return new Response(JSON.stringify({ success: false, error: message }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
    });
}
