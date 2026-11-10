/**
 * 单用户存储配额
 *
 * 默认每人 1GB，可通过环境变量 USER_QUOTA_MB 调整；设为 0 或负数表示不限制。
 * 用量口径与 /api/manage/quota 保持一致：索引中 metadata.Owner === uid 的 FileSize 之和。
 *
 * 覆盖三条上传路径：
 * 1. 常规单文件上传（/upload）—— 唯一在实际体积下会触发的路径
 * 2. 分块上传（>20MB 触发）—— 初始化时无法预知总大小，只校验「是否已经超额」
 * 3. HuggingFace 直传（≥20MB 触发）—— 请求体里带 fileSize，按量校验
 *
 * 设计取舍：
 * - 管理员豁免。管理员能看到全站、也能改这个变量，把自己锁在外面没有意义。
 * - 索引读取失败时放行（fail-open）。配额是防滥用，不是安全边界；
 *   索引坏了就让全站传不了东西，代价远大于被刷一点空间。
 */

import { readIndex } from './indexManager.js';

export const DEFAULT_USER_QUOTA_MB = 1024;

/** 配额上限（MB）。<= 0 表示不限制。 */
export function getUserQuotaMB(env) {
    const raw = env?.USER_QUOTA_MB;
    if (raw === undefined || raw === null || raw === '') return DEFAULT_USER_QUOTA_MB;
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return DEFAULT_USER_QUOTA_MB;
    return value;
}

export function getUserQuotaBytes(env) {
    const mb = getUserQuotaMB(env);
    if (mb <= 0) return Infinity;
    return Math.floor(mb * 1024 * 1024);
}

function toMB(bytes) {
    return Math.round((Number(bytes) / 1024 / 1024) * 100) / 100;
}

function formatMB(bytes) {
    const mb = toMB(bytes);
    return mb >= 1024 ? (mb / 1024).toFixed(2) + 'GB' : mb + 'MB';
}

/**
 * 读取某个 uid 的已用字节数。
 * 索引不可用时返回 null，由调用方决定如何处理（当前实现是放行）。
 */
export async function getUserUsedBytes(context, uid) {
    if (!uid) return 0;
    try {
        const result = await readIndex(context, {
            ownerUid: uid,
            count: -1,
            includeSubdirFiles: true,
        });
        if (!result?.success) return null;

        let bytes = 0;
        for (const file of result.files || []) {
            const sizeMB = Number.parseFloat(file.metadata?.FileSize) || 0;
            bytes += sizeMB * 1024 * 1024;
        }
        return bytes;
    } catch (error) {
        console.error('Read user usage failed:', error);
        return null;
    }
}

export function buildQuotaExceededResponse(context, usedBytes, incomingBytes) {
    const limitMB = getUserQuotaMB(context.env);
    const usedMB = toMB(usedBytes);
    const incomingMB = toMB(incomingBytes);
    const message = incomingBytes > 0
        ? `存储空间不足：已用 ${usedMB}MB，本次 ${incomingMB}MB，超出 ${limitMB}MB 配额`
        : `存储空间已满：已用 ${usedMB}MB，达到 ${limitMB}MB 配额`;

    return new Response(JSON.stringify({
        code: 'USER_QUOTA_EXCEEDED',
        error: message,
        message,
        limitMB,
        usedMB,
        remainingMB: Math.max(0, toMB(limitMB * 1024 * 1024 - usedBytes)),
    }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * 上传前配额检查。超限返回 413 响应，未超限返回 null。
 *
 * @param {object} context 请求上下文（需带 env，尽量提前设置好 context.userScope）
 * @param {number} incomingBytes 本次要写入的字节数；分块初始化等无法预知时传 0
 */
export async function checkUserQuota(context, incomingBytes = 0) {
    const scope = context.userScope;
    // 管理员豁免；无 uid（未登录或纯 API Token）交给原有鉴权，不在这里拦
    if (!scope || scope.isAdmin || !scope.uid) return null;

    const limitBytes = getUserQuotaBytes(context.env);
    if (!Number.isFinite(limitBytes)) return null;

    const usedBytes = await getUserUsedBytes(context, scope.uid);
    if (usedBytes === null) return null;

    const size = Number(incomingBytes) || 0;
    // 已用已达上限时，哪怕本次是 0 字节也拒绝新上传
    if (usedBytes >= limitBytes) {
        return buildQuotaExceededResponse(context, usedBytes, size);
    }
    if (usedBytes + size <= limitBytes) return null;
    return buildQuotaExceededResponse(context, usedBytes, size);
}

export { formatMB as formatQuotaMB };
