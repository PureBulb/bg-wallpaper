const sidecar = window.sidecar;
const $ = (id) => document.getElementById(id);

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await sidecar.fetch(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

function syncUi(settings) {
  $('toggle-enabled').checked = settings.enabled !== false;
  $('input-path').value = settings.imagePath || '';

  const opPct = Math.round((settings.opacity ?? 0.42) * 100);
  $('range-opacity').value = opPct;
  $('val-opacity').textContent = `${opPct}%`;

  const blurVal = Math.round(settings.blur ?? 4);
  $('range-blur').value = blurVal;
  $('val-blur').textContent = `${blurVal} px`;

  const surfVal = Math.round(settings.surfaceOpacity ?? 78);
  $('range-surface').value = surfVal;
  $('val-surface').textContent = `${surfVal}%`;

  $('select-fit').value = settings.fit === 'contain' ? 'contain' : 'cover';

  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.classList.toggle('active', settings.mode === 'preset' && btn.dataset.preset === settings.presetId);
  });
}

async function updateSettings(patch, message) {
  try {
    const res = await api('/api/settings', { method: 'POST', body: patch });
    syncUi(res.settings);
    if (message) toast(message);
  } catch (err) {
    toast(`设置失败: ${err.message}`);
  }
}

let sliderDebounce = null;
function scheduleSliderSave(patch) {
  clearTimeout(sliderDebounce);
  sliderDebounce = setTimeout(() => updateSettings(patch), 120);
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    toast('请选择有效的图片文件');
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const res = await api('/api/upload', {
        method: 'POST',
        body: { filename: file.name, dataUrl: reader.result },
      });
      syncUi(res.settings);
      toast(`已应用壁纸: ${file.name}`);
    } catch (err) {
      toast(`上传失败: ${err.message}`);
    }
  };
  reader.readAsDataURL(file);
}

// Events
$('toggle-enabled').addEventListener('change', (e) => {
  updateSettings({ enabled: e.target.checked }, e.target.checked ? '已开启自定义背景' : '已关闭自定义背景');
});

const dropzone = $('dropzone');
const fileInput = $('file-input');
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
});
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

$('btn-apply-path').addEventListener('click', () => {
  const imagePath = $('input-path').value.trim();
  if (!imagePath) {
    toast('请输入本地图片路径');
    return;
  }
  updateSettings({ enabled: true, mode: 'file', imagePath }, '已应用本地壁纸路径');
});

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    updateSettings({ enabled: true, mode: 'preset', presetId: btn.dataset.preset }, '已切换预设壁纸');
  });
});

$('range-opacity').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  $('val-opacity').textContent = `${v}%`;
  scheduleSliderSave({ opacity: v / 100 });
});

$('range-blur').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  $('val-blur').textContent = `${v} px`;
  scheduleSliderSave({ blur: v });
});

$('range-surface').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  $('val-surface').textContent = `${v}%`;
  scheduleSliderSave({ surfaceOpacity: v });
});

$('select-fit').addEventListener('change', (e) => {
  updateSettings({ fit: e.target.value }, '已切换填充模式');
});

async function refresh() {
  try {
    const data = await api('/api/state');
    syncUi(data.settings);
    const pill = $('hook-status');
    if (data.runtime && data.runtime.hookActive) {
      pill.textContent = '● 引擎已挂载';
      pill.className = 'pill ok';
      $('restart-banner').hidden = true;
    } else {
      pill.textContent = '待重启生效';
      pill.className = 'pill warn';
      $('restart-banner').hidden = false;
    }
  } catch (_) {
    $('hook-status').textContent = '连接异常';
    $('hook-status').className = 'pill warn';
  }
}

refresh();
