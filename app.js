// Consola de negocios (white label). App estática: todo se guarda en el repo (tenants/<id>/) y en los
// secretos de GitHub; las acciones de nube (desplegar, compilar, secretos, alta) las hacen los workflows.
// La lógica de validación es la misma de la CLI: scripts/tenant/schema.js (window.TenantSchema).
import { GitHub, b64ToUtf8, utf8ToB64 } from './github.js';

const S = window.TenantSchema;
const CFG = window.CONSOLE_CONFIG || {};
const app = document.getElementById('app');

// ---------- utilidades de DOM (sin innerHTML con datos: todo se escapa) ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

function render(...nodes) {
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

function busy(btn, fn) {
  return async (...a) => {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Un momento…';
    try {
      await fn(...a);
    } catch (e) {
      toast(e.message);
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };
}

const safeColor = (c) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#999999');
const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);
const notice = (kind, ...c) => h('div', { class: `notice ${kind}` }, ...c);
const when = (iso) => (iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const runBadge = (r) =>
  !r ? badge('sin datos') : r.status !== 'completed' ? badge('en curso…', 'warn') : r.conclusion === 'success' ? badge('✔ bien', 'ok') : r.conclusion === 'cancelled' || r.conclusion === 'skipped' ? badge(r.conclusion === 'cancelled' ? 'cancelado' : 'omitido') : badge('✖ falló', 'danger');

// ---------- sesión ----------

let gh = null;
const TOKEN_KEY = 'consola.token';

function getToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(t) {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* modo privado */
  }
}

document.getElementById('logout').addEventListener('click', () => {
  setToken(null);
  gh = null;
  cache.clear();
  location.hash = '#/';
  route();
});

function loginView(error) {
  document.getElementById('nav').hidden = true;
  const token = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', id: 'token' });
  const repo = h('input', { type: 'text', value: CFG.repo || '', placeholder: 'usuario/repo' });
  const branch = h('input', { type: 'text', value: CFG.branch || 'master', placeholder: 'master' });
  const btn = h('button', {}, 'Entrar');
  btn.addEventListener(
    'click',
    busy(btn, async () => {
      if (!token.value.trim()) return toast('Pega tu token de GitHub.');
      const g = new GitHub(token.value.trim(), repo.value.trim(), branch.value.trim() || 'master');
      await g.repoInfo();
      gh = g;
      setToken(token.value.trim());
      try {
        sessionStorage.setItem('consola.repo', repo.value.trim());
        sessionStorage.setItem('consola.branch', branch.value.trim() || 'master');
      } catch {
        /* */
      }
      route();
    }),
  );
  render(
    h('h1', {}, 'Consola de negocios'),
    h('p', { class: 'muted' }, 'Administra las apps de cada negocio: marca, módulos, imágenes, secretos, despliegues y compilaciones.'),
    error ? notice('danger', error) : null,
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'field' }, h('label', { for: 'token' }, 'Token de GitHub'), token, h('small', {}, 'Se guarda solo en esta pestaña y se borra al cerrarla. Cómo crearlo: Guía → "Entrar a la consola".')),
      h('div', { class: 'field' }, h('label', {}, 'Repositorio'), repo),
      h('div', { class: 'field' }, h('label', {}, 'Rama'), branch, h('small', {}, 'Normalmente master. Otra rama sirve para probar sin afectar producción (los cambios se guardan ahí).')),
      btn,
    ),
  );
}

// ---------- datos ----------

const cache = new Map();

async function loadTenants(force = false) {
  if (!force && cache.has('tenants')) return cache.get('tenants');
  const dirs = (await gh.list('tenants')).filter((d) => d.type === 'dir');
  const list = await Promise.all(
    dirs.map(async (d) => {
      try {
        const { sha, text } = await gh.readText(`tenants/${d.name}/tenant.json`);
        return { id: d.name, sha, data: JSON.parse(text) };
      } catch (e) {
        return { id: d.name, error: e.message };
      }
    }),
  );
  cache.set('tenants', list);
  return list;
}

async function loadTenant(id) {
  const { sha, text } = await gh.readText(`tenants/${id}/tenant.json`);
  return { id, sha, data: JSON.parse(text) };
}

async function lastDeployByTenant() {
  try {
    const runs = await gh.runs('deploy.yml', 5);
    const out = {};
    for (const run of runs) {
      const jobs = await gh.jobs(run.id);
      for (const j of jobs) if (!out[j.name]) out[j.name] = { ...j, html_url: j.html_url || run.html_url, run };
    }
    return out;
  } catch {
    return {};
  }
}

// ---------- vistas ----------

async function homeView() {
  render(h('p', { class: 'muted' }, 'Cargando negocios…'));
  const [tenants, deploys] = await Promise.all([loadTenants(true), lastDeployByTenant()]);
  const cards = tenants.map((t) => {
    if (t.error) return h('div', { class: 'card' }, h('h3', {}, t.id), h('p', { class: 'err' }, t.error));
    const d = t.data;
    const v = S.validate(d, t.id);
    const dep = deploys[t.id];
    return h(
      'a',
      { class: 'card tenant-card', href: `#/t/${t.id}` },
      h('div', { class: 'row' }, h('span', { class: 'swatch', style: `background:${safeColor(d.brand?.primaryColor)}` }), h('h3', {}, d.app?.name || t.id)),
      h('div', { class: 'muted' }, `${d.app?.androidPackage || ''} · ${d.firebase?.projectId || ''}`),
      h(
        'div',
        { class: 'row', style: 'margin-top:8px' },
        badge(`v${d.app?.version} (${d.app?.versionCode})`),
        d.protected ? badge('protegido') : null,
        d.template ? badge('plantilla') : null,
        d.active === false ? badge('inactivo', 'warn') : null,
        v.ok ? null : badge(`${v.errors.length} errores`, 'danger'),
        d.template ? null : h('span', { class: 'muted', style: 'font-size:13px' }, 'Último despliegue: ', runBadge(dep)),
      ),
    );
  });
  render(
    h('div', { class: 'row spread' }, h('h1', {}, 'Negocios'), h('a', { class: 'button', href: '#/nuevo' }, '+ Nuevo negocio')),
    gh.testBranch
      ? notice('', `Modo prueba: rama "${gh.branch}". Los cambios se guardan en esa rama y no se despliegan; desplegar, compilar y secretos están desactivados.`)
      : h('p', { class: 'muted' }, `Repo ${gh.repo}. Cada cambio que guardes aquí se sube al repo y se despliega solo cuando pasen las pruebas.`),
    h('div', { class: 'grid' }, cards),
  );
}

const TABS = [
  ['general', 'Configuración'],
  ['imagenes', 'Imágenes'],
  ['secretos', 'Secretos'],
  ['desplegar', 'Desplegar'],
  ['compilar', 'Compilar'],
  ['peligro', 'Eliminar'],
];

async function tenantView(id, tab = 'general') {
  render(h('p', { class: 'muted' }, 'Cargando…'));
  const t = await loadTenant(id);
  const d = t.data;
  const header = h(
    'div',
    {},
    h('p', {}, h('a', { href: '#/' }, '← Negocios')),
    h('div', { class: 'row' }, h('span', { class: 'swatch', style: `background:${safeColor(d.brand?.primaryColor)}` }), h('h1', {}, d.app?.name || id), d.protected ? badge('protegido') : null, d.template ? badge('plantilla') : null),
    h('p', { class: 'muted' }, `${id} · ${d.app?.androidPackage} · ${d.firebase?.projectId}`),
    h(
      'nav',
      { class: 'tabs' },
      TABS.filter(([k]) => !(k === 'peligro' && d.protected)).map(([k, label]) => h('a', { href: `#/t/${id}/${k}`, class: k === tab ? 'active' : '' }, label)),
    ),
  );
  const body = await ({ general: configTab, imagenes: assetsTab, secretos: secretsTab, desplegar: deployTab, compilar: buildTab, peligro: dangerTab }[tab] || configTab)(t);
  render(header, body);
}

// ---------- Configuración (formulario generado del esquema) ----------

function fieldInput(section, field, value, disabled, onChange) {
  const id = `f-${section.key}-${field.key}`;
  let input;
  const common = { id, disabled };
  switch (field.type) {
    case 'bool':
      input = h('input', { ...common, type: 'checkbox', checked: value === true });
      input.addEventListener('change', () => onChange(input.checked));
      return h('label', { class: 'check' }, input, field.label, field.native ? badge('🔶 .aab', 'native') : null);
    case 'enum':
      input = h('select', common, field.options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
      input.addEventListener('change', () => onChange(input.value));
      break;
    case 'color': {
      const text = h('input', { ...common, type: 'text', value: value || '', style: 'max-width:140px' });
      const pick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000', disabled });
      pick.addEventListener('input', () => {
        text.value = pick.value.toUpperCase();
        onChange(text.value);
      });
      text.addEventListener('input', () => onChange(text.value.trim()));
      input = h('div', { class: 'row' }, pick, text);
      break;
    }
    case 'text':
      input = h('textarea', { ...common, rows: 3 }, value || '');
      input.addEventListener('input', () => onChange(input.value));
      break;
    case 'int':
      input = h('input', { ...common, type: 'number', min: 0, step: 1, value: value ?? '' });
      input.addEventListener('input', () => onChange(input.value === '' ? undefined : Number(input.value)));
      break;
    case 'list':
    case 'emails':
      input = h('input', { ...common, type: 'text', value: (value || []).join(', '), placeholder: 'separados por coma' });
      input.addEventListener('input', () => {
        const arr = input.value.split(',').map((s) => s.trim()).filter(Boolean);
        onChange(arr.length ? arr : undefined);
      });
      break;
    default:
      input = h('input', { ...common, type: field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : 'text', value: value ?? '', placeholder: field.example ? String(field.example) : '' });
      input.addEventListener('input', () => onChange(input.value.trim() === '' ? undefined : input.value.trim()));
  }
  return h(
    'div',
    { class: 'field' },
    h('label', { for: id }, field.label, field.required ? ' *' : '', ' ', field.native ? badge('🔶 .aab', 'native') : null, disabled ? badge('🔒 bloqueado') : null),
    input,
    field.help ? h('small', {}, field.help) : null,
    h('small', { class: 'err', 'data-err': `${section.key}.${field.key}` }),
  );
}

async function configTab(t) {
  const before = t.data;
  let draft = JSON.parse(JSON.stringify(before));
  const errBox = h('div');
  const nativeBox = h('div');
  const save = h('button', {}, 'Guardar cambios');

  const refresh = () => {
    const v = S.validate(draft, t.id);
    for (const el of app.querySelectorAll('[data-err]')) el.textContent = '';
    for (const e of v.errors) {
      const el = app.querySelector(`[data-err="${CSS.escape(e.path)}"]`);
      if (el) el.textContent = e.message;
    }
    errBox.replaceChildren(v.ok ? '' : notice('danger', `Hay ${v.errors.length} problema(s): ${v.errors.map((e) => e.path).join(', ')}`));
    const d = S.diff(before, draft);
    nativeBox.replaceChildren(
      d.native.length ? notice('', '🔶 Estos cambios van dentro de la app instalada y exigen un .aab nuevo: ', d.native.join(', '), '. Después de guardar, ve a Compilar.') : '',
    );
    save.disabled = !v.ok || !d.changed.length;
    save.textContent = d.changed.length ? `Guardar ${d.changed.length} cambio(s)` : 'Sin cambios';
  };

  const sections = S.SECTIONS.map((section) =>
    h(
      'fieldset',
      {},
      h('legend', {}, section.label),
      section.help ? h('p', { class: 'muted' }, section.help) : null,
      section.fields.map((field) =>
        fieldInput(section, field, draft[section.key]?.[field.key], !!(before.protected && field.locked), (val) => {
          draft = S.set(draft, `${section.key}.${field.key}`, val);
          refresh();
        }),
      ),
    ),
  );

  const flags = h(
    'fieldset',
    {},
    h('legend', {}, 'Estado'),
    (() => {
      const c = h('input', { type: 'checkbox', checked: draft.active !== false });
      c.addEventListener('change', () => {
        draft = S.set(draft, 'active', c.checked);
        refresh();
      });
      return h('label', { class: 'check' }, c, 'Activo (si lo apagas, deja de desplegarse; la app publicada sigue funcionando)');
    })(),
  );

  const seedArea = h('textarea', { rows: 10 }, JSON.stringify(draft.seed || {}, null, 2));
  const seedErr = h('small', { class: 'err' });
  seedArea.addEventListener('input', () => {
    try {
      draft = S.set(draft, 'seed', JSON.parse(seedArea.value));
      seedErr.textContent = '';
    } catch (e) {
      seedErr.textContent = `JSON inválido: ${e.message}`;
    }
    refresh();
  });
  const seed = h(
    'fieldset',
    {},
    h('legend', {}, 'Datos iniciales (avanzado)'),
    h('p', { class: 'muted' }, 'Servicios, personal e inventario que se cargan al dar de alta el negocio. Después se editan desde la app.'),
    seedArea,
    seedErr,
  );

  save.addEventListener(
    'click',
    busy(save, async () => {
      const d = S.diff(before, draft);
      if (d.lockedViolations.length) return toast(`Bloqueado: ${d.lockedViolations.join(', ')} romperían la app publicada.`);
      // Si el cambio va dentro de la app instalada, la versión se sube sola en este mismo guardado.
      const bump = S.autoBump(before, draft);
      const next = bump.tenant;
      const msg = `Consola: ${t.id} — ${d.changed.join(', ')}${bump.bumped ? ` (versión nativa ${next.app.versionCode})` : ''}`;
      await gh.commit(msg, [{ path: `tenants/${t.id}/tenant.json`, text: JSON.stringify(next, null, 2) + '\n' }], { expect: { path: `tenants/${t.id}/tenant.json`, sha: t.sha } });
      cache.clear();
      if (bump.bumped) await offerBuild(t.id, next, bump.reasons);
      else toast('Guardado. Se publica solo (web y app instalada) cuando pasen las pruebas.');
      tenantView(t.id, bump.bumped ? 'compilar' : 'general');
    }),
  );

  setTimeout(refresh);
  return h(
    'div',
    {},
    before.protected ? notice('info', 'Negocio protegido: lo que rompería la app ya publicada (paquete, proyectos, slug…) está bloqueado. Sus cuentas admin no se tocan desde aquí.') : null,
    sections,
    flags,
    seed,
    h('div', { class: 'sticky-save' }, save, errBox, nativeBox),
  );
}

/** Pistas de Google Play a las que se puede subir el .aab (como borrador). */
const PLAY_TRACKS = [
  ['no', 'Solo compilar (descargar aquí)'],
  ['production', 'Subir a Producción'],
  ['alpha', 'Subir a Prueba cerrada - Alpha'],
  ['internal', 'Subir a Prueba interna'],
  ['otra', 'Subir a otra pista…'],
];

/** Qué hacer con la compilación de iOS. */
const IOS_MODES = [
  ['no', 'Solo compilar'],
  ['testflight', 'Subir a TestFlight'],
  ['review', 'Subir y enviar a revisión de Apple (se publica al aprobarse)'],
];

/** Qué hace Google Play con la versión subida. */
const PLAY_MODES = [
  ['draft', 'Dejar como borrador (yo la envío a revisión)'],
  ['inProgress', 'Enviar a revisión y lanzar al 20% al aprobarse (recomendado)'],
  ['completed', 'Enviar a revisión y publicar a todos al aprobarse'],
];

/** Tras un cambio nativo: la versión ya se subió; se ofrece compilar el .aab en ese momento. */
async function offerBuild(id, next, reasons) {
  const what = reasons.length ? ` (${reasons.join(', ')})` : '';
  const go = confirm(
    `Este cambio va dentro de la app instalada${what}, así que se subió a la versión ${next.app.versionCode}.\n\n` +
      '¿Compilar el .aab ahora? (tarda ~20-35 min; lo descargas en la pestaña Compilar y lo subes a Play).',
  );
  if (!go) return toast(`Versión ${next.app.versionCode} guardada. Compila el .aab cuando quieras en la pestaña Compilar.`);
  try {
    await gh.dispatch('build-android.yml', { tenant: id });
    toast('Compilación iniciada. El .aab aparecerá en la pestaña Compilar.');
  } catch (e) {
    toast(e.message);
  }
}

// ---------- Imágenes ----------

function pngSize(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('No es una imagen válida'));
    img.src = URL.createObjectURL(file);
  });
}

const fileToB64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

async function assetsTab(t) {
  const cards = S.ASSETS.map((a) => {
    const img = h('img', { alt: a.label, loading: 'lazy' });
    // Vista previa: el ícono monocromo es blanco, se muestra sobre fondo oscuro.
    const preview = h('div', { class: `asset-preview${a.key === 'adaptiveMonochrome' ? ' dark' : ''}` }, img);
    gh.readBlobUrl(`tenants/${t.id}/${a.path}`)
      .then((u) => (img.src = u))
      .catch(() => preview.replaceChildren(h('span', { class: 'muted' }, 'Sin imagen')));
    // Botón propio en lugar del selector de archivo del navegador (su texto descuadraba la tarjeta).
    const input = h('input', { type: 'file', accept: 'image/png', class: 'visually-hidden' });
    const pick = h('label', { class: 'button secondary' }, 'Cambiar imagen…', input);
    const msg = h('small', { class: 'muted' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.type !== 'image/png') return (msg.textContent = 'Debe ser PNG.');
      try {
        const s = await pngSize(file);
        if (a.size && (s.width !== a.size[0] || s.height !== a.size[1]) && !confirm(`Mide ${s.width}×${s.height}; se recomienda ${a.size[0]}×${a.size[1]}. ¿Subirla de todos modos?`)) return;
        msg.textContent = 'Subiendo…';
        const files = [{ path: `tenants/${t.id}/${a.path}`, base64: await fileToB64(file) }];
        let bumped = null;
        if (a.native) {
          // La imagen va dentro de la app: se sube la versión en el mismo guardado (sobre el tenant.json más reciente).
          const latest = await gh.readText(`tenants/${t.id}/tenant.json`);
          const current = JSON.parse(latest.text);
          const b = S.autoBump(current, current, true);
          if (b.bumped) {
            bumped = b.tenant;
            files.push({ path: `tenants/${t.id}/tenant.json`, text: JSON.stringify(b.tenant, null, 2) + '\n' });
          }
          await gh.commit(`Consola: ${t.id} — imagen ${a.key}${bumped ? ` (versión nativa ${bumped.app.versionCode})` : ''}`, files, { expect: { path: `tenants/${t.id}/tenant.json`, sha: latest.sha } });
        } else {
          await gh.commit(`Consola: ${t.id} — imagen ${a.key}`, files);
        }
        img.src = URL.createObjectURL(file);
        msg.textContent = 'Listo.';
        cache.clear();
        if (bumped) await offerBuild(t.id, bumped, [a.label]);
      } catch (e) {
        msg.textContent = e.message;
      }
    });
    return h(
      'div',
      { class: 'card asset' },
      preview,
      h('h3', {}, a.label),
      h('div', { class: 'row asset-meta' }, h('span', { class: 'muted' }, a.size ? `${a.size[0]}×${a.size[1]} PNG` : 'PNG'), a.native ? badge('🔶 .aab', 'native') : null),
      pick,
      msg,
    );
  });
  return h('div', {}, h('p', { class: 'muted' }, 'El logo y el ícono de la web también se pueden cambiar desde la app (Más → Configuración → Identidad) sin compilar.'), h('div', { class: 'assets' }, cards));
}

// ---------- Secretos ----------

async function secretsTab(t) {
  const d = t.data;
  const [envNames, repoNames] = await Promise.all([gh.envSecrets(t.id), d.protected ? gh.repoSecrets() : Promise.resolve([])]);
  const rows = S.SECRETS.filter((s) => !(s.feature && d.features?.[s.feature] === false)).map((s) => {
    const inEnv = envNames.includes(s.name);
    const inRepo = repoNames.includes(s.name);
    const status =
      s.target === 'firebase'
        ? badge(inEnv ? 'guardado en GitHub' : 'en Firebase o sin configurar', inEnv ? 'ok' : '')
        : inEnv
          ? badge('✔ guardado', 'ok')
          : inRepo
            ? badge('✔ del repositorio', 'ok')
            : badge('falta', 'warn');
    const isFile = /SERVICE_ACCOUNT|CREDENTIALS|KEYSTORE_BASE64/.test(s.name);
    const value = isFile ? h('input', { type: 'file' }) : h('input', { type: 'password', placeholder: 'Pega el valor (no se mostrará)', autocomplete: 'off' });
    const btn = h('button', { class: 'secondary' }, 'Guardar');
    btn.addEventListener(
      'click',
      busy(btn, async () => {
        let v;
        if (isFile) {
          const f = value.files?.[0];
          if (!f) return toast('Elige el archivo.');
          v = s.name === 'ANDROID_KEYSTORE_BASE64' ? await fileToB64(f) : await f.text();
          if (s.name === 'FIREBASE_SERVICE_ACCOUNT') {
            let pid;
            try {
              pid = JSON.parse(v).project_id;
            } catch {
              return toast('El archivo no es un JSON de cuenta de servicio.');
            }
            if (pid !== d.firebase.projectId) return toast(`Esa cuenta es del proyecto ${pid}, no de ${d.firebase.projectId}.`);
          }
        } else v = value.value;
        if (!v) return toast('Escribe el valor.');
        await gh.setEnvSecret(t.id, s.name, v);
        value.value = '';
        if (s.target === 'firebase') {
          await gh.dispatch('tenant-secrets.yml', { tenant: t.id, name: s.name, deploy: 'true' });
          toast(`${s.name} guardado. Se está copiando a Firebase y redesplegando (pestaña Desplegar).`);
        } else toast(`${s.name} guardado.`);
        tenantView(t.id, 'secretos');
      }),
    );
    return h('tr', {}, h('td', {}, h('strong', {}, s.name), h('div', { class: 'muted', style: 'font-size:13px' }, s.label)), h('td', {}, status), h('td', {}, h('div', { class: 'row' }, value, btn)));
  });
  return h(
    'div',
    {},
    notice('info', 'Los valores se cifran en tu navegador antes de enviarse y nadie los puede volver a ver, ni GitHub. Para cambiar uno, vuelve a guardarlo.'),
    d.protected ? notice('', 'PeachGlow usa los secretos del repositorio de siempre; lo que guardes aquí (Environment) tiene prioridad.') : null,
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Secreto'), h('th', {}, 'Estado'), h('th', {}, 'Nuevo valor'))), h('tbody', {}, rows)),
    h('h2', {}, 'Mercado Pago'),
    h(
      'ol',
      { class: 'steps' },
      h('li', {}, 'En mercadopago.com.mx/developers → Tus integraciones → la app del negocio → Credenciales de producción, copia el Access token y guárdalo arriba (MP_ACCESS_TOKEN).'),
      h('li', {}, 'En Webhooks → Modo productivo registra la URL ', h('code', {}, `https://${d.firebase.region}-${d.firebase.projectId}.cloudfunctions.net/mercadoPagoWebhook`), ' con el evento Pagos.'),
      h('li', {}, 'Copia la "clave secreta" que muestra y guárdala arriba (MP_WEBHOOK_SECRET).'),
    ),
  );
}

// ---------- Desplegar ----------

async function runsTable(workflow, filter) {
  let runs = [];
  try {
    runs = await gh.runs(workflow, 15);
  } catch (e) {
    return h('p', { class: 'err' }, e.message);
  }
  if (filter) runs = runs.filter(filter);
  if (!runs.length) return h('p', { class: 'muted' }, 'Sin corridas todavía.');
  return h(
    'table',
    {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Cuándo'), h('th', {}, 'Qué'), h('th', {}, 'Estado'), h('th', {}, ''))),
    h(
      'tbody',
      {},
      runs.slice(0, 10).map((r) =>
        h('tr', {}, h('td', {}, when(r.created_at)), h('td', {}, r.display_title || r.name), h('td', {}, runBadge(r)), h('td', {}, h('a', { href: r.html_url, target: '_blank', rel: 'noopener' }, 'ver detalle'))),
      ),
    ),
  );
}

async function deployTab(t) {
  const buttons = [
    ['todo', 'Desplegar todo'],
    ['web', 'Solo web'],
    ['functions', 'Solo functions'],
    ['rules', 'Solo reglas'],
    ['app', 'Solo actualización de la app'],
  ].map(([what, label]) => {
    const b = h('button', { class: what === 'todo' ? '' : 'secondary' }, label);
    b.addEventListener(
      'click',
      busy(b, async () => {
        if (!confirm(`¿${label} de ${t.data.app.name} en producción?`)) return;
        await gh.dispatch('deploy.yml', { tenant: t.id, what, all: 'true' });
        toast('Despliegue iniciado. Aparece abajo en unos segundos.');
        setTimeout(() => tenantView(t.id, 'desplegar'), 4000);
      }),
    );
    return b;
  });
  const provision = h('button', { class: 'secondary' }, 'Preparar proyecto en la nube (alta)');
  provision.addEventListener(
    'click',
    busy(provision, async () => {
      if (!confirm('Esto activa Firebase, crea las apps, despliega todo y carga los datos iniciales. Necesita la cuenta de servicio en Secretos. ¿Continuar?')) return;
      await gh.dispatch('tenant-provision.yml', { tenant: t.id, seed: 'true' });
      toast('Alta iniciada (tarda unos 10 minutos).');
    }),
  );
  return h(
    'div',
    {},
    t.data.template ? notice('', 'La plantilla no se despliega: es solo la base para negocios nuevos.') : null,
    h('p', { class: 'muted' }, 'Cada vez que guardas un cambio se despliega solo, después de que pasan las pruebas. Usa estos botones para desplegar a mano.'),
    h('div', { class: 'row' }, buttons),
    t.data.protected ? null : h('div', { class: 'card' }, h('h3', {}, 'Negocio nuevo'), h('p', { class: 'muted' }, 'Una sola vez, después de crear su proyecto en Firebase y guardar su cuenta de servicio en Secretos.'), provision),
    h('h2', {}, 'Despliegues recientes'),
    await runsTable('deploy.yml'),
    h('h2', {}, 'Secretos copiados a Firebase'),
    await runsTable('tenant-secrets.yml'),
    t.data.protected ? null : h('h2', {}, 'Altas'),
    t.data.protected ? null : await runsTable('tenant-provision.yml'),
  );
}

// ---------- Compilar ----------

async function buildTab(t) {
  const d = t.data;
  const bump = (native) => {
    const b = h('button', { class: 'secondary' }, native ? `Nueva versión nativa (versionCode ${d.app.versionCode + 1}, runtime ${d.app.versionCode + 1})` : `Subir versionCode a ${d.app.versionCode + 1}`);
    b.addEventListener(
      'click',
      busy(b, async () => {
        let next = S.set(d, 'app.versionCode', d.app.versionCode + 1);
        if (native) next = S.set(next, 'app.runtimeVersion', String(d.app.versionCode + 1));
        await gh.commit(`Consola: ${t.id} — versionCode ${d.app.versionCode + 1}${native ? ' (runtime nuevo)' : ''}`, [{ path: `tenants/${t.id}/tenant.json`, text: JSON.stringify(next, null, 2) + '\n' }], { expect: { path: `tenants/${t.id}/tenant.json`, sha: t.sha } });
        toast('Versión actualizada.');
        tenantView(t.id, 'compilar');
      }),
    );
    return b;
  };
  // A dónde se sube el .aab al terminar (siempre como borrador: alguien da "Enviar a revisión" en Play Console).
  const track = h(
    'select',
    {},
    PLAY_TRACKS.map(([value, label]) => h('option', { value }, label)),
  );
  const customTrack = h('input', { type: 'text', placeholder: 'nombre de la pista (ej. BetaGamma)', style: 'display:none;max-width:260px' });
  const publish = h('select', {}, PLAY_MODES.map(([value, label]) => h('option', { value }, label)));
  const notes = h('textarea', { rows: 3, maxlength: 500, placeholder: 'Novedades de esta versión (opcional, máx. 500). Ej.: Mejoras de compatibilidad y opción para eliminar tu cuenta.' });
  const playOpts = h('div', { style: 'display:none' }, h('div', { class: 'field' }, h('label', {}, 'En Google Play'), publish), h('div', { class: 'field' }, h('label', {}, 'Notas de la versión'), notes));
  track.addEventListener('change', () => {
    customTrack.style.display = track.value === 'otra' ? '' : 'none';
    playOpts.style.display = track.value === 'no' ? 'none' : '';
  });
  const android = h('button', {}, 'Compilar .aab (Android)');
  android.addEventListener(
    'click',
    busy(android, async () => {
      const dest = track.value === 'otra' ? customTrack.value.trim() : track.value;
      if (track.value === 'otra' && !/^[A-Za-z0-9_-]{1,50}$/.test(dest)) return toast('Escribe el nombre de la pista tal como aparece en Play Console.');
      const mode = publish.selectedOptions[0].textContent;
      const where = dest === 'no' ? 'Solo se compila (lo descargas aquí).' : `Al terminar se sube a Google Play → pista ${dest}: ${mode}.`;
      if (!confirm(`¿Compilar ${d.app.name} ${d.app.version} (${d.app.versionCode})? Tarda ~20-35 minutos.\n${where}`)) return;
      await gh.dispatch('build-android.yml', { tenant: t.id, track: dest, publish: publish.value, notes: notes.value.trim() });
      toast(dest === 'no' ? 'Compilación iniciada. El .aab aparece abajo al terminar.' : `Compilación iniciada. Al terminar: ${mode}.`);
    }),
  );
  // iOS (preparado; se activa cuando el negocio tenga cuenta de Apple Developer y sus llaves en Secretos).
  const iosSubmit = h('select', {}, IOS_MODES.map(([value, label]) => h('option', { value }, label)));
  const iosPhased = h('input', { type: 'checkbox', checked: true });
  const iosNotes = h('textarea', { rows: 2, maxlength: 4000, placeholder: 'Novedades de esta versión (opcional)' });
  const iosReady = !!(d.integrations?.ascAppId && d.integrations?.appleTeamId);
  const ios = h('button', { class: 'secondary' }, 'Compilar iOS');
  ios.addEventListener(
    'click',
    busy(ios, async () => {
      if (!iosReady && iosSubmit.value !== 'no') return toast('Faltan los datos de Apple: Configuración → Integraciones (Team ID y Apple ID de la app) y las llaves en Secretos. Ver la guía → iOS.');
      const mode = iosSubmit.selectedOptions[0].textContent;
      if (!confirm(`¿Compilar ${d.app.name} ${d.app.version} (${d.app.versionCode}) para iOS en la nube de Expo? Tarda ~20-40 min.\n${mode}.`)) return;
      await gh.dispatch('build-ios.yml', { tenant: t.id, submit: iosSubmit.value, phased: String(iosPhased.checked), notes: iosNotes.value.trim() });
      toast(`Compilación de iOS iniciada. ${mode}.`);
    }),
  );
  const iosBox = h(
    'div',
    { class: 'card' },
    h('h3', {}, 'iOS (App Store)'),
    iosReady
      ? h('p', { class: 'muted' }, 'Se compila en la nube de Expo (no hace falta Mac) y, si eliges, se sube a TestFlight y se envía a revisión de Apple.')
      : notice('', 'Preparado, pero todavía sin cuenta de Apple Developer para este negocio. Cuando la tengas, llena Configuración → Integraciones (Apple Team ID y Apple ID de la app) y guarda las 3 llaves de Apple en Secretos. Pasos en la guía → iOS.'),
    h('div', { class: 'field' }, h('label', {}, 'Después de compilar'), iosSubmit),
    h('label', { class: 'check' }, iosPhased, 'Al enviar a revisión: publicación escalonada de 7 días'),
    h('div', { class: 'field' }, h('label', {}, 'Notas de la versión'), iosNotes),
    h('div', { class: 'row' }, ios),
  );
  let builds = [];
  try {
    builds = (await gh.runs('build-android.yml', 15)).filter((r) => r.status === 'completed' && r.conclusion === 'success');
  } catch {
    /* sin corridas */
  }
  const artifacts = h('div', {}, h('p', { class: 'muted' }, 'Buscando .aab…'));
  (async () => {
    const items = [];
    for (const r of builds.slice(0, 6)) {
      for (const a of await gh.artifacts(r.id)) if (a.name === `aab-${t.id}` && !a.expired) items.push(h('li', {}, h('a', { href: r.html_url, target: '_blank', rel: 'noopener' }, `${a.name} · ${when(r.created_at)}`), ' (descárgalo desde la página de la corrida, sección Artifacts)'));
    }
    artifacts.replaceChildren(items.length ? h('ul', {}, items) : h('p', { class: 'muted' }, 'Todavía no hay .aab compilados de este negocio.'));
  })();
  return h(
    'div',
    {},
    h('div', { class: 'card' }, h('h3', {}, 'Versión actual'), h('p', {}, `${d.app.version} · versionCode ${d.app.versionCode} · runtimeVersion ${d.app.runtimeVersion}`), h('p', { class: 'muted' }, 'Al guardar un cambio marcado 🔶 o subir una imagen de la app, la versión se sube sola y se te ofrece compilar. Usa estos botones solo para casos especiales (por ejemplo, librerías nativas nuevas en el código).'), h('div', { class: 'row' }, bump(false), bump(true))),
    h('div', { class: 'field' }, h('label', {}, 'Al terminar de compilar'), h('div', { class: 'row' }, track, customTrack)),
    playOpts,
    h('div', { class: 'row' }, android),
    iosBox,
    notice('info', 'Si eliges una pista, el .aab se sube solo a Play Console: como borrador, o enviado a revisión para que se publique al aprobarse (con lanzamiento al 20% si eliges esa opción; después lo subes al 100% en Play Console). La primera versión de una app nueva se sube a mano.'),
    h('h2', {}, '.aab listos'),
    artifacts,
    h('h2', {}, 'Compilaciones recientes'),
    await runsTable('build-android.yml'),
  );
}

// ---------- Eliminar ----------

async function dangerTab(t) {
  const d = t.data;
  if (d.protected) return notice('danger', 'Este negocio está protegido y no se puede eliminar.');
  const deactivate = h('button', { class: 'secondary' }, d.active === false ? 'Reactivar' : 'Desactivar (dejar de desplegar)');
  deactivate.addEventListener(
    'click',
    busy(deactivate, async () => {
      const next = S.set(d, 'active', d.active === false);
      await gh.commit(`Consola: ${t.id} — ${next.active ? 'reactivado' : 'desactivado'}`, [{ path: `tenants/${t.id}/tenant.json`, text: JSON.stringify(next, null, 2) + '\n' }], { expect: { path: `tenants/${t.id}/tenant.json`, sha: t.sha } });
      toast('Listo.');
      tenantView(t.id, 'peligro');
    }),
  );
  const typed = h('input', { type: 'text', placeholder: t.id });
  const env = h('input', { type: 'checkbox' });
  const del = h('button', { class: 'danger' }, 'Eliminar del repo');
  del.addEventListener(
    'click',
    busy(del, async () => {
      if (typed.value !== t.id) return toast(`Escribe "${t.id}" para confirmar.`);
      const easFile = await gh.readText('eas.json').catch(() => null);
      const files = [];
      if (easFile) {
        const eas = JSON.parse(easFile.text);
        if (eas.build?.[t.id]) {
          delete eas.build[t.id];
          files.push({ path: 'eas.json', text: JSON.stringify(eas, null, 2) + '\n' });
        }
      }
      await gh.commit(`Consola: eliminar ${t.id}`, files, { deletePrefix: `tenants/${t.id}/` });
      if (env.checked) await gh.deleteEnvironment(t.id).catch(() => null);
      cache.clear();
      toast(`${t.id} eliminado del repo.`);
      location.hash = '#/';
    }),
  );
  return h(
    'div',
    {},
    h('div', { class: 'card' }, h('h3', {}, 'Desactivar'), h('p', { class: 'muted' }, 'Deja de desplegarse, pero se conserva todo. La app publicada sigue funcionando.'), deactivate),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Eliminar'),
      notice('danger', 'Borra la carpeta del negocio del repo. NO borra su proyecto de Firebase, ni EAS, ni la app en Play: eso se hace a mano (ver la guía).'),
      h('div', { class: 'field' }, h('label', {}, `Escribe "${t.id}" para confirmar`), typed),
      h('label', { class: 'check' }, env, 'Borrar también su Environment y secretos en GitHub'),
      del,
    ),
  );
}

// ---------- Nuevo negocio ----------

function circlePng(w, hgt, color, bg, ratio) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const x = c.getContext('2d');
  if (bg) {
    x.fillStyle = bg;
    x.fillRect(0, 0, w, hgt);
  }
  if (ratio) {
    x.fillStyle = color;
    x.beginPath();
    x.arc(w / 2, hgt / 2, Math.min(w, hgt) * ratio, 0, Math.PI * 2);
    x.fill();
  }
  return c.toDataURL('image/png').split(',')[1];
}

function placeholderAssets(t) {
  const c = t.brand.primaryColor;
  const bg = t.brand.backgroundColor;
  return {
    'assets/icon.png': circlePng(1024, 1024, c, bg, 0.32),
    'assets/android-icon-foreground.png': circlePng(1024, 1024, c, null, 0.22),
    'assets/android-icon-background.png': circlePng(1024, 1024, null, t.brand.adaptiveIconBackground, 0),
    'assets/android-icon-monochrome.png': circlePng(1024, 1024, '#FFFFFF', null, 0.22),
    'assets/favicon.png': circlePng(48, 48, c, bg, 0.4),
    'assets/splash-icon.png': circlePng(512, 512, c, null, 0.4),
    'assets/brand/logo.png': circlePng(512, 512, c, null, 0.45),
    'assets/brand/logo-symbol.png': circlePng(512, 512, c, null, 0.45),
    'assets/brand/play-icon-512.png': circlePng(512, 512, c, bg, 0.32),
    'assets/brand/play-feature-graphic.png': circlePng(1024, 500, null, c, 0),
    'public/wallet/logo.png': circlePng(660, 660, c, null, 0.45),
  };
}

async function newView() {
  const tenants = await loadTenants();
  const ids = new Set(tenants.map((t) => t.id));
  const f = {
    id: h('input', { type: 'text', placeholder: 'nails-ana' }),
    name: h('input', { type: 'text', placeholder: 'Nails by Ana', maxlength: 30 }),
    industry: h('select', {}, S.INDUSTRIES.map((i) => h('option', { value: i.value }, i.label))),
    color: h('input', { type: 'color', value: '#7A5CFA' }),
    pkg: h('input', { type: 'text', placeholder: 'com.nailsbyana.app' }),
    project: h('input', { type: 'text', placeholder: 'nails-ana-prod' }),
    email: h('input', { type: 'email', placeholder: 'soporte@negocio.com' }),
    admins: h('input', { type: 'text', placeholder: 'dueña@gmail.com' }),
  };
  const feats = S.FEATURES.map((m) => {
    const c = h('input', { type: 'checkbox', checked: m.key !== 'ads', value: m.key });
    return { key: m.key, el: h('label', { class: 'check' }, c, m.label), c };
  });
  f.id.addEventListener('input', () => {
    const slug = f.id.value.replace(/-/g, '');
    f.pkg.placeholder = `com.${slug || 'negocio'}.app`;
    f.project.placeholder = `${f.id.value || 'negocio'}-prod`;
  });
  const out = h('div');
  const btn = h('button', {}, 'Crear negocio');
  btn.addEventListener(
    'click',
    busy(btn, async () => {
      const id = f.id.value.trim();
      if (!S.ID_PATTERN.test(id)) return toast('El id va en minúsculas, con números o guiones (ej. nails-ana).');
      if (ids.has(id)) return toast(`Ya existe ${id}.`);
      const t = S.buildNew(id, {
        name: f.name.value.trim() || id,
        industry: f.industry.value,
        primaryColor: f.color.value.toUpperCase(),
        androidPackage: f.pkg.value.trim() || undefined,
        projectId: f.project.value.trim() || undefined,
        supportEmail: f.email.value.trim() || undefined,
        adminEmails: f.admins.value.split(',').map((s) => s.trim()).filter(Boolean),
        features: feats.filter((x) => x.c.checked).map((x) => x.key),
      });
      const v = S.validate(t, id);
      if (!v.ok) return out.replaceChildren(notice('danger', v.errors.map((e) => `${e.path}: ${e.message}`).join(' · ')));
      for (const other of tenants.filter((x) => x.data)) {
        if (other.data.app?.androidPackage === t.app.androidPackage) return toast(`El paquete ${t.app.androidPackage} ya lo usa ${other.id}.`);
        if (other.data.firebase?.projectId === t.firebase.projectId) return toast(`El proyecto ${t.firebase.projectId} ya lo usa ${other.id}.`);
      }
      const files = [{ path: `tenants/${id}/tenant.json`, text: JSON.stringify(t, null, 2) + '\n' }];
      for (const [p, b64] of Object.entries(placeholderAssets(t))) files.push({ path: `tenants/${id}/${p}`, base64: b64 });
      files.push({ path: `tenants/${id}/google-services.json`, text: JSON.stringify(S.placeholderGoogleServices(t), null, 2) + '\n' });
      const easFile = await gh.readText('eas.json').catch(() => null);
      const eas = easFile ? JSON.parse(easFile.text) : { cli: { version: '>= 16.0.0', appVersionSource: 'local' }, build: {} };
      eas.build = { ...eas.build, [id]: { distribution: 'store', env: { TENANT: id }, android: { buildType: 'app-bundle' }, ios: {} } };
      files.push({ path: 'eas.json', text: JSON.stringify(eas, null, 2) + '\n' });
      await gh.commit(`Consola: alta de ${id} (${t.app.name})`, files);
      await gh.ensureEnvironment(id).catch(() => null);
      cache.clear();
      toast(`${t.app.name} creado.`);
      location.hash = `#/t/${id}/general`;
    }),
  );
  render(
    h('p', {}, h('a', { href: '#/' }, '← Negocios')),
    h('h1', {}, 'Nuevo negocio'),
    h('p', { class: 'muted' }, 'Crea la configuración con imágenes de relleno. Después: crea su proyecto en Firebase, guarda su cuenta de servicio en Secretos y usa "Preparar proyecto en la nube".'),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Datos'),
      h('div', { class: 'field' }, h('label', {}, 'Id interno *'), f.id, h('small', {}, 'Minúsculas y guiones. No se puede cambiar después de publicar.')),
      h('div', { class: 'field' }, h('label', {}, 'Nombre de la app *'), f.name),
      h('div', { class: 'field' }, h('label', {}, 'Rubro'), f.industry),
      h('div', { class: 'field' }, h('label', {}, 'Color principal'), f.color),
      h('div', { class: 'field' }, h('label', {}, 'Paquete Android'), f.pkg, h('small', {}, 'Nunca se puede cambiar después de publicar en Play.')),
      h('div', { class: 'field' }, h('label', {}, 'Project ID de Firebase'), f.project),
      h('div', { class: 'field' }, h('label', {}, 'Correo de soporte'), f.email),
      h('div', { class: 'field' }, h('label', {}, 'Correo(s) de la primera admin'), f.admins, h('small', {}, 'Solo para el alta. Después las cuentas se administran desde la app del negocio.')),
    ),
    h('fieldset', {}, h('legend', {}, 'Módulos incluidos en su plan'), feats.map((x) => x.el)),
    out,
    btn,
  );
}

// ---------- router ----------

async function route() {
  const token = getToken();
  document.getElementById('nav').hidden = !token;
  if (!token) return loginView();
  if (!gh) {
    let repo = CFG.repo;
    let branch = CFG.branch || 'master';
    try {
      repo = sessionStorage.getItem('consola.repo') || repo;
      branch = sessionStorage.getItem('consola.branch') || branch;
    } catch {
      /* */
    }
    gh = new GitHub(token, repo, branch);
  }
  const [, view, id, tab] = (location.hash || '#/').slice(1).split('/');
  try {
    if (view === 't' && id) await tenantView(id, tab);
    else if (view === 'nuevo') await newView();
    else await homeView();
  } catch (e) {
    if (e.status === 401) {
      setToken(null);
      gh = null;
      return loginView(e.message);
    }
    render(notice('danger', e.message), h('p', {}, h('a', { href: '#/' }, 'Volver')));
  }
}

window.addEventListener('hashchange', route);
if (!S) render(notice('danger', 'No se cargó schema.js.'));
else route();

// Para pruebas
export { b64ToUtf8, utf8ToB64 };
