/* ==========================================================================
   Sanyue ImgHub · 管理后台
   路由：/admin（概览）· /admin/files · /admin/upload · /admin/users · /admin/settings
   ========================================================================== */

(function () {
  'use strict';

  var PAGE_SIZE = 20;
  var MAX_MB = 3;
  var THEME_KEY = 'imgbed-theme';

  var ROUTES = {
    overview: { path: '/admin', title: '概览', desc: '站点存储与最近上传' },
    files: { path: '/admin/files', title: '文件管理', desc: '搜索、预览、批量删除' },
    upload: { path: '/admin/upload', title: '上传', desc: '拖拽或点击选择文件' },
    users: { path: '/admin/users', title: '用户', desc: '账号、文件归属与权限' },
    settings: { path: '/admin/settings', title: '设置', desc: '存储渠道与当前用量' },
  };

  var TYPE_LABEL = { image: '图片', video: '视频', audio: '音频', other: '其他' };

  var state = {
    me: null,
    page: 'overview',
    quota: null,
    files: {
      items: [],
      total: 0,
      start: 0,
      type: '',
      search: '',
      owner: '',
      ownerLabel: '',
      loading: false,
      selected: Object.create(null),
    },
    users: {
      list: [],
      config: null,
      loading: false,
    },
    queue: [],
    results: [],
    uploading: false,
  };

  /* ------------------------------------------------------------------ 工具 */

  function $(id) {
    return document.getElementById(id);
  }

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 账号标识展示：GitHub 用户名加 @，Google 登录是邮箱，原样显示
  function loginLabel(login) {
    var value = String(login == null ? '' : login);
    if (!value) return '';
    return value.indexOf('@') > 0 ? value : '@' + value;
  }

  function humanSize(bytes) {
    var n = Number(bytes) || 0;
    if (n <= 0) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function humanTime(ts) {
    var n = Number(ts);
    if (!n) return '';
    var d = new Date(n);
    if (isNaN(d.getTime())) return '';
    var pad = function (v) {
      return v < 10 ? '0' + v : String(v);
    };
    var now = new Date();
    var sameYear = d.getFullYear() === now.getFullYear();
    var date = (sameYear ? '' : d.getFullYear() + '-') + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    return date + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fileUrl(id) {
    return '/file/' + String(id).split('/').map(encodeURIComponent).join('/');
  }

  function absolute(url) {
    return /^https?:\/\//.test(url) ? url : location.origin + url;
  }

  function extOf(name) {
    var m = String(name || '').match(/\.([A-Za-z0-9]{1,8})$/);
    return m ? m[1].toUpperCase() : 'FILE';
  }

  function categoryOf(mime, name) {
    var type = String(mime || '').toLowerCase();
    if (type.indexOf('image/') === 0) return 'image';
    if (type.indexOf('video/') === 0) return 'video';
    if (type.indexOf('audio/') === 0) return 'audio';
    if (type) return 'other';
    var ext = String(name || '').split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico'].indexOf(ext) >= 0) return 'image';
    if (['mp4', 'webm', 'mov', 'mkv', 'avi'].indexOf(ext) >= 0) return 'video';
    if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'].indexOf(ext) >= 0) return 'audio';
    return 'other';
  }

  /* ------------------------------------------------------------------ 图标 */

  var ACT_ICONS = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18.5 14.5v4A1.5 1.5 0 0 1 17 20H5.5A1.5 1.5 0 0 1 4 18.5V7A1.5 1.5 0 0 1 5.5 5.5h4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7M6.5 7l.8 11.3A1.7 1.7 0 0 0 9 20h6a1.7 1.7 0 0 0 1.7-1.7L17.5 7"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.4v.1"/></svg>',
  };

  /* --------------------------------------------------------------- 通用组件 */

  var toastTimer = null;
  function toast(message, isError) {
    var el = $('toast');
    el.innerHTML = (isError ? ACT_ICONS.alert : ACT_ICONS.check) + '<span>' + esc(message) + '</span>';
    el.className = 'toast is-visible' + (isError ? ' toast--error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.className = 'toast';
    }, 2400);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text);
      });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      /* ignore */
    }
    document.body.removeChild(ta);
  }

  function ask(message, confirmText) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'dialog-backdrop';
      wrap.innerHTML =
        '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">' +
        '<div class="dialog-head"><div class="dialog-title" id="dlg-title">确认操作</div></div>' +
        '<div class="dialog-body">' + esc(message) + '</div>' +
        '<div class="dialog-foot">' +
        '<button type="button" class="btn btn--sm" data-act="cancel">取消</button>' +
        '<button type="button" class="btn btn--sm btn--danger" data-act="ok">' + esc(confirmText || '确定') + '</button>' +
        '</div></div>';
      document.body.appendChild(wrap);

      var okBtn = wrap.querySelector('[data-act="ok"]');
      if (okBtn) okBtn.focus();

      function close(result) {
        document.removeEventListener('keydown', onKey);
        if (wrap.parentNode) document.body.removeChild(wrap);
        resolve(result);
      }

      function onKey(e) {
        if (e.key === 'Escape') close(false);
      }

      wrap.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-act]');
        if (btn) return close(btn.getAttribute('data-act') === 'ok');
        if (e.target === wrap) close(false);
      });
      document.addEventListener('keydown', onKey);
    });
  }

  function request(url, options) {
    options = options || {};
    var init = {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: options.headers || {},
    };
    if (options.body) {
      init.body = options.body;
      if (!init.headers['Content-Type']) init.headers['Content-Type'] = 'application/json';
    }

    return fetch(url, init).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          var message = text || '请求失败（' + res.status + '）';
          try {
            var data = JSON.parse(text);
            message = data.error || data.message || message;
          } catch (e) {
            /* 纯文本 */
          }
          var err = new Error(message);
          err.code = res.status;
          throw err;
        });
      }
      var type = res.headers.get('content-type') || '';
      return type.indexOf('application/json') >= 0 ? res.json() : res.text();
    });
  }

  function handleAuthError(err) {
    if (err && err.code === 401) {
      toast('登录状态已失效，正在跳转登录…', true);
      setTimeout(function () {
        location.href = '/login';
      }, 900);
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ 主题 */

  function currentTheme() {
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function syncThemeButton() {
    var next = currentTheme() === 'dark' ? '浅色' : '深色';
    var btn = $('theme-btn');
    if (btn) {
      btn.title = '切换到' + next;
      btn.setAttribute('aria-label', '切换到' + next);
    }
  }

  function toggleTheme() {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      /* 隐私模式 */
    }
    syncThemeButton();
  }

  /* -------------------------------------------------------------- 账号信息 */

  function loadMe() {
    return request('/api/auth/github/me')
      .then(function (me) {
        state.me = me || null;
        renderMe();
      })
      .catch(function () {
        state.me = null;
        renderMe();
      });
  }

  function renderMe() {
    var me = state.me;
    var authed = !!(me && me.authenticated);

    if (!authed) {
      location.href = '/login';
      return;
    }

    if (!me.admin) {
      location.href = '/';
      return;
    }

    var name = me.name || me.login || '已登录';
    $('side-user-name').textContent = name;
    $('side-user-login').textContent = loginLabel(me.login);

    var initial = String(name).slice(0, 1).toUpperCase();
    $('side-avatar-initial').textContent = initial;

    var img = $('side-avatar-img');
    if (me.avatar) {
      img.src = me.avatar;
      img.alt = me.login || '';
      img.hidden = false;
      $('side-avatar-initial').hidden = true;
    } else {
      img.hidden = true;
      $('side-avatar-initial').hidden = false;
    }

    $('stat-role').textContent = me.login || name;
    $('stat-role-foot').textContent = me.admin ? '管理员' : '普通用户';
    $('cfg-role').textContent = me.admin ? '管理员' : '普通用户';
  }

  function logout() {
    request('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) })
      .catch(function () {
        /* 忽略 */
      })
      .then(function () {
        location.href = '/login';
      });
  }

  /* ------------------------------------------------------------------ 路由 */

  function pageFromPath(pathname) {
    var path = String(pathname || '').replace(/\/+$/, '') || '/admin';
    if (path === '/admin' || path === '/admin/index.html') return 'overview';
    if (path.indexOf('/admin/files') === 0) return 'files';
    if (path.indexOf('/admin/upload') === 0) return 'upload';
    if (path.indexOf('/admin/users') === 0) return 'users';
    if (path.indexOf('/admin/settings') === 0) return 'settings';
    return 'overview';
  }

  function showPage(page, push) {
    if (!ROUTES[page]) page = 'overview';
    state.page = page;

    Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (section) {
      section.hidden = section.getAttribute('data-view') !== page;
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-page]'), function (link) {
      link.classList.toggle('is-active', link.getAttribute('data-page') === page);
    });

    var route = ROUTES[page];
    $('page-title').textContent = route.title;
    $('page-desc').textContent = route.desc;
    document.title = 'Sanyue ImgHub · ' + route.title;

    if (push && location.pathname !== route.path) {
      history.pushState({ page: page }, '', route.path);
    }

    window.scrollTo({ top: 0 });

    if (page === 'overview') loadOverview();
    if (page === 'files') {
      syncOwnerFromUrl();
      loadFiles(true);
    }
    if (page === 'users') loadUsers();
    if (page === 'settings') renderSettings();
  }

  /* ------------------------------------------------------------ 用户筛选 */

  /**
   * 文件页支持 /admin/files?owner=<uid>&as=<login>，
   * 由用户管理页跳转过来，只列某个账号目录下的文件。
   */
  function syncOwnerFromUrl() {
    var sp = new URLSearchParams(location.search);
    var owner = sp.get('owner') || '';
    var as = sp.get('as') || '';

    if (owner !== state.files.owner) {
      state.files.owner = owner;
      state.files.ownerLabel = as || owner;
      state.files.start = 0;
      state.files.selected = Object.create(null);
    } else if (as) {
      state.files.ownerLabel = as;
    }
    renderOwnerChip();
  }

  function renderOwnerChip() {
    var chip = $('owner-chip');
    if (!chip) return;
    var owner = state.files.owner;
    chip.hidden = !owner;
    if (!owner) return;
    $('owner-chip-text').textContent = '仅看 @' + (state.files.ownerLabel || owner);
  }

  function clearOwnerFilter() {
    state.files.owner = '';
    state.files.ownerLabel = '';
    history.replaceState({ page: 'files' }, '', ROUTES.files.path);
    renderOwnerChip();
    loadFiles(true);
  }


  function renderSettings() {
    $('cfg-host').textContent = location.host;
    $('cfg-limit').textContent = MAX_MB + ' MB';
    $('cfg-channel').textContent = 'Cloudflare R2';
    $('max-size').textContent = MAX_MB;
  }

  /* ------------------------------------------------------------------ 用户 */

  function sizeText(mb) {
    var n = Number(mb) || 0;
    if (n <= 0) return '0 MB';
    if (n < 1) return Math.round(n * 1024) + ' KB';
    if (n < 1024) return n.toFixed(n < 10 ? 2 : 1) + ' MB';
    return (n / 1024).toFixed(2) + ' GB';
  }

  function loadUsers() {
    var u = state.users;
    if (u.loading) return;
    u.loading = true;

    request('/api/manage/users')
      .then(function (data) {
        if (!data || data.success === false) throw new Error((data && data.error) || '加载失败');
        u.list = data.users || [];
        u.config = data.config || null;
        renderUsers(data);
      })
      .catch(function (err) {
        if (!handleAuthError(err)) toast(err.message || '加载失败', true);
        u.list = [];
        renderUsers(null, err.message || '加载失败');
      })
      .then(function () {
        u.loading = false;
      });
  }

  function roleBadge(user) {
    if (user.isAdmin) return '<span class="badge badge--ok">管理员</span>';
    if (user.allowed === false) return '<span class="badge badge--danger">白名单外</span>';
    return '<span class="badge badge--line">成员</span>';
  }

  function buildUserRow(user) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-uid', user.uid);
    tr.setAttribute('data-login', user.login);

    var label = user.name || user.login || '?';
    var initial = String(label).slice(0, 1).toUpperCase();
    var avatar = user.avatar
      ? '<img src="' + esc(user.avatar) + '" alt="" loading="lazy" onerror="this.remove()">'
      : '';

    tr.innerHTML =
      '<td><div class="cell-user">' +
      '<span class="avatar">' + avatar + '<span>' + esc(initial) + '</span></span>' +
      '<span class="cell-name"><b>' + esc(label) + '</b><small>' + esc(loginLabel(user.login)) + '</small></span>' +
      '</div></td>' +
      '<td class="col-uid"><button type="button" class="btn-text u-mono" data-act="copy-uid" title="复制 UID">' +
      esc(user.uid) + '</button></td>' +
      '<td class="col-role">' + roleBadge(user) + '</td>' +
      '<td class="col-num num">' + (user.files || 0) + '</td>' +
      '<td class="col-size num">' + sizeText(user.sizeMB) + '</td>' +
      '<td class="col-time num">' + (humanTime(user.createdAt) || '—') + '</td>' +
      '<td class="col-actions"><span class="row-actions">' +
      '<button type="button" class="btn btn--sm" data-act="files" title="查看该用户的文件" aria-label="查看该用户的文件">' +
      ACT_ICONS.open + '</button>' +
      '</span></td>';

    return tr;
  }

  function onUserAction(e) {
    var row = e.target.closest('[data-uid]');
    if (!row) return;
    var actEl = e.target.closest('[data-act]');
    var act = actEl ? actEl.getAttribute('data-act') : null;
    if (!act) return;
    e.preventDefault();

    var uid = row.getAttribute('data-uid');
    var login = row.getAttribute('data-login');

    if (act === 'copy-uid') {
      copyText(uid).then(function () {
        toast('UID 已复制');
      });
      return;
    }

    if (act === 'files') {
      var url =
        ROUTES.files.path +
        '?owner=' + encodeURIComponent(uid) +
        '&as=' + encodeURIComponent(login || '');
      history.pushState({ page: 'files' }, '', url);
      showPage('files', false);
    }
  }

  function renderUsers(data, errorMessage) {
    var tbody = $('users-tbody');
    tbody.innerHTML = '';

    if (!data) {
      $('users-empty').hidden = false;
      $('users-empty-title').textContent = '加载失败';
      $('users-empty-sub').textContent = errorMessage || '请稍后重试';
      $('u-total').textContent = '—';
      $('u-admins').textContent = '—';
      $('u-files').textContent = '—';
      $('u-orphan').textContent = '—';
      return;
    }

    var totals = data.totals || {};
    var config = data.config || {};
    var indexed = data.indexed !== false;

    $('u-total').textContent = totals.users || 0;
    $('u-admins').textContent = totals.admins || 0;
    $('u-admins-foot').textContent = config.adminSource === 'bootstrap'
      ? '最早注册的账号'
      : '来源：GITHUB_ADMIN_USERS';

    $('u-files').textContent = indexed ? (totals.files || 0) : '—';
    $('u-files-foot').textContent = indexed ? sizeText(totals.sizeMB) : '索引不可用';

    $('u-orphan').textContent = indexed ? (totals.orphanFiles || 0) : '—';
    $('u-orphan-foot').textContent = indexed
      ? (totals.orphanFiles ? sizeText(totals.orphanSizeMB) : '没有遗留文件')
      : '索引不可用';

    var admins = config.admins || [];
    $('u-admin-list').textContent = admins.length
      ? admins.join('、') + (config.adminSource === 'bootstrap' ? '（未配置，自动接管）' : '')
      : '—';

    var allowed = config.allowedUsers || [];
    $('u-allow-list').textContent = config.allowedListEmpty
      ? '未配置（此时任何账号都无法登录）'
      : allowed.join('、');

    $('u-updated').textContent = '刷新于 ' + humanTime(Date.now());

    if (!state.users.list.length) {
      $('users-empty').hidden = false;
      $('users-empty-title').textContent = '还没有账号';
      $('users-empty-sub').textContent = '第一个用 GitHub 登录的人会自动成为管理员';
      $('side-users-count').hidden = true;
      return;
    }

    $('users-empty').hidden = true;
    state.users.list.forEach(function (user) {
      tbody.appendChild(buildUserRow(user));
    });

    var countEl = $('side-users-count');
    countEl.textContent = state.users.list.length;
    countEl.hidden = false;
  }

  /* ------------------------------------------------------------------ 概览 */

  function loadOverview() {
    loadQuota();

    request('/api/manage/list?start=0&count=8&recursive=true')
      .then(function (data) {
        var items = ((data && data.files) || []).map(normalizeFile);
        renderRecent(items);
      })
      .catch(function (err) {
        if (!handleAuthError(err)) toast(err.message || '加载失败', true);
      });
  }

  function loadQuota() {
    return request('/api/manage/quota')
      .then(function (data) {
        state.quota = data;
        if (!data || data.success === false) return;
        var size = Number(data.totalSizeMB);
        var sizeText = isNaN(size) ? '0 MB' : size >= 1024 ? (size / 1024).toFixed(2) + ' GB' : size.toFixed(2) + ' MB';
        $('stat-count').textContent = data.totalCount || 0;
        $('stat-size').textContent = sizeText;

        // 设置页的「使用情况」：同一份配额数据，不额外发请求
        var usedEl = $('cfg-used');
        if (usedEl) usedEl.textContent = sizeText;
        var filesEl = $('cfg-files');
        if (filesEl) filesEl.textContent = data.totalCount || 0;
        var scopeEl = $('cfg-scope');
        if (scopeEl) scopeEl.textContent = data.scope === 'user' ? '仅本人' : '全站';
        var updatedEl = $('cfg-updated');
        if (updatedEl) updatedEl.textContent = humanTime(data.lastUpdated) || '—';
      })
      .catch(function () {
        /* 静默 */
      });
  }

  function renderRecent(items) {
    var tbody = $('recent-tbody');
    tbody.innerHTML = '';

    if (!items.length) {
      $('recent-empty').hidden = false;
      $('stat-latest').textContent = '—';
      $('stat-latest-foot').textContent = '暂无记录';
      return;
    }

    $('recent-empty').hidden = true;
    $('stat-latest').textContent = items[0].time || '—';
    $('stat-latest-foot').textContent = items[0].name;

    items.forEach(function (item) {
      tbody.appendChild(buildRow(item, { selectable: false, compact: true }));
    });
  }

  /* -------------------------------------------------------------- 文件管理 */

  function normalizeFile(record) {
    var meta = record.metadata || {};
    var name = meta.FileName || String(record.name || '').split('/').pop();
    return {
      id: record.name,
      name: name,
      url: fileUrl(record.name),
      size: humanSize(meta.FileSizeBytes || Math.round((Number(meta.FileSize) || 0) * 1024 * 1024)),
      time: humanTime(meta.TimeStamp),
      category: categoryOf(meta.FileType, name),
    };
  }

  function loadFiles(reset) {
    var f = state.files;
    if (f.loading) return;
    f.loading = true;

    if (reset) {
      f.start = 0;
      f.selected = Object.create(null);
    }

    var params = new URLSearchParams();
    params.set('start', String(f.start));
    params.set('count', String(PAGE_SIZE));
    params.set('recursive', 'true');
    if (f.type) params.set('fileType', f.type);
    if (f.search) params.set('search', f.search);
    if (f.owner) params.set('owner', f.owner);

    request('/api/manage/list?' + params.toString())
      .then(function (data) {
        var files = (data && data.files) || [];
        f.items = files.map(normalizeFile);
        f.total = Number(data && data.totalCount) || f.items.length;
        renderFiles();
        if (!f.owner) {
          $('side-count').textContent = f.total;
          $('side-count').hidden = !f.total;
        }
      })
      .catch(function (err) {
        if (!handleAuthError(err)) toast(err.message || '加载失败', true);
        f.items = [];
        renderFiles(err.message);
      })
      .then(function () {
        f.loading = false;
      });
  }

  function renderFiles(errorMessage) {
    var f = state.files;
    var tbody = $('files-tbody');
    tbody.innerHTML = '';

    if (!f.items.length) {
      $('files-empty').hidden = false;
      $('files-empty-title').textContent = errorMessage ? '加载失败' : '没有文件';
      $('files-empty-sub').textContent = errorMessage
        ? errorMessage
        : f.owner
        ? '这个账号名下还没有文件'
        : f.search || f.type
        ? '换个关键词或筛选条件试试'
        : '上传第一个文件后，它会出现在这里';
      $('pager').hidden = true;
      syncSelectAll();
      renderBulk();
      return;
    }

    $('files-empty').hidden = true;
    $('pager').hidden = false;

    f.items.forEach(function (item) {
      tbody.appendChild(buildRow(item, { selectable: true }));
    });

    var from = f.start + 1;
    var to = Math.min(f.start + f.items.length, f.total);
    $('pager-info').textContent = '第 ' + from + '–' + to + ' 项，共 ' + f.total + ' 项';
    $('prev-btn').disabled = f.start <= 0;
    $('next-btn').disabled = f.start + PAGE_SIZE >= f.total;

    syncSelectAll();
    renderBulk();
  }

  function buildRow(item, options) {
    options = options || {};
    var tr = document.createElement('tr');
    tr.setAttribute('data-id', item.id);

    var isImage = item.category === 'image';
    var thumb = isImage
      ? '<img loading="lazy" src="' + esc(item.url) + '" alt="">'
      : '<span>' + esc(extOf(item.name)) + '</span>';

    var checkCell = options.selectable
      ? '<td class="col-check"><input type="checkbox" class="check" data-act="pick" aria-label="选择 ' + esc(item.name) + '"' +
        (state.files.selected[item.id] ? ' checked' : '') +
        '></td>'
      : '';

    tr.innerHTML =
      checkCell +
      '<td><div class="cell-file">' +
      '<span class="cell-thumb" data-act="open">' + thumb + '</span>' +
      '<span class="cell-name"><b title="' + esc(item.name) + '">' + esc(item.name) + '</b>' +
      (options.compact ? '' : '<small>' + esc(item.id) + '</small>') +
      '</span></div></td>' +
      '<td class="col-type"><span class="badge">' + TYPE_LABEL[item.category] + '</span></td>' +
      '<td class="col-size num">' + esc(item.size) + '</td>' +
      '<td class="col-time num">' + esc(item.time) + '</td>' +
      '<td class="col-actions"><span class="row-actions">' +
      '<button type="button" class="btn btn--sm" data-act="copy" title="复制链接" aria-label="复制链接">' + ACT_ICONS.copy + '</button>' +
      '<button type="button" class="btn btn--sm" data-act="open" title="打开原文件" aria-label="打开原文件">' + ACT_ICONS.open + '</button>' +
      '<button type="button" class="btn btn--sm" data-act="del" title="删除" aria-label="删除">' + ACT_ICONS.trash + '</button>' +
      '</span></td>';

    if (options.selectable && state.files.selected[item.id]) tr.classList.add('is-selected');
    return tr;
  }

  function findFile(id) {
    for (var i = 0; i < state.files.items.length; i++) {
      if (state.files.items[i].id === id) return state.files.items[i];
    }
    return null;
  }

  function onRowAction(e) {
    var holder = e.target.closest('[data-id]');
    if (!holder) return;

    var id = holder.getAttribute('data-id');
    var actEl = e.target.closest('[data-act]');
    var act = actEl ? actEl.getAttribute('data-act') : null;
    if (!act) return;

    if (act === 'pick') {
      toggleSelect(id);
      return;
    }

    var item = findFile(id);
    if (!item) return;

    e.preventDefault();
    e.stopPropagation();

    if (act === 'copy') {
      copyText(absolute(item.url)).then(function () {
        toast('链接已复制');
      });
    } else if (act === 'open') {
      window.open(absolute(item.url), '_blank', 'noopener');
    } else if (act === 'del') {
      removeFiles([id]);
    }
  }

  function toggleSelect(id) {
    var selected = state.files.selected;
    if (selected[id]) delete selected[id];
    else selected[id] = true;

    var row = document.querySelector('#files-tbody tr[data-id="' + cssEscape(id) + '"]');
    if (row) {
      row.classList.toggle('is-selected', !!selected[id]);
      var box = row.querySelector('input.check');
      if (box) box.checked = !!selected[id];
    }

    syncSelectAll();
    renderBulk();
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function selectedIds() {
    return Object.keys(state.files.selected);
  }

  function syncSelectAll() {
    var all = $('select-all');
    if (!all) return;
    var total = state.files.items.length;
    var count = selectedIds().length;
    all.checked = total > 0 && count >= total;
    all.indeterminate = count > 0 && count < total;
  }

  function renderBulk() {
    var ids = selectedIds();
    var btn = $('bulk-delete');
    btn.hidden = ids.length === 0;
    $('bulk-count').textContent = ids.length;
  }

  function removeFiles(ids) {
    if (!ids.length) return;
    var message =
      ids.length > 1
        ? '确定删除选中的 ' + ids.length + ' 个文件？删除后链接会立即失效，无法恢复。'
        : '确定删除这个文件？删除后链接会立即失效，无法恢复。';

    ask(message, '删除').then(function (ok) {
      if (!ok) return;
      request('/api/manage/delete/batch', {
        method: 'POST',
        body: JSON.stringify({ fileIds: ids }),
      })
        .then(function (data) {
          var deleted = (data && data.deleted) || [];
          var failed = (data && data.failed) || [];
          if (data && data.success === false && !deleted.length) {
            throw new Error((failed[0] && failed[0].error) || '删除失败');
          }
          var count = deleted.length || ids.length;
          ids.forEach(function (id) {
            delete state.files.selected[id];
          });
          toast('已删除 ' + count + ' 个文件');
          loadFiles(true);
          loadQuota();
        })
        .catch(function (err) {
          if (!handleAuthError(err)) toast(err.message || '删除失败', true);
        });
    });
  }

  /* ------------------------------------------------------------------ 上传 */

  function enqueue(fileList) {
    var added = 0;
    Array.prototype.forEach.call(fileList, function (file) {
      if (!file || !file.size) return;
      if (file.size > MAX_MB * 1024 * 1024) {
        toast('「' + file.name + '」超过 ' + MAX_MB + ' MB 限制', true);
        return;
      }
      state.queue.push({
        id: 'q' + Date.now() + Math.random().toString(36).slice(2, 7),
        file: file,
        status: 'pending',
        progress: 0,
        error: '',
      });
      added++;
    });
    if (added) {
      renderQueue();
      startUploads();
    }
  }

  function renderQueue() {
    var box = $('queue');
    box.innerHTML = '';
    box.hidden = state.queue.length === 0;

    state.queue.forEach(function (task) {
      var el = document.createElement('div');
      el.className = 'queue-row';
      el.setAttribute('data-qid', task.id);
      el.innerHTML =
        '<span class="queue-badge">' + esc(extOf(task.file.name).slice(0, 4)) + '</span>' +
        '<div class="queue-main">' +
        '<div class="queue-top"><span class="queue-name u-truncate">' + esc(task.file.name) + '</span>' +
        '<span class="queue-size">' + esc(humanSize(task.file.size)) + '</span></div>' +
        '<div class="progress queue-bar"><i></i></div>' +
        '</div>' +
        '<span class="queue-state">等待中</span>';
      box.appendChild(el);
      updateQueueItem(task);
    });
  }

  function updateQueueItem(task) {
    var el = document.querySelector('[data-qid="' + task.id + '"]');
    if (!el) return;

    var bar = el.querySelector('.queue-bar i');
    var status = el.querySelector('.queue-state');
    el.classList.remove('is-done', 'is-error');
    if (bar) bar.style.width = Math.round(task.progress * 100) + '%';

    if (task.status === 'uploading') {
      status.textContent = Math.round(task.progress * 100) + '%';
    } else if (task.status === 'done') {
      el.classList.add('is-done');
      status.textContent = '完成';
    } else if (task.status === 'error') {
      el.classList.add('is-error');
      status.textContent = '失败';
      el.querySelector('.queue-size').textContent = task.error || '上传失败';
    } else {
      status.textContent = '等待中';
    }
  }

  function uploadOne(file, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/upload?uploadChannel=cfr2&returnFormat=full&responseFormat=object');
      xhr.withCredentials = true;

      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };

      xhr.onload = function () {
        var text = xhr.responseText || '';
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(text));
          } catch (e) {
            resolve({ src: text });
          }
          return;
        }
        var message = text || '上传失败（' + xhr.status + '）';
        try {
          var data = JSON.parse(text);
          if (data.code === 'FILE_TOO_LARGE') message = '文件超过 ' + MAX_MB + ' MB 限制';
          else message = data.error || data.message || message;
        } catch (e) {
          /* 纯文本 */
        }
        var err = new Error(message);
        err.code = xhr.status;
        reject(err);
      };

      xhr.onerror = function () {
        reject(new Error('网络异常，上传中断'));
      };

      var form = new FormData();
      form.append('file', file, file.name);
      xhr.send(form);
    });
  }

  function startUploads() {
    if (state.uploading) return;
    state.uploading = true;

    function next() {
      for (var i = 0; i < state.queue.length; i++) {
        if (state.queue[i].status === 'pending') return state.queue[i];
      }
      return null;
    }

    function worker() {
      var task = next();
      if (!task) return Promise.resolve();
      task.status = 'uploading';
      updateQueueItem(task);

      return uploadOne(task.file, function (p) {
        task.progress = p;
        updateQueueItem(task);
      })
        .then(function (res) {
          task.status = 'done';
          task.progress = 1;
          updateQueueItem(task);
          addResult(res, task.file);
          setTimeout(function () {
            state.queue = state.queue.filter(function (item) {
              return item.id !== task.id;
            });
            renderQueue();
          }, 1600);
        })
        .catch(function (err) {
          task.status = 'error';
          task.error = err.message;
          updateQueueItem(task);
          if (!handleAuthError(err)) toast(err.message, true);
        })
        .then(worker);
    }

    var workers = [];
    for (var i = 0; i < 3; i++) workers.push(worker());

    Promise.all(workers).then(function () {
      state.uploading = false;
      loadQuota();
    });
  }

  function addResult(res, file) {
    var src = (res && (res.src || res.url)) || '';
    if (!src) return;

    var path = /^https?:\/\//.test(src) ? new URL(src).pathname : src;
    var encodedId = path.replace(/^\/file\//, '');
    var id = encodedId;
    try {
      id = decodeURIComponent(encodedId);
    } catch (e) {
      /* 保留原值 */
    }

    state.results.unshift({
      id: id,
      name: file.name,
      url: fileUrl(id),
      size: humanSize(file.size),
      time: humanTime(Date.now()),
      category: categoryOf(file.type, file.name),
    });

    renderResults();
  }

  function renderResults() {
    var card = $('results-card');
    var tbody = $('results-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!state.results.length) {
      card.hidden = true;
      return;
    }

    card.hidden = false;
    $('results-count').textContent = state.results.length;

    state.results.forEach(function (item) {
      tbody.appendChild(buildRow(item, { selectable: false, compact: true }));
    });
  }

  /* ------------------------------------------------------------------ 绑定 */

  function bind() {
    $('max-size').textContent = MAX_MB;

    // 导航
    Array.prototype.forEach.call(document.querySelectorAll('[data-page],[data-link]'), function (el) {
      el.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        var page = el.getAttribute('data-page') || el.getAttribute('data-link');
        if (!page || !ROUTES[page]) return;
        e.preventDefault();
        showPage(page, true);
      });
    });

    window.addEventListener('popstate', function () {
      showPage(pageFromPath(location.pathname), false);
    });

    // 主题
    $('theme-btn').addEventListener('click', toggleTheme);
    $('logout-btn').addEventListener('click', logout);

    // 概览：最近文件行操作
    $('recent-tbody').addEventListener('click', function (e) {
      var holder = e.target.closest('[data-id]');
      if (!holder) return;
      var actEl = e.target.closest('[data-act]');
      var act = actEl ? actEl.getAttribute('data-act') : null;
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();

      var row = holder;
      var name = row.querySelector('.cell-name b');
      var fileName = name ? name.textContent : '';

      var params = new URLSearchParams();
      params.set('start', '0');
      params.set('count', '20');
      params.set('recursive', 'true');
      if (fileName) params.set('search', fileName);

      if (act === 'copy' || act === 'open') {
        var id = holder.getAttribute('data-id');
        var url = absolute(fileUrl(id));
        if (act === 'copy') {
          copyText(url).then(function () {
            toast('链接已复制');
          });
        } else {
          window.open(url, '_blank', 'noopener');
        }
        return;
      }

      if (act === 'del') {
        removeFiles([holder.getAttribute('data-id')]);
      }
    });

    // 文件管理
    $('files-tbody').addEventListener('click', onRowAction);
    $('owner-chip').addEventListener('click', clearOwnerFilter);

    // 用户
    $('users-tbody').addEventListener('click', onUserAction);
    $('users-refresh').addEventListener('click', loadUsers);

    $('select-all').addEventListener('change', function () {
      var on = this.checked;
      state.files.items.forEach(function (item) {
        if (on) state.files.selected[item.id] = true;
        else delete state.files.selected[item.id];
      });
      renderFiles();
    });

    $('bulk-delete').addEventListener('click', function () {
      removeFiles(selectedIds());
    });

    $('refresh-btn').addEventListener('click', function () {
      loadFiles(true);
      loadQuota();
    });

    $('prev-btn').addEventListener('click', function () {
      state.files.start = Math.max(0, state.files.start - PAGE_SIZE);
      loadFiles(false);
    });

    $('next-btn').addEventListener('click', function () {
      state.files.start += PAGE_SIZE;
      loadFiles(false);
    });

    $('type-chips').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-type]');
      if (!btn) return;
      Array.prototype.forEach.call(this.querySelectorAll('button'), function (el) {
        el.classList.toggle('is-active', el === btn);
      });
      state.files.type = btn.getAttribute('data-type') || '';
      loadFiles(true);
    });

    var searchTimer = null;
    $('search-input').addEventListener('input', function () {
      var value = this.value.trim();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        if (value === state.files.search) return;
        state.files.search = value;
        loadFiles(true);
      }, 320);
    });

    // 上传
    var input = $('file-input');
    var dz = $('dropzone');

    dz.addEventListener('click', function () {
      input.click();
    });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });

    input.addEventListener('change', function () {
      enqueue(input.files);
      input.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (name) {
      dz.addEventListener(name, function (e) {
        e.preventDefault();
        dz.classList.add('is-over');
      });
    });
    ['dragleave', 'dragend'].forEach(function (name) {
      dz.addEventListener(name, function () {
        dz.classList.remove('is-over');
      });
    });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      dz.classList.remove('is-over');
      if (e.dataTransfer && e.dataTransfer.files) enqueue(e.dataTransfer.files);
    });

    ['dragover', 'drop'].forEach(function (name) {
      document.addEventListener(name, function (e) {
        if (!dz.contains(e.target)) e.preventDefault();
      });
    });

    document.addEventListener('paste', function (e) {
      if (!e.clipboardData) return;
      var files = e.clipboardData.files;
      if (files && files.length) {
        if (state.page !== 'upload') showPage('upload', true);
        enqueue(files);
      }
    });

    $('copy-all').addEventListener('click', function () {
      var text = state.results
        .map(function (item) {
          return absolute(item.url);
        })
        .join('\n');
      if (!text) return;
      copyText(text).then(function () {
        toast('已复制 ' + state.results.length + ' 个链接');
      });
    });

    $('results-tbody').addEventListener('click', onRowAction);
  }

  /* ------------------------------------------------------------------ 启动 */

  bind();
  syncThemeButton();
  showPage(pageFromPath(location.pathname), false);

  loadMe().then(function () {
    loadQuota();
    if (state.page === 'files') loadFiles(true);
  });
})();
