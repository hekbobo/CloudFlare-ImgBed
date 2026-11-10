import { authenticate, AUTH_SCOPE } from "../../utils/auth/authCore.js";
import { resolveUserScope, canAccessFileId, forbiddenResponse } from "../../utils/auth/userScope.js";

const DEFAULT_MANAGE_CACHE_CONTROL = 'private, no-store, max-age=0';

function withDefaultCacheControl(response) {
  if (response.headers.has('Cache-Control')) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', DEFAULT_MANAGE_CACHE_CONTROL);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function errorHandling(context) {
  try {
    return withDefaultCacheControl(await context.next());
  } catch (err) {
    return new Response(`${err.message}\n${err.stack}`, {
      status: 500,
      headers: {
        'Cache-Control': DEFAULT_MANAGE_CACHE_CONTROL,
      },
    });
  }
}

function UnauthorizedException(reason) {
  return new Response(reason, {
    status: 401,
    statusText: 'Unauthorized',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'Cache-Control': 'no-store',
      'Content-Length': reason.length,
    },
  });
}

/**
 * 根据请求路径提取所需权限
 * @param {string} pathname - 请求路径
 * @returns {string} 需要的权限类型
 */
function extractRequiredPermission(pathname) {
  const path = pathname.toLowerCase().replace(/\/$/, '');
  if (path === '/api/manage/delete' || path.startsWith('/api/manage/delete/')) {
    return 'delete';
  }
  if (path === '/api/manage/list' || path.startsWith('/api/manage/list/') || path === '/api/manage/batch/list') {
    return 'list';
  }

  // 其他 /api/manage 下的操作需要管理权限
  return 'manage';
}

// CORS 跨域响应头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, PUT, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

/**
 * 普通登录用户（非管理员）可以访问的文件级接口。
 * 站点级配置（sysConfig / apiTokens / cusConfig / batch 索引 / dedup / block / white）
 * 一律不放行，否则普通用户能改站点设置或自己发 API Token 提权。
 */
const USER_FILE_PATHS = [
  '/api/manage/list',
  '/api/manage/batch/list',
  '/api/manage/delete',
  '/api/manage/move',
  '/api/manage/rename',
  '/api/manage/tags',
  '/api/manage/metadata',
  '/api/manage/quota',
];

function isUserFilePath(pathname) {
  const path = pathname.toLowerCase().replace(/\/$/, '');
  return USER_FILE_PATHS.some(base => path === base || path.startsWith(base + '/'));
}

async function authentication(context) {
  // OPTIONS 预检请求不需要鉴权，直接返回 CORS 响应
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  const pathname = new URL(context.request.url).pathname;
  const requiredPermission = extractRequiredPermission(pathname);

  // 1) 有会话（GitHub 登录 / 管理员）：管理员全放行，普通用户只放行文件级接口
  const scope = await resolveUserScope(context);
  if (scope) {
    context.userScope = scope;
    if (scope.isAdmin || isUserFilePath(pathname)) {
      return context.next();
    }
    return forbiddenResponse('需要管理员权限');
  }

  // 2) 没有会话：回落到 API Token（原有 admin scope），authCode 不在此列
  const result = await authenticate({
    env: context.env,
    request: context.request,
    requiredPermission,
    authScope: AUTH_SCOPE.ADMIN,
  });

  if (!result.authorized) {
    return UnauthorizedException('You need to login');
  }

  return context.next();
}

/**
 * 文件归属校验：这些接口把文件 ID 直接放在 URL 路径里，
 * 管理员放行，普通用户只能操作自己 uid 目录下的文件。
 * （batch / dedup 这类把 ID 放在 body 里的接口各自校验）
 */
const FILE_PATH_ROUTE = /^\/api\/manage\/(delete|move|rename|metadata|tags|block|white)\/(.+)$/i;

async function fileOwnership(context) {
    if (context.request.method === 'OPTIONS') return context.next();

    const url = new URL(context.request.url);
    let pathname = url.pathname;
    try {
        pathname = decodeURIComponent(pathname);
    } catch {
        // 保留原值
    }

    const match = pathname.match(FILE_PATH_ROUTE);
    if (!match) return context.next();

    const scope = context.userScope || await resolveUserScope(context);
    if (!scope) return UnauthorizedException('You need to login');
    if (scope.isAdmin) return context.next();

    const ids = match[2].split(',').map(s => s.trim()).filter(Boolean);
    for (const id of ids) {
        if (!canAccessFileId(scope, id)) {
            return forbiddenResponse(`无权操作该文件：${id}`);
        }
    }

    return context.next();
}

export const onRequestWithOwnership = [errorHandling, authentication, fileOwnership];
export const onRequest = onRequestWithOwnership;
