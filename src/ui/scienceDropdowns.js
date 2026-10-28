// Shared styled selects for the T29/T30 science filters.
// Keep the original <select> authoritative, preserving existing change events
// and a functional native control if enhancement is unavailable.
export function createScienceDropdowns({
  ids = ['t29-distance', 't29-magnitude', 't30-category']
} = {}) {
  const root = document.getElementById('app');
  const menus = [];
  let active = null;

  function update(menu) {
    const chosen = menu.select.selectedOptions[0];
    const value = chosen?.textContent.trim() || '请选择';
    menu.value.textContent = value;
    menu.trigger.setAttribute('aria-label', menu.title + '，当前' + value);
    menu.trigger.disabled = menu.select.disabled;
    menu.shell.classList.toggle('is-disabled', menu.select.disabled);
    for (const item of menu.items) {
      const selected = item.value === menu.select.value;
      item.node.classList.toggle('is-selected', selected);
      item.node.setAttribute('aria-selected', String(selected));
    }
    if (active === menu && menu.select.disabled) close();
  }

  function highlight(menu, index) {
    const item = menu.items[index];
    if (!item || item.disabled) return;
    menu.index = index;
    menu.trigger.setAttribute('aria-activedescendant', item.node.id);
    for (const row of menu.items) {
      row.node.classList.toggle('is-active', row === item);
    }
    const top = item.node.offsetTop;
    const bottom = top + item.node.offsetHeight;
    const scrollTop = menu.list.scrollTop;
    const viewBottom = scrollTop + menu.list.clientHeight;
    if (top < scrollTop) menu.list.scrollTop = Math.max(0, top - 7);
    else if (bottom > viewBottom) {
      menu.list.scrollTop = bottom - menu.list.clientHeight + 7;
    }
  }

  function close({ restoreFocus = false } = {}) {
    if (!active) return;
    const menu = active;
    active = null;
    menu.popover.hidden = true;
    menu.shell.classList.remove('is-open');
    menu.trigger.setAttribute('aria-expanded', 'false');
    menu.trigger.removeAttribute('aria-activedescendant');
    if (restoreFocus && menu.trigger.isConnected &&
      !menu.trigger.closest('[inert], [hidden]')) {
      menu.trigger.focus({ preventScroll: true });
    }
  }

  function position(menu) {
    if (active !== menu) return;
    const rect = menu.trigger.getBoundingClientRect();
    if (!rect.width || !rect.height) { close(); return; }
    const viewport = window.visualViewport;
    const viewLeft = viewport?.offsetLeft ?? 0;
    const viewTop = viewport?.offsetTop ?? 0;
    const viewRight = viewLeft + (viewport?.width ?? innerWidth);
    const viewBottom = viewTop + (viewport?.height ?? innerHeight);
    const gap = 7;
    const margin = 12;
    const availableWidth = Math.max(180, viewRight - viewLeft - 2 * margin);
    const width = Math.min(availableWidth, Math.max(rect.width, 244));
    const belowRoom = Math.max(0, viewBottom - margin - rect.bottom - gap);
    const aboveRoom = Math.max(0, rect.top - viewTop - margin - gap);
    const idealHeight = Math.min(320, 60 + menu.items.length * 44);
    const below = belowRoom >= Math.min(idealHeight, 180) ||
      belowRoom >= aboveRoom;
    const room = Math.max(96, Math.min(idealHeight,
      below ? belowRoom : aboveRoom));
    menu.popover.style.width = width + 'px';
    menu.popover.style.maxHeight = room + 'px';
    const x = Math.max(viewLeft + margin,
      Math.min(rect.left, viewRight - margin - width));
    menu.popover.style.left = Math.round(x) + 'px';
    const height = menu.popover.getBoundingClientRect().height;
    const y = below ? Math.min(rect.bottom + gap, viewBottom - margin - height) :
      Math.max(viewTop + margin, rect.top - gap - height);
    menu.popover.style.top = Math.round(y) + 'px';
    menu.popover.dataset.placement = below ? 'below' : 'above';
  }

  function open(menu) {
    if (active === menu || menu.select.disabled ||
      menu.trigger.closest('[inert], [hidden]')) return;
    close();
    active = menu;
    update(menu);
    menu.popover.hidden = false;
    menu.shell.classList.add('is-open');
    menu.trigger.setAttribute('aria-expanded', 'true');
    position(menu);
    const selected = menu.items.findIndex(item => item.value === menu.select.value);
    highlight(menu, selected >= 0 ? selected : 0);
  }

  function choose(menu, index) {
    const item = menu.items[index];
    if (!item || item.disabled) return;
    const changed = menu.select.value !== item.value;
    menu.select.value = item.value;
    update(menu);
    close({ restoreFocus: true });
    if (changed) menu.select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function keydown(menu, event) {
    if (event.key === 'Tab') { if (active === menu) close(); return; }
    if (event.key === 'Escape') {
      if (active === menu) {
        event.preventDefault();
        event.stopPropagation();
        close({ restoreFocus: true });
      }
      return;
    }
    const movement = {
      ArrowDown: 1, ArrowUp: -1, PageDown: 4, PageUp: -4
    }[event.key];
    const nav = movement !== undefined ||
      event.key === 'Home' || event.key === 'End';
    const selectKey = event.key === 'Enter' || event.key === ' ';
    const typeahead = event.key.length === 1 && !selectKey &&
      !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing;
    if (!nav && !selectKey && !typeahead) return;
    event.preventDefault();
    event.stopPropagation();
    const wasClosed = active !== menu;
    if (wasClosed) open(menu);
    if (selectKey) {
      if (!wasClosed) choose(menu, menu.index);
      return;
    }
    if (nav) {
      const index = event.key === 'Home' ? 0 :
        event.key === 'End' ? menu.items.length - 1 :
          Math.max(0, Math.min(menu.items.length - 1,
            menu.index + (wasClosed ? 0 : movement)));
      highlight(menu, index);
    } else if (typeahead) {
      const text = event.key.toLocaleLowerCase();
      const next = menu.items.findIndex((item, index) =>
        index > menu.index && item.label.toLocaleLowerCase().startsWith(text));
      const first = menu.items.findIndex(item =>
        item.label.toLocaleLowerCase().startsWith(text));
      if (next >= 0 || first >= 0) highlight(menu, next >= 0 ? next : first);
    }
  }

  function enhance(id) {
    const select = document.getElementById(id);
    if (!select || select.dataset.scienceEnhanced === 'true') return;
    const label = select.closest('label');
    // A wrapping label also contains its option text; only its own text
    // nodes are the field name, not all option labels.
    const visibleLabel = [...(label?.childNodes || [])]
      .filter(child => child.nodeType === Node.TEXT_NODE)
      .map(child => child.textContent.trim()).filter(Boolean).join(' ');
    const title = select.getAttribute('aria-label') || visibleLabel || '筛选';
    const shell = document.createElement('div');
    shell.className = 'science-select-shell';
    shell.dataset.enhanced = 'true';
    shell.dataset.filterId = id;
    select.before(shell);
    shell.append(select);
    const trigger = document.createElement('button');
    trigger.id = id + '-trigger';
    trigger.type = 'button';
    trigger.className = 'science-select-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', id + '-listbox');
    const value = document.createElement('span');
    value.className = 'science-select-value';
    trigger.append(value);
    const chevron = document.createElement('span');
    chevron.className = 'science-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    shell.prepend(trigger);
    shell.append(chevron);
    // Clicking the original label now activates the visible button.
    if (label) label.htmlFor = trigger.id;
    const popover = document.createElement('div');
    popover.className = 'science-select-popover';
    popover.id = id + '-popover';
    popover.hidden = true;
    const heading = document.createElement('div');
    heading.className = 'science-select-heading';
    const headingText = document.createElement('strong');
    headingText.textContent = title;
    const count = document.createElement('small');
    count.textContent = select.options.length + ' 项';
    heading.append(headingText, count);
    const list = document.createElement('div');
    list.className = 'science-select-list';
    list.id = id + '-listbox';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', title);
    popover.append(heading, list);
    const menu = {
      id, title, select, shell, trigger, value, popover, list,
      items: [], index: 0
    };
    for (const [index, option] of [...select.options].entries()) {
      const row = document.createElement('div');
      row.id = id + '-option-' + index;
      row.className = 'science-select-option';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      if (option.disabled) row.setAttribute('aria-disabled', 'true');
      const content = document.createElement('span');
      content.className = 'science-select-option-text';
      content.textContent = option.textContent.trim();
      const check = document.createElement('span');
      check.className = 'science-select-check';
      check.textContent = '✓';
      check.setAttribute('aria-hidden', 'true');
      row.append(content, check);
      list.append(row);
      row.addEventListener('click', () => choose(menu, index));
      menu.items.push({
        node: row, value: option.value,
        label: option.textContent.trim(), disabled: option.disabled
      });
    }
    root.append(popover);
    popover.addEventListener('pointerdown', event => event.stopPropagation());
    trigger.addEventListener('click', () =>
      active === menu ? close() : open(menu));
    trigger.addEventListener('keydown', event => keydown(menu, event));
    select.addEventListener('change', () => update(menu));
    new MutationObserver(() => update(menu)).observe(select, {
      attributes: true, attributeFilter: ['disabled']
    });
    select.dataset.scienceEnhanced = 'true';
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    update(menu);
    menus.push(menu);
  }

  for (const id of ids) enhance(id);
  document.addEventListener('pointerdown', event => {
    if (active && !active.trigger.contains(event.target) &&
      !active.popover.contains(event.target)) close();
  }, true);
  document.addEventListener('focusin', event => {
    if (active && !active.trigger.contains(event.target) &&
      !active.popover.contains(event.target)) close();
  });
  window.addEventListener('scroll', () => { if (active) position(active); }, true);
  window.addEventListener('resize', () => { if (active) position(active); });
  window.visualViewport?.addEventListener('resize', () => {
    if (active) position(active);
  });

  return {
    close,
    sync() {
      for (const menu of menus) update(menu);
      if (active && (root.dataset.uiMode === 'pure' ||
        root.dataset.navPane !== 'objects' ||
        active.trigger.closest('[hidden], [inert]') ||
        !active.trigger.getClientRects().length)) close();
      else if (active) position(active);
    }
  };
}
