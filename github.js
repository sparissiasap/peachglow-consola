// Cliente mínimo de la API de GitHub para la consola. Todo pasa con el token de quien entra:
// la consola no tiene servidor ni guarda datos propios.
const API = 'https://api.github.com';

export class GitHub {
  constructor(token, repo, branch = 'master') {
    this.token = token;
    this.repo = repo;
    this.branch = branch;
    /** En una rama de prueba solo se guardan archivos: nada de despliegues, compilaciones ni secretos reales. */
    this.testBranch = branch !== 'master';
  }

  guardCloud() {
    if (this.testBranch) throw new Error(`Estás en la rama de prueba "${this.branch}": aquí no se despliega, no se compila ni se guardan secretos (afectarían producción).`);
  }

  async req(path, { method = 'GET', body, accept = 'application/vnd.github+json', raw = false } = {}) {
    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      method,
      headers: {
        Accept: accept,
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json()).message || '';
      } catch {
        /* sin cuerpo */
      }
      const err = new Error(explain(res.status, detail));
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    if (raw) return res;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  r(path) {
    return `/repos/${this.repo}${path}`;
  }

  user() {
    return this.req('/user');
  }

  repoInfo() {
    return this.req(this.r(''));
  }

  // ---------- archivos ----------

  async list(dir) {
    return this.req(this.r(`/contents/${encodePath(dir)}?ref=${this.branch}`));
  }

  async readText(path) {
    const f = await this.req(this.r(`/contents/${encodePath(path)}?ref=${this.branch}`));
    return { sha: f.sha, text: b64ToUtf8(f.content) };
  }

  async readBlobUrl(path) {
    const res = await this.req(this.r(`/contents/${encodePath(path)}?ref=${this.branch}`), { accept: 'application/vnd.github.raw', raw: true });
    return URL.createObjectURL(await res.blob());
  }

  /**
   * Un commit con varios archivos (crear, cambiar o borrar). files: [{ path, text } | { path, base64 } | { path, delete: true }]
   * `deletePrefix` borra todo lo que esté bajo esa carpeta.
   */
  async commit(message, files, { deletePrefix, expect } = {}) {
    // expect = { path, sha }: si el archivo cambió desde que se abrió (otro commit, un workflow), no se pisa.
    if (expect) {
      const now = await this.req(this.r(`/contents/${encodePath(expect.path)}?ref=${this.branch}`));
      if (now.sha !== expect.sha) {
        const err = new Error('Alguien más cambió este negocio mientras lo editabas (otra persona o un workflow). Recarga la página y vuelve a hacer tu cambio.');
        err.status = 409;
        throw err;
      }
    }
    const ref = await this.req(this.r(`/git/ref/heads/${this.branch}`));
    const head = ref.object.sha;
    const headCommit = await this.req(this.r(`/git/commits/${head}`));
    const tree = [];
    for (const f of files) {
      if (f.delete) {
        tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
        continue;
      }
      const blob = await this.req(this.r('/git/blobs'), {
        method: 'POST',
        body: f.base64 !== undefined ? { content: f.base64, encoding: 'base64' } : { content: f.text, encoding: 'utf-8' },
      });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    if (deletePrefix) {
      const all = await this.req(this.r(`/git/trees/${headCommit.tree.sha}?recursive=1`));
      for (const item of all.tree) if (item.type === 'blob' && item.path.startsWith(deletePrefix)) tree.push({ path: item.path, mode: item.mode, type: 'blob', sha: null });
    }
    const newTree = await this.req(this.r('/git/trees'), { method: 'POST', body: { base_tree: headCommit.tree.sha, tree } });
    const c = await this.req(this.r('/git/commits'), { method: 'POST', body: { message, tree: newTree.sha, parents: [head] } });
    await this.req(this.r(`/git/refs/heads/${this.branch}`), { method: 'PATCH', body: { sha: c.sha } });
    return c;
  }

  // ---------- Actions ----------

  dispatch(workflow, inputs) {
    this.guardCloud();
    return this.req(this.r(`/actions/workflows/${workflow}/dispatches`), { method: 'POST', body: { ref: this.branch, inputs } });
  }

  runs(workflow, perPage = 10) {
    return this.req(this.r(`/actions/workflows/${workflow}/runs?per_page=${perPage}`)).then((r) => r.workflow_runs);
  }

  jobs(runId) {
    return this.req(this.r(`/actions/runs/${runId}/jobs?per_page=50`)).then((r) => r.jobs);
  }

  artifacts(runId) {
    return this.req(this.r(`/actions/runs/${runId}/artifacts`)).then((r) => r.artifacts);
  }

  // ---------- Environments y secretos ----------

  /**
   * Crea (o actualiza) el Environment del negocio y lo limita a la rama master: sus secretos (cuentas de servicio,
   * keystore) solo los puede leer un workflow que corre sobre master, no uno lanzado desde otra rama.
   */
  async ensureEnvironment(name) {
    if (this.testBranch) return null;
    const base = this.r(`/environments/${encodeURIComponent(name)}`);
    const env = await this.req(base, {
      method: 'PUT',
      body: { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } },
    });
    try {
      await this.req(`${base}/deployment-branch-policies`, { method: 'POST', body: { name: 'master', type: 'branch' } });
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e; // ya existía
    }
    return env;
  }

  deleteEnvironment(name) {
    this.guardCloud();
    return this.req(this.r(`/environments/${encodeURIComponent(name)}`), { method: 'DELETE' });
  }

  async envSecrets(name) {
    try {
      return (await this.req(this.r(`/environments/${encodeURIComponent(name)}/secrets?per_page=100`))).secrets.map((s) => s.name);
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  }

  async repoSecrets() {
    try {
      return (await this.req(this.r('/actions/secrets?per_page=100'))).secrets.map((s) => s.name);
    } catch {
      return [];
    }
  }

  /** Cifra el valor en el navegador (sealed box de libsodium) y lo guarda en el Environment. */
  async setEnvSecret(env, name, value) {
    this.guardCloud();
    const sodium = await loadSodium();
    await this.ensureEnvironment(env);
    const key = await this.req(this.r(`/environments/${encodeURIComponent(env)}/secrets/public-key`));
    const b64 = sodium.base64_variants.ORIGINAL;
    const sealed = sodium.crypto_box_seal(sodium.from_string(value), sodium.from_base64(key.key, b64));
    await this.req(this.r(`/environments/${encodeURIComponent(env)}/secrets/${encodeURIComponent(name)}`), {
      method: 'PUT',
      body: { encrypted_value: sodium.to_base64(sealed, b64), key_id: key.key_id },
    });
  }
}

// libsodium va copiado en console/vendor/ (no desde un CDN): el código que cifra los secretos no debe depender
// de un servidor ajeno. Versión 0.7.15 de npm (libsodium + libsodium-wrappers), sin modificar.
let sodiumPromise;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL(src, import.meta.url).href;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
}
function loadSodium() {
  sodiumPromise ??= (async () => {
    if (!window.sodium) {
      await loadScript('./vendor/libsodium-0.7.15.js');
      await loadScript('./vendor/libsodium-wrappers-0.7.15.js');
    }
    await window.sodium.ready;
    return window.sodium;
  })();
  return sodiumPromise;
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

export function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function utf8ToB64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function explain(status, detail) {
  if (status === 401) return 'El token no es válido o expiró. Sal y entra con uno nuevo.';
  if (status === 403) return `GitHub negó el permiso (${detail || '403'}). Revisa que el token tenga los permisos de la guía.`;
  if (status === 404) return `No encontrado (${detail || '404'}). ¿El token tiene acceso al repo?`;
  if (status === 409 || status === 422) return `GitHub rechazó el cambio: ${detail}. Recarga e intenta de nuevo.`;
  return `Error de GitHub ${status}: ${detail}`;
}
