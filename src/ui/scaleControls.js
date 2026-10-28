// T27 - One scale control inside the existing T31 Settings work area.
// Keeps the scene immersive; no new permanent toolbar or duplicate modal.
const get = id => document.getElementById(id);
function textNode(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

export function createScaleControls({ universe, toast = () => {} }) {
  const settings = get('settings-workspace-slot');
  const settingsGroup = settings.querySelector('.settings-group');
  if (!settingsGroup) throw Error('T27: settings group not yet built');
  const section = textNode('section', 't27-scale-controls');
  section.id = 't27-scale-controls';
  section.setAttribute('aria-label', '太阳系显示尺度');
  const title = textNode('h3', '', '太阳系显示尺度');
  const row = textNode('div', 't27-scale-buttons');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', '尺度模式');
  const buttons = [
    ['enhanced', '科普增强'],
    ['physical', '真实比例']
  ].map(([mode, label]) => {
    const button = textNode('button', '', label);
    button.type = 'button';
    button.id = 't27-scale-' + mode;
    button.dataset.scaleMode = mode;
    button.setAttribute('aria-pressed', String(mode === 'enhanced'));
    button.addEventListener('click', () => {
      if (!universe.setScaleMode(mode)) {
        toast('正在切换场景，暂时无法调整比例');
        return;
      }
      render();
      toast(mode === 'physical'
        ? '已切换真实尺度：天体可能非常小，可从探索列表聚焦'
        : '已恢复科普增强比例');
    });
    row.append(button);
    return button;
  });
  const summary = textNode('p', 't27-scale-summary');
  summary.id = 't27-scale-summary';
  summary.setAttribute('role', 'status');
  const help = textNode('p', 't27-scale-help');
  section.append(title, row, summary, help);
  settingsGroup.append(section);
  function render(info = universe.getScaleInfo()) {
    const physical = info.mode === 'physical';
    get('app').dataset.scaleMode = info.mode;
    buttons.forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.scaleMode === info.mode));
    });
    summary.textContent = physical
      ? '按统一公里比例显示距离与直径（1 AU = 1000 场景单位）'
      : '行星与卫星已放大，距离按科普视图调整';
    help.textContent = physical
      ? '大小和中心距离使用同一比例；地球、月球等在总览中非常小。四天体可用 DE441 日期位置，其余天体使用近似距离与演示角度。聚焦时自动使用浮动原点。'
      : '保留适合近距离观察的视觉比例；天体的物理数值与 UTC 星历不受显示模式影响。';
  }
  render();
  return { render };
}
