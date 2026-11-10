/**
 * 上传文件大小限制
 *
 * 默认上限 3MB，可通过环境变量 MAX_UPLOAD_SIZE_MB 调整（单位 MB）。
 * 覆盖三条上传路径：
 * 1. 常规单文件上传（/upload）
 * 2. 分块上传（>20MB 或 Discord 渠道 >9MB 时触发）
 * 3. HuggingFace 大文件直传（≥20MB 时触发，前端直接传 HF）
 */

export const DEFAULT_MAX_UPLOAD_SIZE_MB = 3;

export function getMaxUploadSizeMB(env) {
    const raw = Number.parseFloat(env?.MAX_UPLOAD_SIZE_MB);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_UPLOAD_SIZE_MB;
}

export function getMaxUploadSizeBytes(env) {
    return Math.floor(getMaxUploadSizeMB(env) * 1024 * 1024);
}

export function buildFileTooLargeResponse(env, fileSizeBytes) {
    const limitMB = getMaxUploadSizeMB(env);
    const sizeMB = (Number(fileSizeBytes) / 1024 / 1024).toFixed(2);
    const message = `文件过大：${sizeMB}MB，超过 ${limitMB}MB 限制`;

    return new Response(JSON.stringify({
        code: 'FILE_TOO_LARGE',
        error: message,
        message,
        maxSizeMB: limitMB,
    }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * 超出限制时返回 413 响应，未超出返回 null。
 */
export function checkFileSize(fileSizeBytes, env) {
    const size = Number(fileSizeBytes);
    if (!Number.isFinite(size) || size <= 0) return null;
    if (size <= getMaxUploadSizeBytes(env)) return null;
    return buildFileTooLargeResponse(env, size);
}
