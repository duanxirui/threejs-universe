// T28: a single observation readout inside the existing T31 time workspace.
// It consumes date geometry from the solar model and never fabricates a
// phase for the old educational animation clock.
const get = id => document.getElementById(id);
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function paintPhase(canvas, fraction, waxing) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const size = canvas.width;
  const center = size / 2;
  const radius = size * 0.43;
  const phaseCos = 2 * fraction - 1;
  const side = (waxing ? 1 : -1) * Math.sqrt(Math.max(0, 1 - phaseCos ** 2));
  const pixels = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5 - center) / radius;
      const ny = (center - y - 0.5) / radius;
      const r2 = nx * nx + ny * ny;
      if (r2 > 1) continue;
      const nz = Math.sqrt(1 - r2);
      const lit = nx * side + nz * phaseCos > 0;
      const surface = Math.max(0.35, 0.9 - r2 * 0.3);
      const level = lit ? 205 * surface : 24 * surface;
      const offset = (y * size + x) * 4;
      pixels.data[offset] = Math.round(level * (lit ? 1 : 0.65));
      pixels.data[offset + 1] = Math.round(level * (lit ? 1.05 : 0.95));
      pixels.data[offset + 2] = Math.round(level * (lit ? 1.14 : 1.7));
      pixels.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  ctx.strokeStyle = 'rgba(180, 205, 225, .55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.stroke();
}

export function createObservationControls({ universe }) {
  const host = get('time-workspace-slot');
  if (!host) throw Error('T28: time workspace is unavailable');
  const section = element('section', 't28-observations');
  section.id = 't28-observations';
  section.setAttribute('aria-label', '太阳照射与月相');
  const header = element('div', 't28-header');
  header.append(element('h3', '', '太阳照射与月相'),
    element('span', 't28-kicker', 'T28 · 观测现象'));
  const status = element('p', 't28-observation-status', '启用 UTC 日期后显示观测几何');
  status.id = 't28-observation-status';
  const grid = element('div', 't28-observation-grid');
  grid.id = 't28-observation-grid';
  const moon = element('div', 't28-moon-reading');
  const canvas = document.createElement('canvas');
  canvas.id = 't28-moon-phase';
  canvas.width = 92;
  canvas.height = 92;
  canvas.setAttribute('role', 'img');
  const moonValues = element('div', 't28-moon-values');
  const phaseName = element('strong', '', '—');
  phaseName.id = 't28-phase-name';
  const illumination = element('span', '', '月面受光比例：—');
  illumination.id = 't28-illumination';
  const elongation = element('small', '', '日月角距：—');
  elongation.id = 't28-elongation';
  moonValues.append(phaseName, illumination, elongation);
  moon.append(canvas, moonValues);
  const earth = element('div', 't28-earth-reading');
  earth.append(element('small', '', '地球 · 太阳直射点纬度'));
  const declination = element('strong', '', '—');
  declination.id = 't28-subsolar-latitude';
  const season = element('span', '', '—');
  season.id = 't28-season-hint';
  earth.append(declination, season);
  grid.append(moon, earth);
  const note = element('p', 't28-observation-note',
    '采用几何太阳方向与近似 J2000 自转轴；月相、季节方向仅供科普。日月食、地面日出日落不提供预报。');
  const source = element('a', 't28-source-link', 'IAU 姿态参考（USGS）');
  source.href = 'https://www.usgs.gov/media/files/report-iau-working-group';
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  section.append(header, status, grid, note, source);
  host.append(section);
  let painted = '';

  function render(info = universe.solar.getObservationInfo()) {
    if (!info?.enabled) {
      grid.hidden = true;
      status.textContent = '当前为科普演示轨道。请在上方启用 UTC 日期，读取地球昼夜与月相。';
      section.dataset.observationMode = 'demo';
      return;
    }
    grid.hidden = false;
    section.dataset.observationMode = 'date';
    status.textContent = new Date(info.utcMs).toISOString().slice(0, 16).replace('T', ' ') +
      ' UTC · DE441 几何位置';
    phaseName.textContent = info.moon.phaseName;
    illumination.textContent = '月面受光比例：' + (info.moon.illuminatedFraction * 100).toFixed(1) + '%';
    elongation.textContent = '日月角距：' + info.moon.elongationDeg.toFixed(1) + '°';
    const latitude = info.earth.subsolarLatitudeDeg;
    declination.textContent = Math.abs(latitude).toFixed(1) + '° ' +
      (Math.abs(latitude) < 0.05 ? '赤道附近' : latitude > 0 ? '北纬' : '南纬');
    season.textContent = info.earth.seasonHint;
    canvas.setAttribute('aria-label', info.moon.phaseName + '，月面受光 ' +
      (info.moon.illuminatedFraction * 100).toFixed(1) + '% 的示意圆盘');
    const phaseKey = Math.round(info.moon.illuminatedFraction * 1000) + ':' + info.moon.waxing;
    if (phaseKey !== painted) {
      paintPhase(canvas, info.moon.illuminatedFraction, info.moon.waxing);
      painted = phaseKey;
    }
  }
  render();
  return { render };
}
