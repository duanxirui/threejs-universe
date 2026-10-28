// T31: one extensible definition for workspace content and its access points.
// The existing DOM is reparented into slots; registering a new workspace
// creates its own slot and navigation trigger without duplicating business UI.
const VALID_REGIONS = new Set(['navigation', 'inspector']);
const VALID_ID = /^[a-z][a-z0-9-]*$/;

export function createWorkspaceRegistry({ panel, rail, app }) {
  const workspaces = new Map();

  function register(definition) {
    const { id, region = 'navigation', title, icon = '#ic-list',
      slotId = id + '-workspace-slot', available = () => true,
      triggerIds = [], mount, showOnRail = true } = definition;
    if (!VALID_ID.test(id) || workspaces.has(id) || !VALID_REGIONS.has(region) ||
        typeof title !== 'string' || !title.trim() ||
        typeof available !== 'function') {
      throw new Error('Invalid or duplicate workspace: ' + String(id));
    }
    let slot = document.getElementById(slotId);
    if (!slot && region === 'navigation') {
      slot = document.createElement('section');
      slot.id = slotId;
      slot.className = 'workspace-slot';
      slot.setAttribute('aria-label', title);
      panel.append(slot);
    }
    const buttons = triggerIds.map(buttonId => document.getElementById(buttonId))
      .filter(Boolean);
    if (showOnRail) {
      let button = document.getElementById('t31-rail-' + id);
      if (!button) {
        button = document.createElement('button');
        button.id = 't31-rail-' + id;
        button.type = 'button';
        button.className = 'rail-action t31-rail-action';
        button.innerHTML = '<svg class="ui-icon" aria-hidden="true"><use></use></svg>' +
          '<span></span>';
        rail.append(button);
      }
      button.querySelector('use').setAttribute('href', icon);
      button.querySelector('span').textContent = title;
      buttons.push(button);
    }
    for (const button of buttons) {
      button.setAttribute('aria-label', title);
      button.title = title;
      if (slot) button.setAttribute('aria-controls', slot.id);
      button.setAttribute('aria-expanded', 'false');
    }
    const entry = { id, region, title, slot, available, buttons, mounted: false, mount };
    workspaces.set(id, entry);
    return entry;
  }

  function activate(id) {
    const item = workspaces.get(id);
    if (!item) return null;
    if (!item.mounted) {
      item.mount?.(item.slot, app);
      item.mounted = true;
    }
    return item;
  }

  return {
    register, activate,
    get: id => workspaces.get(id),
    list: () => [...workspaces.values()],
    has: id => workspaces.has(id)
  };
}
