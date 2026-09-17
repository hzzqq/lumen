/* Lumen 使用说明面板
 * 自包含组件：只注入自己的 DOM 与样式，不读写任何业务变量、不改动渲染逻辑。
 * 打开：右下角「?」按钮 / 键盘 ? / F1        关闭：Esc / 点遮罩 / 右上角 ×
 * 首次访问自动展开一次（localStorage 记住，之后不再自动弹）。
 */
(function () {
  'use strict';

  var STORE_KEY = 'lumen.help.seen.v1';
  var TITLE = 'Lumen 使用说明';
  var SUBTITLE = 'WebGL2 实时路径追踪渲染器';

  var SECTIONS = [
    {
      h: '这是什么',
      p: '一个跑在浏览器里的<b>路径追踪渲染器</b>：光线在场景里反复弹射，模拟真实的反射、折射、软阴影与全局光照。',
      list: [
        '画面是<b>逐帧累积</b>出来的——每一帧往每个像素补一个采样，然后取平均。',
        '左上角 <code>SPP</code> 是每像素累积的采样数。<b>SPP 越高噪点越少</b>，放着不动几秒钟画面就会自己变干净。',
        '任何改动相机或场景的操作都会让 SPP 归零、重新开始累积——这是正常的。'
      ]
    },
    {
      h: '画面操作',
      table: [
        ['左键拖拽', '绕场景中心旋转视角'],
        ['滚轮', '推近 / 拉远（距离 3–40）'],
        ['自动旋转', '让相机自己转圈，适合看整体'],
        ['暂停 / 继续', '冻结累积，方便截图或省电'],
        ['重新累积', '手动清空累积缓冲，从 SPP 0 重来']
      ]
    },
    {
      h: '键盘快捷键',
      table: [
        ['Space', '暂停 / 继续累积'],
        ['R', '重新累积'],
        ['S', '保存 PNG（自动隐藏帮助/设置按钮）'],
        ['A', '切换自动旋转'],
        ['? / F1', '打开本说明'],
        ['Esc', '关闭说明 / 设置面板']
      ]
    },
    {
      h: '三个最该先调的参数',
      list: [
        '<b>场景</b> — 5 个内置场景：经典展厅（反射/折射球）、彩色球阵、极简夜灯、BVH 网格 + 环境天空、Cornell Box（面积光经典演示）。',
        '<b>分辨率</b> — 先调<b>低</b>快速找构图，定稿了再调高慢慢烤。',
        '<b>反弹次数</b> — 光线最多弹几次。玻璃/金属场景要调高才通透，但越高越慢。'
      ]
    },
    {
      h: '相机与景深',
      p: '想要那种「主体清晰、前后虚化」的照片感：',
      list: [
        '先把 <b>对焦距离</b> 调到主体所在的深度；',
        '再把 <b>光圈</b> 开大，光圈越大虚化越强；',
        '视野（FOV）越小越像长焦，压缩空间感。'
      ]
    },
    {
      h: '参数分两类，行为不一样',
      table: [
        ['渲染类', '场景 / 反弹 / 分辨率 / 相机 / 光照 / 曝光 —— 改动后<b>清空累积</b>，SPP 从 0 重来'],
        ['后期类', '泛光 / 暗角 / 伽马 / 色差 / 颗粒 / 色调映射 —— <b>即时生效</b>，不打断累积']
      ],
      p2: '所以调后期可以随便拖，画面不会退回噪点状态。'
    },
    {
      h: '保存与分享',
      table: [
        ['保存 PNG', '把当前累积结果导出成图片'],
        ['⬇ 导出场景', '把全部参数存成 JSON 文件'],
        ['⬆ 导入场景', '读回 JSON，一键还原到当时的效果']
      ]
    },
    {
      h: '遇到问题',
      table: [
        ['画面全黑', '浏览器不支持 WebGL2，或显卡驱动禁用了硬件加速。换 Chrome / Edge 新版本试试'],
        ['很卡', '把分辨率和反弹次数都调低；关掉自动旋转'],
        ['噪点一直不消', '看看是不是在持续拖拽——只要动相机就会重新累积。松手静置几秒'],
        ['双击 html 打不开', '本项目用了 ES Module，必须经 HTTP 打开。双击 <code>start.bat</code>，浏览器访问 <code>localhost:18081</code>']
      ]
    }
  ];

  /* ---------------- 以下为通用渲染逻辑 ---------------- */

  function css() {
    return [
      '.wbh-fab{position:fixed;right:18px;bottom:18px;width:42px;height:42px;border-radius:50%;',
      'background:rgba(20,26,34,.92);color:#4fd1c5;border:1px solid #2b3742;font:600 19px/1 ui-monospace,Menlo,Consolas,monospace;',
      'cursor:pointer;z-index:99998;display:flex;align-items:center;justify-content:center;',
      'box-shadow:0 6px 20px rgba(0,0,0,.45);transition:.16s;}',
      '.wbh-fab:hover{background:#16202b;color:#7ff0e4;transform:translateY(-2px);border-color:#4fd1c5;}',
      '.wbh-mask{position:fixed;inset:0;background:rgba(4,7,11,.72);backdrop-filter:blur(3px);',
      'z-index:99999;display:none;align-items:center;justify-content:center;padding:26px;}',
      '.wbh-mask.on{display:flex;}',
      '.wbh-box{background:#11151c;border:1px solid #263140;border-radius:14px;max-width:760px;width:100%;',
      'max-height:84vh;overflow:auto;color:#cdd6e0;font:13.5px/1.72 ui-sans-serif,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
      'box-shadow:0 24px 70px rgba(0,0,0,.6);position:relative;}',
      '.wbh-hd{position:sticky;top:0;background:linear-gradient(180deg,#141a23,#11151c);padding:18px 22px 13px;',
      'border-bottom:1px solid #202a36;display:flex;align-items:baseline;gap:10px;}',
      '.wbh-hd h2{margin:0;font-size:18px;color:#eaf2f8;letter-spacing:.5px;}',
      '.wbh-hd .sub{font-size:12px;color:#6d7d8d;}',
      '.wbh-x{position:absolute;right:14px;top:13px;width:28px;height:28px;border-radius:7px;background:transparent;',
      'border:1px solid #2b3742;color:#8b9aa8;cursor:pointer;font-size:15px;line-height:1;}',
      '.wbh-x:hover{background:#1b2530;color:#e6f2f8;}',
      '.wbh-bd{padding:6px 22px 22px;}',
      '.wbh-sec{margin-top:19px;}',
      '.wbh-sec h3{margin:0 0 7px;font-size:13.5px;color:#4fd1c5;letter-spacing:.6px;',
      'display:flex;align-items:center;gap:8px;}',
      '.wbh-sec h3::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,#22303c,transparent);}',
      '.wbh-sec p{margin:0 0 8px;color:#a9b8c6;}',
      '.wbh-sec ul{margin:0;padding-left:19px;color:#a9b8c6;}',
      '.wbh-sec li{margin:4px 0;}',
      '.wbh-sec b{color:#dce8f2;font-weight:600;}',
      '.wbh-t{width:100%;border-collapse:collapse;margin:2px 0 4px;}',
      '.wbh-t td{padding:6px 10px;border-bottom:1px solid #1c2530;vertical-align:top;color:#a9b8c6;}',
      '.wbh-t tr:last-child td{border-bottom:none;}',
      '.wbh-t td:first-child{width:34%;color:#dce8f2;font-weight:600;white-space:nowrap;}',
      '.wbh-bd code{background:#0b0f14;border:1px solid #1f2a35;border-radius:4px;padding:1px 6px;',
      'font:12px ui-monospace,Menlo,Consolas,monospace;color:#4fd1c5;}',
      '.wbh-ft{margin-top:22px;padding-top:13px;border-top:1px solid #1c2530;color:#5f6f7e;font-size:12px;}',
      '@media(max-width:640px){.wbh-t td:first-child{width:42%;white-space:normal;}}',
      /* 首次访问的「非阻塞」提示条：仅占底部一小条，绝不覆盖画布/侧栏/聊天，永不锁死应用 */
      '.wbh-hint{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99997;',
      'display:flex;align-items:center;gap:10px;background:rgba(17,21,28,.96);color:#cdd6e0;',
      'border:1px solid #2b3742;border-radius:10px;padding:10px 14px;',
      'font:13px ui-sans-serif,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
      'box-shadow:0 8px 28px rgba(0,0,0,.5);max-width:min(90vw,640px);}',
      '.wbh-hint b{color:#4fd1c5;}',
      '.wbh-hint-open{background:#4fd1c522;border:1px solid #4fd1c5;color:#4fd1c5;border-radius:8px;',
      'padding:5px 12px;cursor:pointer;font-size:12px;flex:none;}',
      '.wbh-hint-open:hover{background:#4fd1c533;}',
      '.wbh-hint-x{background:transparent;border:1px solid #2b3742;color:#8b9aa8;border-radius:6px;',
      'width:26px;height:26px;cursor:pointer;font-size:14px;line-height:1;flex:none;}',
      '.wbh-hint-x:hover{background:#1b2530;color:#e6f2f8;}'
    ].join('');
  }

  function esc(s) { return String(s); }

  function build() {
    var st = document.createElement('style');
    st.textContent = css();
    document.head.appendChild(st);

    var html = '<div class="wbh-box" role="dialog" aria-modal="true" aria-label="' + TITLE + '">' +
      '<div class="wbh-hd"><h2>' + TITLE + '</h2><span class="sub">' + SUBTITLE + '</span></div>' +
      '<button class="wbh-x" title="关闭 (Esc)">&times;</button><div class="wbh-bd">';

    SECTIONS.forEach(function (s) {
      html += '<div class="wbh-sec"><h3>' + esc(s.h) + '</h3>';
      if (s.p) html += '<p>' + s.p + '</p>';
      if (s.list) {
        html += '<ul>';
        s.list.forEach(function (li) { html += '<li>' + li + '</li>'; });
        html += '</ul>';
      }
      if (s.table) {
        html += '<table class="wbh-t"><tbody>';
        s.table.forEach(function (r) { html += '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; });
        html += '</tbody></table>';
      }
      if (s.p2) html += '<p>' + s.p2 + '</p>';
      html += '</div>';
    });

    html += '<div class="wbh-ft">随时按 <code>?</code> 或 <code>F1</code> 再次打开本说明 · <code>Esc</code> 关闭</div>';
    html += '</div></div>';

    var mask = document.createElement('div');
    mask.className = 'wbh-mask';
    mask.innerHTML = html;
    document.body.appendChild(mask);

    var fab = document.createElement('button');
    fab.className = 'wbh-fab';
    fab.textContent = '?';
    fab.title = '使用说明 (? 或 F1)';
    document.body.appendChild(fab);

    function open() { mask.classList.add('on'); }
    function close() { mask.classList.remove('on'); }
    function toggle() { mask.classList.contains('on') ? close() : open(); }

    fab.addEventListener('click', open);
    mask.querySelector('.wbh-x').addEventListener('click', close);
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) close(); });

    document.addEventListener('keydown', function (e) {
      var t = e.target, tag = t && t.tagName;
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
      if (e.key === 'Escape' && mask.classList.contains('on')) { close(); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?' || e.key === 'F1') { e.preventDefault(); toggle(); }
    });

    try {
      if (!localStorage.getItem(STORE_KEY)) { firstVisitHint(); localStorage.setItem(STORE_KEY, '1'); }
    } catch (_) { /* 隐私模式下 localStorage 不可用，忽略 */ }

    // 首次访问提示：非阻塞小条，绝不弹出全屏遮罩锁死应用；点击可主动打开完整说明。
    function firstVisitHint() {
      var bar = document.createElement('div');
      bar.className = 'wbh-hint';
      bar.innerHTML = '<span>📖 首次使用 Lumen？点击右下角 <b>?</b> 随时查看完整使用说明</span>' +
        '<button class="wbh-hint-open" type="button">查看说明</button>' +
        '<button class="wbh-hint-x" type="button" title="不再提示">&times;</button>';
      document.body.appendChild(bar);
      var openBtn = bar.querySelector('.wbh-hint-open');
      var closeBtn = bar.querySelector('.wbh-hint-x');
      if (openBtn) openBtn.addEventListener('click', function () { open(); if (bar.parentNode) bar.parentNode.removeChild(bar); });
      if (closeBtn) closeBtn.addEventListener('click', function () { if (bar.parentNode) bar.parentNode.removeChild(bar); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
