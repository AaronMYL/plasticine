// 开始页：本机本体还在起（starting）、没起来（failed）、没带本体又没填过远程地址（setup）。只用 server 那两条接口。
const params = new URLSearchParams(location.search);
const state = params.get('state') || 'starting';
const problem = params.get('problem') || '';
const title = document.getElementById('title');
const detail = document.getElementById('detail');
const form = document.getElementById('remote');
if (state === 'failed') {
  title.textContent = '这台电脑上的 Plasticine 没起来';
  detail.textContent = problem;
  form.hidden = false;
} else if (state === 'setup') {
  title.textContent = '连上你的 Plasticine';
  form.hidden = false;
}
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const remoteUrl = document.getElementById('address').value.trim();
  window.plasticineDesktop.server.choose({ mode: 'remote', remoteUrl }).catch((error) => {
    detail.textContent = String(error && error.message ? error.message : error).replace(/^Error invoking[^:]*: /, '');
  });
});
