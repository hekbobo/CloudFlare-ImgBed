/**
 * 请求身份范围：把一次请求的「谁在操作」解析成 { isAdmin, login, uid }。
 *
 * 隔离口径：
 * - 新上传的文件 ID 形如 `<uid>/xxx.jpg`，同时 metadata.Owner = uid；
 * - 普通用户只能列出 / 操作自己 uid 前缀的文件；
 * - 管理员（admin 会话）可以看全部、操作全部；
 * - 没有 uid 前缀的历史文件只归管理员，普通用户看不到也动不了。
 *
 * uid 的唯一权威来源是用户目录（settings 表的 user@<login>）。
 * 会话 Cookie 里也存了一份 uid，但它只是「上次登录时的快照」：
 * 目录里的 uid 被改写/迁移过、或者会话是在旧版本创建的，快照就会过期。
 * 一旦以过期快照为准，新上传的文件会落到错误前缀下，用户在自己的列表里反而看不到，
 * 所以这里一律以目录为准，会话 uid 只在目录不可用时兜底，并顺手把会话纠正回来。
 */

import { validateSession, patchSession } from './sessionManager.js';
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
    const sessionUid = String(session.uid || '');

    // 以用户目录为准；目录没有这个人时顺手创建（首次登录兜底）
    let uid = '';
    if (login) {
        try {
            const record = await getOrCreateUser(env, login, {
                name: session.name,
                avatar: session.avatar,
                provider: session.provider,
            });
            uid = String(record?.uid || '');
        } catch (error) {
            console.error('[userScope] 读取用户目录失败，临时退回会话 uid:', error?.message || error);
        }
    }
    if (!uid) uid = sessionUid;

    // 会话里的快照过期时纠正一次，之后就不会再走这个分支
    if (uid && sessionUid && uid !== sessionUid && session.authType) {
        try {
            await patchSession(env, request, session.authType, { uid });
        } catch (error) {
            console.error('[userScope] 纠正会话 uid 失败:', error?.message || error);
        }
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
