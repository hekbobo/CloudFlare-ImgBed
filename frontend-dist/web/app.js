/* ==========================================================================
   Sanyue ImgHub · Web 前端
   - /         上传页
   - /history  历史文件（网格 / 列表双视图）
   纯原生实现，依赖 /ui/system.css 的设计 token
   ========================================================================== */

(function () {
  'use strict';

  var UPLOAD_CONCURRENCY = 3;
  var PAGE_SIZE = 24;
  var MAX_MB = 3;

  var THEME_KEY = 'imgbed-theme';
  var VIEW_KEY = 'imgbed-view';

  var TYPE_LABEL = { image: '图片', video: '视频', audio: '音频', other: '其他' };

  var state = {
    me: null,
    view: location.pathname.indexOf('/history') === 0 ? 'history' : 'upload',
    viewMode: 'grid',
    queue: [],
    results: [],
    uploading: false,
    history: {
      items: [],
      total: 0,
      loading: false,
      type: '',
      search: '',
      selected: Object.create(null),
    },
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

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  /* ------------------------------------------------------------------ 图标 */

  var ICONS = {
    image:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.6" cy="9.6" r="1.5"/><path d="M3.5 17.2 9 12l3.4 3.2M13.2 13.6 16 11l4.5 4.4"/></svg>',
    video:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5.5" width="12.5" height="13" rx="2.5"/><path d="m15.5 10.5 5-2.6v8.2l-5-2.6z"/></svg>',
    audio:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17.5V6l9.5-1.8v11"/><circle cx="6.6" cy="17.6" r="2.4"/><circle cx="16.1" cy="15.8" r="2.4"/></svg>',
    other:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.6 3.2H7.4A1.9 1.9 0 0 0 5.5 5.1v13.8a1.9 1.9 0 0 0 1.9 1.9h9.2a1.9 1.9 0 0 0 1.9-1.9V8.1z"/><path d="M13.4 3.3v4.9h5"/></svg>',
  };

  var ACT_ICONS = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18.5 14.5v4A1.5 1.5 0 0 1 17 20H5.5A1.5 1.5 0 0 1 4 18.5V7A1.5 1.5 0 0 1 5.5 5.5h4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7M6.5 7l.8 11.3A1.7 1.7 0 0 0 9 20h6a1.7 1.7 0 0 0 1.7-1.7L17.5 7"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.4v.1"/></svg>',
  };

  /* --------------------------------------------------------------- 提示条 */

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

  /* ------------------------------------------------------------ 确认对话框 */

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

  /* --------------------------------------------------------------- 请求层 */

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

  /* --------------------------------------------------------------- 用户信息 */

  function loadMe() {
    return request('/api/auth/github/me')
      .then(function (me) {
        state.me = me;
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

    $('user-btn').hidden = !authed;
    $('login-link').hidden = authed;

    if (!authed) {
      $('admin-link').hidden = true;
      $('user-menu').hidden = true;
      return;
    }

    var name = me.name || me.login || '已登录';
    var initial = String(name).slice(0, 1).toUpperCase();

    $('user-initial').textContent = initial;
    $('menu-initial').textContent = initial;
    $('menu-name').textContent = name;
    $('menu-login').textContent = loginLabel(me.login);

    [['user-avatar', 'user-initial'], ['menu-avatar', 'menu-initial']].forEach(function (pair) {
      var img = $(pair[0]);
      var txt = $(pair[1]);
      if (me.avatar) {
        img.src = me.avatar;
        img.alt = me.login || '';
        img.hidden = false;
        txt.hidden = true;
      } else {
        img.hidden = true;
        txt.hidden = false;
      }
    });

    if (me.admin) {
      $('admin-link').hidden = false;
      $('menu-admin').hidden = false;
    }
  }

  function loadQuota() {
    return request('/api/manage/quota')
      .then(function (data) {
        var chip = $('quota-chip');
        if (!data || data.success === false) {
          chip.hidden = true;
          return;
        }
        var size = Number(data.totalSizeMB);
        var sizeText = isNaN(size) ? '0 MB' : size >= 1024 ? (size / 1024).toFixed(2) + ' GB' : size.toFixed(2) + ' MB';
        chip.textContent = '已用 ' + sizeText + ' · ' + (data.totalCount || 0) + ' 个文件';
        chip.hidden = false;
      })
      .catch(function () {
        $('quota-chip').hidden = true;
      });
  }

  function logout() {
    request('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) })
      .catch(function () {
        /* 忽略：无论成功与否都回登录页 */
      })
      .then(function () {
        location.href = '/login';
      });
  }

  /* -------------------------------------------------------------- 用户菜单 */

  function openUserMenu() {
    var btn = $('user-btn');
    var menu = $('user-menu');
    menu.hidden = false;

    var rect = btn.getBoundingClientRect();
    var width = menu.offsetWidth || 216;
    var left = Math.min(rect.right - width, window.innerWidth - width - 12);
    menu.style.left = Math.max(12, left) + 'px';
    menu.style.top = rect.bottom + 8 + 'px';

    btn.setAttribute('aria-expanded', 'true');
  }

  function closeUserMenu() {
    var menu = $('user-menu');
    if (!menu.hidden) menu.hidden = true;
    $('user-btn').setAttribute('aria-expanded', 'false');
  }

  function toggleUserMenu() {
    if ($('user-menu').hidden) openUserMenu();
    else closeUserMenu();
  }

  /* ------------------------------------------------------------------ 视图 */

  function setView(view, push) {
    state.view = view;
    $('view-upload').hidden = view !== 'upload';
    $('view-history').hidden = view !== 'history';
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-nav') === view);
    });
    document.title = view === 'history' ? 'Sanyue ImgHub · 历史文件' : 'Sanyue ImgHub · 上传';
    if (push) {
      var path = view === 'history' ? '/history' : '/';
      if (location.pathname !== path) history.pushState({ view: view }, '', path);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (view === 'history' && !state.history.items.length && !state.history.loading) {
      loadHistory(true);
    }
  }

  function syncViewSwitch() {
    Array.prototype.forEach.call(document.querySelectorAll('#view-switch button'), function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-view') === state.viewMode);
    });
  }

  /* -------------------------------------------------------------- 文件卡片 */

  function actionButtons(actions) {
    var map = {
      copy: ['复制链接', ACT_ICONS.copy],
      open: ['打开原文件', ACT_ICONS.open],
      del: ['删除', ACT_ICONS.trash],
    };
    return actions
      .map(function (act) {
        return (
          '<button type="button" class="btn btn--sm" data-act="' + act + '" title="' + map[act][0] + '" aria-label="' + map[act][0] + '">' + map[act][1] + '</button>'
        );
      })
      .join('');
  }

  function buildCard(item, options) {
    options = options || {};
    var card = document.createElement('article');
    card.className = 'card';
    card.setAttribute('data-id', item.id);

    var isImage = item.category === 'image';
    var thumb = isImage
      ? '<img loading="lazy" src="' + esc(item.url) + '" alt="' + esc(item.name) + '">'
      : '<span class="card-ext">' + ICONS[item.category] + '<span>' + esc(extOf(item.name)) + '</span></span>';

    card.innerHTML =
      '<div class="card-thumb" data-act="' + (isImage ? 'preview' : 'open') + '">' +
      thumb +
      (options.selectable
        ? '<span class="card-check"><input type="checkbox" class="check" data-act="pick" aria-label="选择 ' + esc(item.name) + '"' +
          (state.history.selected[item.id] ? ' checked' : '') +
          '></span>'
        : '') +
      '<span class="card-actions">' + actionButtons(['copy', 'open', 'del']) + '</span>' +
      '</div>' +
      '<div class="card-body">' +
      '<div class="card-name" title="' + esc(item.name) + '">' + esc(item.name) + '</div>' +
      '<div class="card-meta"><span>' + esc(item.size) + '</span><em>·</em><span>' + esc(item.time) + '</span></div>' +
      '</div>';

    if (options.selectable && state.history.selected[item.id]) card.classList.add('is-selected');
    return card;
  }

  function buildRow(item) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-id', item.id);

    var isImage = item.category === 'image';
    var cellThumb = isImage
      ? '<img loading="lazy" src="' + esc(item.url) + '" alt="">'
      : '<span>' + esc(extOf(item.name)) + '</span>';

    tr.innerHTML =
      '<td class="col-check"><input type="checkbox" class="check" data-act="pick" aria-label="选择 ' + esc(item.name) + '"' +
      (state.history.selected[item.id] ? ' checked' : '') +
      '></td>' +
      '<td><div class="cell-file">' +
      '<span class="cell-thumb" data-act="' + (isImage ? 'preview' : 'open') + '">' + cellThumb + '</span>' +
      '<span class="cell-name"><b title="' + esc(item.name) + '">' + esc(item.name) + '</b><small>' + esc(item.id) + '</small></span>' +
      '</div></td>' +
      '<td class="col-type"><span class="badge">' + TYPE_LABEL[item.category] + '</span></td>' +
      '<td class="col-size num">' + esc(item.size) + '</td>' +
      '<td class="col-time num">' + esc(item.time) + '</td>' +
      '<td class="col-actions"><span class="row-actions">' + actionButtons(['copy', 'open', 'del']) + '</span></td>';

    if (state.history.selected[item.id]) tr.classList.add('is-selected');
    return tr;
  }

  function openLightbox(url) {
    $('lightbox-img').src = url;
    $('lightbox').hidden = false;
  }

  function closeLightbox() {
    $('lightbox').hidden = true;
    $('lightbox-img').src = '';
  }

  function findItem(id) {
    var pool = state.history.items.concat(state.results);
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].id === id) return pool[i];
    }
    return null;
  }

  function onItemAction(e) {
    var actEl = e.target.closest('[data-act]');
    var holder = e.target.closest('[data-id]');
    if (!holder) return;

    var id = holder.getAttribute('data-id');
    var item = findItem(id);
    if (!item) return;

    var act = actEl ? actEl.getAttribute('data-act') : null;
    if (!act) return;

    if (act === 'pick') {
      toggleSelect(id);
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (act === 'copy') {
      copyText(absolute(item.url)).then(function () {
        toast('链接已复制');
      });
    } else if (act === 'open') {
      window.open(absolute(item.url), '_blank', 'noopener');
    } else if (act === 'preview') {
      openLightbox(item.url);
    } else if (act === 'del') {
      removeFiles([id]);
    }
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
          }, 1800);
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
    for (var i = 0; i < UPLOAD_CONCURRENCY; i++) workers.push(worker());

    Promise.all(workers).then(function () {
      state.uploading = false;
      loadQuota();
      state.history.items = [];
      state.history.total = 0;
      if (state.view === 'history') loadHistory(true);
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
    var grid = $('results-grid');
    grid.innerHTML = '';

    if (!state.results.length) {
      card.hidden = true;
      return;
    }

    card.hidden = false;
    $('results-count').textContent = state.results.length;
    state.results.forEach(function (item) {
      grid.appendChild(buildCard(item, { selectable: false }));
    });
  }

  /* -------------------------------------------------------------- 历史列表 */

  function normalizeHistory(record) {
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

  function loadHistory(reset) {
    var h = state.history;
    if (h.loading) return;
    h.loading = true;
    $('history-loading').hidden = false;
    $('history-empty').hidden = true;

    if (reset) {
      h.items = [];
      h.total = 0;
      h.selected = Object.create(null);
      renderBatchBar();
    }

    var params = new URLSearchParams();
    params.set('start', String(h.items.length));
    params.set('count', String(PAGE_SIZE));
    params.set('recursive', 'true');
    if (h.type) params.set('fileType', h.type);
    if (h.search) params.set('search', h.search);

    request('/api/manage/list?' + params.toString())
      .then(function (data) {
        var files = (data && data.files) || [];
        h.total = Number(data && data.totalCount) || files.length;
        h.items = h.items.concat(files.map(normalizeHistory));
        renderHistory();
      })
      .catch(function (err) {
        if (!handleAuthError(err)) toast(err.message || '加载失败', true);
        showEmpty(err.message);
      })
      .then(function () {
        h.loading = false;
        $('history-loading').hidden = true;
      });
  }

  function renderHistory() {
    var h = state.history;
    var grid = $('history-grid');
    var tbody = $('history-tbody');
    var hasItems = h.items.length > 0;

    grid.innerHTML = '';
    tbody.innerHTML = '';

    if (!hasItems) {
      grid.hidden = true;
      $('history-list').hidden = true;
      showEmpty();
    } else {
      $('history-empty').hidden = true;
      grid.hidden = state.viewMode !== 'grid';
      $('history-list').hidden = state.viewMode !== 'list';

      h.items.forEach(function (item) {
        grid.appendChild(buildCard(item, { selectable: true }));
        tbody.appendChild(buildRow(item));
      });
    }

    $('load-more').hidden = !hasItems || h.items.length >= h.total;
    if (!$('load-more').hidden) {
      $('load-more').textContent = '加载更多 · ' + h.items.length + ' / ' + h.total;
    }

    syncSelectAll();
    updateSummary();
    renderBatchBar();
  }

  function updateSummary() {
    var h = state.history;
    var el = $('history-summary');
    if (!h.items.length && !h.total) {
      el.textContent = h.search || h.type ? '没有匹配的文件' : '你的文件会显示在这里';
      return;
    }
    var text = '共 ' + h.total + ' 个文件';
    var ids = selectedIds();
    if (ids.length) text += ' · 已选 ' + ids.length + ' 项';
    el.textContent = text;
  }

  function showEmpty(message) {
    var h = state.history;
    var box = $('history-empty');
    if (h.items.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (message) {
      $('history-empty-title').textContent = '加载失败';
      $('history-empty-sub').textContent = message;
    } else if (h.search || h.type) {
      $('history-empty-title').textContent = '没有匹配的文件';
      $('history-empty-sub').textContent = '换个关键词或筛选条件试试';
    } else {
      $('history-empty-title').textContent = '还没有文件';
      $('history-empty-sub').textContent = '上传第一个文件后，它会出现在这里';
    }
  }

  function toggleSelect(id) {
    var selected = state.history.selected;
    if (selected[id]) delete selected[id];
    else selected[id] = true;

    var card = document.querySelector('.card[data-id="' + cssEscape(id) + '"]');
    if (card) {
      card.classList.toggle('is-selected', !!selected[id]);
      var box = card.querySelector('input.check');
      if (box) box.checked = !!selected[id];
    }

    var row = document.querySelector('#history-tbody tr[data-id="' + cssEscape(id) + '"]');
    if (row) {
      row.classList.toggle('is-selected', !!selected[id]);
      var rowBox = row.querySelector('input.check');
      if (rowBox) rowBox.checked = !!selected[id];
    }

    syncSelectAll();
    updateSummary();
    renderBatchBar();
  }

  function selectedIds() {
    return Object.keys(state.history.selected);
  }

  function syncSelectAll() {
    var all = $('select-all');
    if (!all) return;
    var total = state.history.items.length;
    var count = selectedIds().length;
    all.checked = total > 0 && count >= total;
    all.indeterminate = count > 0 && count < total;
  }

  function renderBatchBar() {
    var ids = selectedIds();
    var bar = $('batchbar');
    var count = $('batch-count');

    if (ids.length) {
      bar.hidden = false;
      count.textContent = ids.length;
    } else {
      bar.hidden = true;
      count.textContent = '0';
    }

    if (state.history.items.length) {
      Array.prototype.forEach.call(document.querySelectorAll('#history-grid .card'), function (card) {
        card.classList.toggle('is-selected', !!state.history.selected[card.getAttribute('data-id')]);
      });
      Array.prototype.forEach.call(document.querySelectorAll('#history-tbody tr'), function (row) {
        row.classList.toggle('is-selected', !!state.history.selected[row.getAttribute('data-id')]);
      });
    }
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
          dropLocal(deleted.length ? deleted : ids);
          toast(deleted.length ? '已删除 ' + deleted.length + ' 个文件' : '文件已删除');
          loadQuota();
        })
        .catch(function (err) {
          if (!handleAuthError(err)) toast(err.message || '删除失败', true);
        });
    });
  }

  function dropLocal(ids) {
    var set = Object.create(null);
    ids.forEach(function (id) {
      set[id] = true;
    });

    state.history.items = state.history.items.filter(function (item) {
      return !set[item.id];
    });
    state.results = state.results.filter(function (item) {
      return !set[item.id];
    });
    ids.forEach(function (id) {
      delete state.history.selected[id];
    });
    state.history.total = Math.max(0, state.history.total - ids.length);

    renderResults();
    renderHistory();
  }

  /* ------------------------------------------------------------------ 绑定 */

  function bind() {
    $('max-size').textContent = MAX_MB;

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

    document.addEventListener('paste', function (e) {
      if (!e.clipboardData) return;
      var files = e.clipboardData.files;
      if (files && files.length) {
        if (state.view !== 'upload') setView('upload', true);
        enqueue(files);
      }
    });

    // 整页拖拽不触发浏览器默认的「打开文件」
    ['dragover', 'drop'].forEach(function (name) {
      document.addEventListener(name, function (e) {
        if (!dz.contains(e.target)) e.preventDefault();
      });
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

    // 主题
    $('theme-btn').addEventListener('click', toggleTheme);

    // 用户菜单
    $('user-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      toggleUserMenu();
    });
    $('logout-btn').addEventListener('click', function () {
      closeUserMenu();
      logout();
    });
    document.addEventListener('click', function (e) {
      if (!$('user-menu').hidden && !e.target.closest('#user-menu')) closeUserMenu();
    });
    window.addEventListener('resize', closeUserMenu);

    // 导航
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (el) {
      el.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        closeUserMenu();
        setView(el.getAttribute('data-nav'), true);
      });
    });

    window.addEventListener('popstate', function () {
      setView(location.pathname.indexOf('/history') === 0 ? 'history' : 'upload', false);
    });

    // 类型筛选
    $('type-chips').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-type]');
      if (!btn) return;
      Array.prototype.forEach.call(this.querySelectorAll('button'), function (el) {
        el.classList.toggle('is-active', el === btn);
      });
      state.history.type = btn.getAttribute('data-type') || '';
      loadHistory(true);
    });

    // 视图切换
    $('view-switch').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-view]');
      if (!btn) return;
      state.viewMode = btn.getAttribute('data-view');
      try {
        localStorage.setItem(VIEW_KEY, state.viewMode);
      } catch (err) {
        /* 隐私模式 */
      }
      syncViewSwitch();
      renderHistory();
    });

    // 搜索（输入即搜，去抖）
    var searchTimer = null;
    var searchInput = $('search-input');
    searchInput.addEventListener('input', function () {
      var value = this.value.trim();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        if (value === state.history.search) return;
        state.history.search = value;
        loadHistory(true);
      }, 320);
    });

    // 刷新
    $('refresh-btn').addEventListener('click', function () {
      loadHistory(true);
      loadQuota();
    });

    $('load-more').addEventListener('click', function () {
      loadHistory(false);
    });

    // 卡片 / 行操作（事件委托）
    $('history-grid').addEventListener('click', onItemAction);
    $('results-grid').addEventListener('click', onItemAction);
    $('history-tbody').addEventListener('click', onItemAction);

    // 全选
    $('select-all').addEventListener('change', function () {
      var on = this.checked;
      state.history.items.forEach(function (item) {
        if (on) state.history.selected[item.id] = true;
        else delete state.history.selected[item.id];
      });
      renderHistory();
    });

    // 批量操作
    $('batch-clear').addEventListener('click', function () {
      state.history.selected = Object.create(null);
      renderHistory();
    });
    $('batch-delete').addEventListener('click', function () {
      removeFiles(selectedIds());
    });

    // 灯箱
    $('lightbox').addEventListener('click', closeLightbox);
    $('lightbox-close').addEventListener('click', function (e) {
      e.stopPropagation();
      closeLightbox();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('lightbox').hidden) closeLightbox();
      closeUserMenu();
    });

    // 系统主题变化时同步按钮文案
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () {
        syncThemeButton();
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  /* ------------------------------------------------------------------ 启动 */

  try {
    var savedView = localStorage.getItem(VIEW_KEY);
    if (savedView === 'grid' || savedView === 'list') state.viewMode = savedView;
  } catch (e) {
    /* 隐私模式 */
  }

  bind();
  syncThemeButton();
  syncViewSwitch();
  setView(state.view, false);
  loadMe().then(loadQuota);
})();
