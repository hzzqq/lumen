// _selenium_test.js — ci333 Lumen 硒调(Selenium)后处理十步接线验证
// 阴影染紫褐/高光中性；state 默认/serialize/deserialize/presetToParams/赋值链/UI/oninput/uniform 全链路。
const fs = require('fs');
const main = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c)=> { if(c) pass++; else { fail++; console.log('  FAIL', n); } };

// 1. uniform 声明
ok('uniform uSelenium 声明', /uniform float uSelenium;/.test(main));
// 2. GLSL 分支
ok('GLSL 分支 if(uSelenium > 0.0)', main.includes('if(uSelenium > 0.0){'));
ok('GLSL 用紫褐硒色 seTone', main.includes('vec3 seTone = vec3(0.42, 0.30, 0.38)'));
ok('GLSL 阴影权重 smoothstep', main.includes('1.0 - smoothstep(0.0, 0.75, l)'));
ok('GLSL 最终 mix(c, se, uSelenium)', main.includes('c = mix(c, se, uSelenium);'));
// 3. state 默认
ok('state 默认 selenium=0', main.includes('glitch=0, cyanotype=0, selenium=0, moonlight=0'));
// 4. serialize
ok('serialize 含 selenium', main.includes('cyanotype: s.cyanotype, selenium: s.selenium'));
// 5. deserialize
ok('deserialize 含 selenium', main.includes("selenium: num('selenium', 0)"));
// 6. presetToParams
ok('presetToParams 含 selenium', main.includes('selenium: num(p.selenium, 0)'));
// 7. 两处赋值链
ok('赋值链 selenium=s.selenium 出现 2 次', (main.match(/selenium=s\.selenium;/g) || []).length === 2);
// 8. UI 恢复
ok('UI 恢复滑块值', main.includes("if($('selenium')) $('selenium').value = Math.round(selenium * 100);"));
// 9. oninput
ok('oninput 绑定', main.includes("$('selenium').oninput = e=>{ selenium=+e.target.value/100;"));
// 10. uniform 绑定
ok('uniform1f 绑定', main.includes("gl.uniform1f(u(showProg,'uSelenium'), selenium);"));
// 11. 本地快照列表
ok('快照列表含 selenium', main.includes('glitch, cyanotype, selenium, moonlight, verdigris, rosegold, aurora, amber, fisheye });'));
// 12. index.html 滑块
ok('index.html 滑块', html.includes('id="selenium"') && html.includes('硒调 Selenium'));

// presetToParams 实际执行返回 102 字段，且 selenium 默认 0 / 透传
{
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  ok('presetToParams 可抽取', !!m);
  const f = eval('(' + m[0] + ')');
  const keys = Object.keys(f({}));
  ok('presetToParams 返回 102 字段', keys.length === 102);
  ok('selenium 默认 0', f({}).selenium === 0);
  ok('selenium 透传 0.7', f({ selenium: 0.7 }).selenium === 0.7);
}

console.log('selenium: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
