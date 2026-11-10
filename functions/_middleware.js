// 自定义适配器通过请求上下文声明平台；Pages 使用原生 Functions 入口。
// 覆盖同名环境变量，避免用户配置将 Pages/Workers 误判为 Node。
import { githubLoginGate } from './utils/auth/githubGate.js';
import { handlePageRoute } from './utils/webRoutes.js';

export async function onRequest(context) {
    const runtime = context.data.serverRuntime;
    context.env.SERVER_RUNTIME = runtime === 'node' || runtime === 'worker' ? runtime : 'pages';

    // GitHub 登录门禁：未登录的页面导航返回自定义登录页
    // 仅在配置了 GITHUB_CLIENT_ID 时生效，未配置则完全退回原有行为
    const gateResponse = await githubLoginGate(context.request, context.env);
    if (gateResponse) return gateResponse;

    // 页面分区：Pages 部署由这里接管；Worker 入口在路由匹配前已处理，这里会直接返回 null
    const pageResponse = await handlePageRoute(context.request, context.env, new URL(context.request.url));
    if (pageResponse) return pageResponse;

    return context.next();
}
