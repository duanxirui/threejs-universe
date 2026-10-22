// Accessible select-backed comboboxes for flight controls and render quality.
// The original native select remains the single source of truth for app state.
// It is only visually replaced after the accessible custom control is ready.
const svgNs = 'http://www.w3.org/2000/svg';

function icon(name) {
  const svg = document.createElementNS(svgNs, 'svg');
  svg.classList.add('ui-icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svgNs, 'use');
  use.setAttribute('href', '#ic-' + name);
  svg.append(use);
  return svg;
}

export function createFlightDropdowns({ accentFor = () => null } = {}) {
  const app = document.getElementById('app');
  const menus = [];
  let active = null;

  function updateSelection(menu) {
    const selected = menu.select.selectedOptions[0];
    menu.value.textContent = selected?.textContent.trim() || '选择天体';
    if (menu.kind === 'quality') {
      menu.trigger.setAttribute('aria-label', '渲染画质，当前' + menu.value.textContent);
    }
    menu.trigger.classList.toggle('is-placeholder', !menu.select.value);
    for (const item of menu.items) {
      const chosen = item.value === menu.select.value;
      item.node.classList.toggle('is-selected', chosen);
      item.node.setAttribute('aria-selected', String(chosen));
    }
  }

  function markActive(menu, index, scroll = true) {
    if (index < 0 || index >= menu.items.length || menu.items[index].disabled) return;
    menu.index = index;
    const item = menu.items[index];
    menu.trigger.setAttribute('aria-activedescendant', item.node.id);
    for (const entry of menu.items) {
      entry.node.classList.toggle('is-active', entry === item);
    }
    if (scroll) {
      const top = item.node.offsetTop;
      const bottom = top + item.node.offsetHeight;
      if (top < menu.list.scrollTop + 5) menu.list.scrollTop = Math.max(0, top - 8);
      else if (bottom > menu.list.scrollTop + menu.list.clientHeight - 5) {
        menu.list.scrollTop = bottom - menu.list.clientHeight + 8;
      }
    }
  }

  function close({ restoreFocus = false } = {}) {
    if (!active) return;
    const closing = active;
    active = null;
    closing.popover.hidden = true;
    closing.shell.classList.remove('is-open');
    closing.trigger.setAttribute('aria-expanded', 'false');
    closing.trigger.removeAttribute('aria-activedescendant');
    if (restoreFocus && !closing.trigger.closest('[hidden], [inert]')) {
      closing.trigger.focus({ preventScroll: true });
    }
  }

  function position(menu) {
    if (active !== menu) return;
    const rect = menu.trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft ?? 0;
    const topEdge = viewport?.offsetTop ?? 0;
    const rightEdge = leftEdge + (viewport?.width ?? innerWidth);
    const bottomEdge = topEdge + (viewport?.height ?? innerHeight);
    const safeTop = topEdge + 64;
    const margin = 12;
    const gap = 8;
    const availableBelow = Math.max(0, bottomEdge - margin - rect.bottom - gap);
    const availableAbove = Math.max(0, rect.top - safeTop - gap);
    const targetHeight = menu.kind === 'target' ? 366 :
      menu.kind === 'quality' ? 256 : 290;
    const below = availableBelow >= Math.min(targetHeight, menu.popover.scrollHeight) ||
      availableBelow >= availableAbove;
    const room = below ? availableBelow : availableAbove;
    const width = Math.min(rightEdge - leftEdge - 2 * margin,
      Math.max(rect.width, menu.kind === 'target' ? 286 :
        menu.kind === 'quality' ? 264 : 236));
    menu.popover.style.width = Math.max(170, width) + 'px';
    menu.popover.style.left = Math.max(leftEdge + margin,
      Math.min(menu.kind === 'quality' ? rect.right - width : rect.left,
        rightEdge - margin - width)) + 'px';
    menu.popover.style.maxHeight = Math.max(92, Math.min(targetHeight, room)) + 'px';
    const actualHeight = menu.popover.getBoundingClientRect().height;
    menu.popover.style.top = Math.round(below ? rect.bottom + gap :
      rect.top - gap - actualHeight) + 'px';
    menu.popover.dataset.placement = below ? 'below' : 'above';
  }

  function open(menu) {
    if (active === menu) return;
    close();
    active = menu;
    updateSelection(menu);
    menu.popover.hidden = false;
    menu.shell.classList.add('is-open');
    menu.trigger.setAttribute('aria-expanded', 'true');
    position(menu);
    const selectedIndex = menu.items.findIndex(item => item.value === menu.select.value);
    markActive(menu, selectedIndex >= 0 ? selectedIndex : 0);
  }

  function choose(menu, index) {
    const selected = menu.items[index];
    if (!selected || selected.disabled) return;
    const changed = menu.select.value !== selected.value;
    menu.select.value = selected.value;
    updateSelection(menu);
    close({ restoreFocus: true });
    if (changed) menu.select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function keydown(menu, event) {
    if (event.key === 'Tab') {
      if (active === menu) close();
      return;
    }
    if (event.key === 'Escape') {
      if (active === menu) {
        event.preventDefault();
        event.stopPropagation();
        close({ restoreFocus: true });
      }
      return;
    }
    const opening = active !== menu;
    const navigates = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key);
    const selects = event.key === 'Enter' || event.key === ' ';
    const typing = event.key.length === 1 && !event.ctrlKey && !event.metaKey &&
      !event.altKey && !event.isComposing;
    if (!navigates && !selects && !typing) return;
    event.preventDefault();
    event.stopPropagation();
    if (opening) open(menu);
    if (selects) {
      if (!opening) choose(menu, menu.index);
      return;
    }
    const last = menu.items.length - 1;
    if (navigates) {
      const move = {
        ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5
      }[event.key] || 0;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? last :
        Math.max(0, Math.min(last, menu.index + (opening ? 0 : move)));
      markActive(menu, next);
    } else if (typing) {
      const character = event.key.toLocaleLowerCase();
      const first = menu.items.findIndex((item, index) =>
        index > menu.index && item.label.toLocaleLowerCase().startsWith(character));
      const next = first >= 0 ? first : menu.items.findIndex(item =>
        item.label.toLocaleLowerCase().startsWith(character));
      if (next >= 0) markActive(menu, next);
    }
  }

  function makeMenu(id, kind) {
    const select = document.getElementById(id);
    let shell = select.closest('.flight-select-shell');
    if (kind === 'quality') {
      // The settings row already owns this native select. Keep it as the
      // authoritative value, and add the same styled shell used by flight.
      shell = document.createElement('div');
      shell.className = 'flight-select-shell quality-select-shell';
      select.before(shell);
      shell.append(select);
      const arrow = icon('chevron-down');
      arrow.classList.add('select-chevron');
      shell.append(arrow);
    }
    const label = document.querySelector('label[for="' + id + '"]');
    const title = kind === 'target' ? '航行目标' :
      kind === 'quality' ? '渲染画质' : '飞行速度';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'flight-select-trigger';
    trigger.id = id + '-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', id + '-listbox');
    const value = document.createElement('span');
    value.className = 'flight-select-value';
    value.id = id + '-value';
    if (kind === 'quality') {
      const titleNode = document.querySelector('.quality-control .settings-row-copy strong');
      if (titleNode) {
        titleNode.id = id + '-label';
        trigger.setAttribute('aria-labelledby', titleNode.id + ' ' + value.id);
      } else trigger.setAttribute('aria-label', title);
    } else trigger.setAttribute('aria-labelledby', id + '-label ' + value.id);
    trigger.append(value);

    const popover = document.createElement('div');
    popover.className = 'flight-option-popover';
    popover.id = id + '-popover';
    popover.dataset.kind = kind;
    popover.hidden = true;
    const heading = document.createElement('div');
    heading.className = 'flight-option-heading';
    const titleNode = document.createElement('strong');
    titleNode.textContent = title;
    const total = document.createElement('small');
    total.textContent = kind === 'target' ? (select.options.length - 1) + ' 个天体' :
      kind === 'quality' ? select.options.length + ' 档画质' :
        select.options.length + ' 种速度';
    heading.append(titleNode, total);
    const list = document.createElement('div');
    list.id = id + '-listbox';
    list.className = 'flight-option-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', title);
    popover.append(heading, list);
    const menu = { id, kind, select, shell, label, trigger, value, popover, list, items: [], index: 0 };

    function addOption(option, parent) {
      const index = menu.items.length;
      const row = document.createElement('div');
      row.className = 'flight-option';
      row.id = id + '-option-' + index;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      if (option.disabled) row.setAttribute('aria-disabled', 'true');
      row.dataset.value = option.value;

      const symbol = document.createElement('span');
      symbol.className = kind === 'target' ? 'flight-option-orb' : 'flight-option-symbol';
      symbol.setAttribute('aria-hidden', 'true');
      if (kind === 'target' && option.value) {
        const tint = accentFor(option.value);
        if (tint) symbol.style.setProperty('--option-color', tint);
      } else if (kind === 'quality') {
        symbol.append(icon(option.value === 'high' ? 'eye' :
          option.value === 'low' ? 'minus' : 'gauge'));
      } else if (kind === 'speed') symbol.append(icon('gauge'));
      else symbol.append(icon('target'));
      const text = document.createElement('span');
      text.className = 'flight-option-text';
      const parts = option.textContent.trim().split(' · ');
      const labelText = kind === 'speed' ? parts[0] : option.textContent.trim();
      text.textContent = labelText;
      if (kind === 'quality') {
        row.classList.add('quality-option');
        const copy = document.createElement('span');
        copy.className = 'quality-option-copy';
        const detail = document.createElement('small');
        detail.className = 'quality-option-hint';
        detail.textContent = {
          auto: '平衡画质与流畅度',
          low: '降低资源占用',
          high: '优先呈现视觉细节'
        }[option.value] || '';
        copy.append(text, detail);
        row.append(symbol, copy);
      } else row.append(symbol, text);
      if (kind === 'speed') {
        const multiplier = document.createElement('span');
        multiplier.className = 'flight-option-multiplier';
        multiplier.textContent = parts[1] || '';
        row.append(multiplier);
      }
      const tick = icon('check');
      tick.classList.add('flight-option-check');
      row.append(tick);
      menu.items.push({ node: row, value: option.value, label: labelText, disabled: option.disabled });
      parent.append(row);
      row.addEventListener('click', () => choose(menu, index));
    }

    for (const child of select.children) {
      if (child.tagName === 'OPTGROUP') {
        const group = document.createElement('div');
        group.className = 'flight-option-group';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', child.label);
        const groupHeading = document.createElement('div');
        groupHeading.className = 'flight-option-group-title';
        groupHeading.textContent = child.label;
        groupHeading.setAttribute('aria-hidden', 'true');
        group.append(groupHeading);
        for (const option of child.children) addOption(option, group);
        list.append(group);
      } else if (child.tagName === 'OPTION') addOption(child, list);
    }
    if (label) {
      label.removeAttribute('for');
      label.id = id + '-label';
      label.addEventListener('click', () => {
        trigger.focus({ preventScroll: true });
        if (active === menu) close();
        else open(menu);
      });
    }
    shell.insertBefore(trigger, select);
    app.append(popover);
    // Prevent the generic outside-workspace pointer handler from dismissing
    // the flight drawer before the option's click commits its value.
    popover.addEventListener('pointerdown', event => event.stopPropagation());
    trigger.addEventListener('click', () => {
      if (active === menu) close();
      else open(menu);
    });
    trigger.addEventListener('keydown', event => keydown(menu, event));
    select.addEventListener('change', () => updateSelection(menu));
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    shell.dataset.enhanced = 'true';
    updateSelection(menu);
    menus.push(menu);
  }

  makeMenu('free-target-select', 'target');
  makeMenu('flight-speed', 'speed');
  makeMenu('quality-select', 'quality');

  document.addEventListener('pointerdown', event => {
    if (active && !active.trigger.contains(event.target) &&
      !active.popover.contains(event.target)) close();
  }, true);
  document.addEventListener('focusin', event => {
    if (active && !active.trigger.contains(event.target) &&
      !active.popover.contains(event.target)) close();
  });
  window.addEventListener('resize', () => { if (active) position(active); });
  window.addEventListener('scroll', () => { if (active) position(active); }, true);
  window.visualViewport?.addEventListener('resize', () => { if (active) position(active); });

  return {
    close,
    sync() {
      for (const menu of menus) updateSelection(menu);
      if (active && (app.dataset.uiMode === 'pure' ||
        (active.kind === 'quality' ?
          app.dataset.activeDrawer !== 'settings' :
          app.dataset.view !== 'free' || app.dataset.activeDrawer !== 'flight'))) close();
      else if (active) {
        const currentIndex = active.items.findIndex(item => item.value === active.select.value);
        if (currentIndex >= 0) markActive(active, currentIndex, false);
        position(active);
      }
    }
  };
}
