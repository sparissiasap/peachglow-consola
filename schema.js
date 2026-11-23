/*
 * Esquema de tenants/<id>/tenant.json: la configuración de cada negocio (white label).
 *
 * Una sola fuente para:
 *   - app.config.js (arma la app de Expo),
 *   - la CLI (`npm run tenant -- ...`) y el CI (validación),
 *   - la consola web (genera los formularios a partir de SECTIONS),
 *   - la guía (referencia de claves).
 *
 * Funciona en Node (require) y en el navegador (window.TenantSchema), sin dependencias.
 *
 * Cada campo:
 *   key       nombre de la clave dentro de su sección
 *   type      string | text | int | bool | color | url | email | emails | enum | list | json
 *   label     texto para la consola
 *   help      ayuda corta (opcional)
 *   required  obligatorio
 *   native    cambiarlo exige compilar un .aab nuevo (y subir runtimeVersion)
 *   locked    no se puede cambiar en un tenant protegido (PeachGlow) porque rompería la app publicada
 *   options   para enum: [{ value, label }]
 *   pattern   RegExp de validación para string
 *   max       largo máximo para string
 *   default   valor por defecto al crear un tenant nuevo
 *   example   ejemplo para la guía y placeholders
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TenantSchema = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ID_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;
  /** El negocio original: usa los .env y secretos de siempre (no los de su tenant.json). */
  const LEGACY_ID = 'peachglow';
  const PACKAGE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/;
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const URL_RE = /^https?:\/\/[^\s]+$/;

  /** Rubros con su vocabulario base (ver src/lib/industry.ts). */
  const INDUSTRIES = [
    { value: 'pestanas', label: 'Pestañas y cejas' },
    { value: 'unas', label: 'Uñas' },
    { value: 'barberia', label: 'Barbería' },
    { value: 'spa', label: 'Spa y masajes' },
    { value: 'estetica', label: 'Estética y peinado' },
    { value: 'generico', label: 'Genérico (cualquier servicio con cita)' },
  ];

  /** Módulos que se pueden incluir o quitar por plan. */
  const FEATURES = [
    { key: 'payments', label: 'Pagos en línea (Mercado Pago)' },
    { key: 'loyalty', label: 'Tarjeta de lealtad y puntos' },
    { key: 'wallet', label: 'Tarjeta en Google/Apple Wallet' },
    { key: 'ads', label: 'Anuncios (AdMob)' },
    { key: 'push', label: 'Notificaciones push' },
    { key: 'packages', label: 'Paquetes prepagados' },
    { key: 'giftCards', label: 'Tarjetas de regalo' },
    { key: 'referrals', label: 'Referidos' },
    { key: 'reviews', label: 'Reseñas y encuestas' },
    { key: 'waitlist', label: 'Lista de espera' },
    { key: 'homeService', label: 'Servicio a domicilio' },
    { key: 'healthForm', label: 'Ficha de salud y consentimiento' },
    { key: 'photos', label: 'Fotos antes y después' },
    { key: 'commissions', label: 'Comisiones del personal' },
    { key: 'tips', label: 'Propinas' },
    { key: 'inventory', label: 'Inventario' },
    { key: 'cashClose', label: 'Corte de caja' },
    { key: 'exports', label: 'Exportar a Excel (CSV)' },
    { key: 'calendarFeed', label: 'Agenda en el calendario del celular (ICS)' },
    { key: 'checkIn', label: 'Check-in con QR' },
    { key: 'gallery', label: 'Galería de trabajos' },
    { key: 'digitalCard', label: 'Tarjeta de presentación digital' },
  ];

  const f = (key, type, label, extra) => Object.assign({ key, type, label }, extra || {});

  const SECTIONS = [
    {
      key: 'app',
      label: 'App en la tienda',
      help: 'Identidad de la app instalada. Casi todo aquí exige compilar un .aab nuevo.',
      fields: [
        f('name', 'string', 'Nombre de la app', { required: true, max: 30, native: true, example: 'Nails by Ana' }),
        f('slug', 'string', 'Slug de Expo', { required: true, pattern: ID_PATTERN, native: true, locked: true, example: 'nailsbyana' }),
        f('scheme', 'string', 'Esquema de links (deep links)', { required: true, pattern: /^[a-z][a-z0-9+.-]*$/, native: true, locked: true, example: 'nailsbyana' }),
        f('androidPackage', 'string', 'Paquete Android', {
          required: true,
          pattern: PACKAGE_PATTERN,
          native: true,
          locked: true,
          help: 'Nunca se puede cambiar después de publicar en Play.',
          example: 'com.nailsbyana.app',
        }),
        f('iosBundleId', 'string', 'Bundle ID de iOS', { required: true, pattern: PACKAGE_PATTERN, native: true, locked: true, example: 'com.nailsbyana.app' }),
        f('version', 'string', 'Versión visible', { required: true, pattern: /^\d+\.\d+\.\d+$/, native: true, default: '1.0.0', example: '1.0.0' }),
        f('versionCode', 'int', 'versionCode (Android)', { required: true, native: true, default: 1, help: '+1 en cada .aab que se sube a Play.' }),
        f('runtimeVersion', 'string', 'runtimeVersion', {
          required: true,
          native: true,
          default: '1',
          help: 'Cámbialo cada vez que compiles un .aab con cambios nativos. Las actualizaciones solo llegan a la versión con el mismo valor.',
        }),
        f('easOwner', 'string', 'Cuenta de Expo (owner)', { required: true, locked: true, example: 'sergio.parissi.reyes' }),
        f('easProjectId', 'string', 'Project ID de EAS', {
          pattern: /^[0-9a-f-]{36}$/,
          locked: true,
          help: 'Se llena solo al dar de alta el negocio (eas init). Sin él no hay actualizaciones por aire.',
        }),
        f('permPhotos', 'text', 'Texto del permiso de fotos', { native: true, default: 'La app necesita acceso a tus fotos para subir imágenes de tus trabajos.' }),
        f('permLocation', 'text', 'Texto del permiso de ubicación', { native: true, default: '{app} usa tu ubicación para calcular el costo de la visita a domicilio.' }),
        f('permCalendar', 'text', 'Texto del permiso de calendario', { native: true, default: '{app} agrega tus citas a tu calendario con un recordatorio 30 minutos antes.' }),
        f('permReminders', 'text', 'Texto del permiso de recordatorios (iOS)', { native: true, default: '{app} no usa tus recordatorios; solo agrega tus citas al calendario.' }),
        f('permFaceId', 'text', 'Texto del permiso de Face ID (iOS)', { native: true, default: '{app} usa Face ID para desbloquear tu cuenta.' }),
      ],
    },
    {
      key: 'brand',
      label: 'Marca',
      help: 'Colores base. El color principal también se puede cambiar desde la app (Configuración → Identidad) sin compilar.',
      fields: [
        f('primaryColor', 'color', 'Color principal', { required: true, default: '#C8735A' }),
        f('backgroundColor', 'color', 'Color de fondo', { required: true, default: '#FFF9F6' }),
        f('adaptiveIconBackground', 'color', 'Fondo del ícono de Android', { required: true, native: true, default: '#FBF6EF' }),
      ],
    },
    {
      key: 'firebase',
      label: 'Firebase',
      help: 'Proyecto de Firebase propio del negocio.',
      fields: [
        f('projectId', 'string', 'Project ID', { required: true, pattern: /^[a-z][a-z0-9-]{4,29}$/, locked: true, example: 'nailsbyana-prod' }),
        f('region', 'string', 'Región de las functions', { required: true, default: 'us-central1', locked: true }),
        f('hostingSite', 'string', 'Site de Hosting', { required: true, pattern: /^[a-z0-9-]+$/, locked: true, example: 'nailsbyana' }),
        f('appUrl', 'url', 'URL pública de la web', { required: true, example: 'https://nailsbyana.web.app' }),
        f('apiKey', 'string', 'Web API key', { help: 'Configuración pública de la app web de Firebase. Si se deja vacía se usa el .env.' }),
        f('authDomain', 'string', 'Auth domain', { example: 'nailsbyana-prod.firebaseapp.com' }),
        f('storageBucket', 'string', 'Storage bucket', { example: 'nailsbyana-prod.firebasestorage.app' }),
        f('messagingSenderId', 'string', 'Messaging sender ID'),
        f('appId', 'string', 'App ID web'),
        f('googleWebClientId', 'string', 'Client ID web de Google (login con Google)'),
      ],
    },
    {
      key: 'locale',
      label: 'País e idioma',
      fields: [
        f('locale', 'string', 'Idioma y formato', { required: true, default: 'es-MX', pattern: /^[a-z]{2}-[A-Z]{2}$/ }),
        f('currency', 'string', 'Moneda (ISO)', { required: true, default: 'MXN', pattern: /^[A-Z]{3}$/ }),
        f('timezone', 'string', 'Zona horaria', { required: true, default: 'America/Mexico_City' }),
        f('phoneCountryCode', 'string', 'Lada del país', { required: true, default: '52', pattern: /^\d{1,3}$/ }),
      ],
    },
    {
      key: 'industry',
      label: 'Rubro y palabras',
      help: 'El rubro pone las palabras de la app. Cualquiera se puede reemplazar aquí o desde la app (Textos y mensajes).',
      fields: [
        f('preset', 'enum', 'Rubro', { required: true, options: INDUSTRIES, default: 'generico' }),
        f('clientSingular', 'string', 'Cómo se le dice a una persona cliente', { example: 'clienta' }),
        f('clientPlural', 'string', 'Plural', { example: 'clientas' }),
        f('clientFeminine', 'bool', '¿La palabra de cliente es femenina? ("la clienta", "ninguna")'),
        f('staffTitle', 'string', 'Cómo se le dice al personal', { example: 'lashista' }),
        f('staffPlural', 'string', 'Plural del personal', { example: 'lashistas' }),
        f('place', 'string', 'Cómo se le dice al lugar', { example: 'estudio' }),
        f('placeFeminine', 'bool', '¿La palabra del lugar es femenina? ("la barbería")'),
        f('categories', 'list', 'Categorías de servicios', { example: ['Extensiones', 'Retoques'] }),
        f('consent', 'text', 'Texto de consentimiento de la ficha de salud', { help: 'Usa {negocio} para el nombre.' }),
      ],
    },
    {
      key: 'features',
      label: 'Módulos incluidos',
      help: 'Lo que no esté incluido desaparece de la app, incluso su interruptor en Configuración. Lo incluido se prende y apaga desde la app.',
      fields: FEATURES.map((m) => f(m.key, 'bool', m.label, { default: true })),
    },
    {
      key: 'integrations',
      label: 'Integraciones',
      help: 'IDs públicos de las cuentas del negocio. Los tokens y llaves van en Secretos.',
      fields: [
        f('admobAndroidAppId', 'string', 'AdMob: App ID Android', { native: true, pattern: /^ca-app-pub-\d+~\d+$/ }),
        f('admobIosAppId', 'string', 'AdMob: App ID iOS', { native: true, pattern: /^ca-app-pub-\d+~\d+$/ }),
        f('admobAndroidBanner', 'string', 'AdMob: bloque de anuncios Android', { pattern: /^ca-app-pub-\d+\/\d+$/ }),
        f('admobIosBanner', 'string', 'AdMob: bloque de anuncios iOS', { pattern: /^ca-app-pub-\d+\/\d+$/ }),
        f('googleIosUrlScheme', 'string', 'Login con Google: URL scheme de iOS', { native: true }),
        f('googleIosClientId', 'string', 'Login con Google: client ID de iOS'),
        f('mpStatementDescriptor', 'string', 'Mercado Pago: texto en el estado de cuenta', { max: 22, example: 'NAILSBYANA' }),
        f('googleWalletIssuerId', 'string', 'Google Wallet: Issuer ID', { pattern: /^\d+$/ }),
        f('googleWalletClassSuffix', 'string', 'Google Wallet: sufijo de la clase', { pattern: /^[a-z0-9_]+$/, locked: true }),
        f('applePassTypeId', 'string', 'Apple Wallet: Pass Type ID'),
        f('appleTeamId', 'string', 'Apple: Team ID', { pattern: /^[A-Z0-9]{10}$/, help: '10 letras y números; está en developer.apple.com → Membership.' }),
        f('ascAppId', 'string', 'App Store Connect: Apple ID de la app', { pattern: /^\d+$/, help: 'El número de App Store Connect → la app → Información de la app → Apple ID. Se usa para subir y enviar a revisión.' }),
      ],
    },
    {
      key: 'legal',
      label: 'Legal y contacto',
      fields: [
        f('privacyUrl', 'url', 'Aviso de privacidad (URL)', { required: true }),
        f('deleteAccountUrl', 'url', 'Página para eliminar la cuenta (URL)', { required: true }),
        f('supportEmail', 'email', 'Correo de soporte', { required: true }),
        f('adminEmails', 'emails', 'Primeras cuentas admin', {
          help: 'Solo se usa al dar de alta el negocio. Después las cuentas se administran desde la app.',
        }),
      ],
    },
    {
      key: 'store',
      label: 'Tienda (publicación automática)',
      help: 'Cuando un push sube el versionCode (lo hace sola la consola al guardar un cambio 🔶), GitHub compila el .aab y lo sube a Google Play así. "No" = compilas y subes desde Compilar cuando quieras.',
      fields: [
        f('playTrack', 'enum', 'Subir a Google Play automáticamente', {
          options: [
            { value: 'no', label: 'No (manual desde Compilar)' },
            { value: 'production', label: 'Producción' },
            { value: 'alpha', label: 'Prueba cerrada (Alpha)' },
            { value: 'internal', label: 'Prueba interna' },
          ],
          default: 'no',
        }),
        f('playMode', 'enum', 'Qué hacer en Google Play', {
          options: [
            { value: 'draft', label: 'Dejar como borrador' },
            { value: 'inProgress', label: 'Enviar a revisión y lanzar al 20%' },
            { value: 'completed', label: 'Enviar a revisión y publicar a todos' },
          ],
          default: 'inProgress',
        }),
      ],
    },
    {
      key: 'signing',
      label: 'Firma Android',
      fields: [
        f('gradlePrefix', 'string', 'Prefijo de las propiedades de firma', {
          required: true,
          pattern: /^[A-Z][A-Z0-9_]*$/,
          locked: true,
          help: 'Las contraseñas del keystore se buscan como <PREFIJO>_UPLOAD_STORE_FILE, etc. en ~/.gradle/gradle.properties o en los secretos de GitHub.',
          example: 'NAILSBYANA',
        }),
      ],
    },
  ];

  /** Secretos que puede necesitar un negocio (los valores nunca van en tenant.json). */
  const SECRETS = [
    { name: 'MP_ACCESS_TOKEN', label: 'Mercado Pago: Access token', target: 'firebase', feature: 'payments' },
    { name: 'MP_WEBHOOK_SECRET', label: 'Mercado Pago: clave secreta del webhook', target: 'firebase', feature: 'payments' },
    { name: 'GOOGLE_MAPS_API_KEY', label: 'Google Maps API key (o "-")', target: 'firebase', feature: 'homeService' },
    { name: 'GOOGLE_WALLET_CREDENTIALS', label: 'Google Wallet: JSON de la cuenta de servicio (o "-")', target: 'firebase', feature: 'wallet' },
    { name: 'APPLE_PASS_CREDENTIALS', label: 'Apple Wallet: JSON de certificados (o "-")', target: 'firebase', feature: 'wallet' },
    { name: 'FIREBASE_SERVICE_ACCOUNT', label: 'Cuenta de servicio para desplegar (JSON)', target: 'github' },
    { name: 'FUNCTIONS_ENV', label: 'Variables de las functions (contenido de functions/.env)', target: 'github' },
    { name: 'APP_ENV', label: 'Variables de la app (contenido de .env)', target: 'github' },
    { name: 'ANDROID_KEYSTORE_BASE64', label: 'Keystore de subida (.jks en base64)', target: 'github' },
    { name: 'ANDROID_KEYSTORE_PASSWORD', label: 'Contraseña del keystore', target: 'github' },
    { name: 'ANDROID_KEY_ALIAS', label: 'Alias de la llave', target: 'github' },
    { name: 'ANDROID_KEY_PASSWORD', label: 'Contraseña de la llave', target: 'github' },
    { name: 'APPLE_ASC_KEY_P8', label: 'Apple: llave de API de App Store Connect (archivo .p8)', target: 'github' },
    { name: 'APPLE_ASC_KEY_ID', label: 'Apple: Key ID de esa llave', target: 'github' },
    { name: 'APPLE_ASC_ISSUER_ID', label: 'Apple: Issuer ID (Usuarios y acceso → Integraciones)', target: 'github' },
  ];

  /** Archivos de imagen de cada tenant (tenants/<id>/<path>). */
  const ASSETS = [
    { key: 'icon', path: 'assets/icon.png', label: 'Ícono de la app', size: [1024, 1024], native: true },
    { key: 'adaptiveForeground', path: 'assets/android-icon-foreground.png', label: 'Ícono Android (frente)', size: [1024, 1024], native: true },
    { key: 'adaptiveBackground', path: 'assets/android-icon-background.png', label: 'Ícono Android (fondo)', size: [1024, 1024], native: true },
    { key: 'adaptiveMonochrome', path: 'assets/android-icon-monochrome.png', label: 'Ícono Android monocromo (notificaciones)', size: [1024, 1024], native: true },
    { key: 'favicon', path: 'assets/favicon.png', label: 'Favicon de la web', size: [48, 48] },
    { key: 'splash', path: 'assets/splash-icon.png', label: 'Imagen de arranque', native: true },
    { key: 'logo', path: 'assets/brand/logo.png', label: 'Logo' },
    { key: 'logoSymbol', path: 'assets/brand/logo-symbol.png', label: 'Logo (símbolo, tarjeta digital)' },
    { key: 'playIcon', path: 'assets/brand/play-icon-512.png', label: 'Ícono para Play Store', size: [512, 512] },
    { key: 'playFeature', path: 'assets/brand/play-feature-graphic.png', label: 'Gráfico de funciones de Play', size: [1024, 500] },
    { key: 'walletLogo', path: 'public/wallet/logo.png', label: 'Logo para Google Wallet' },
  ];

  const REQUIRED_ASSETS = ['icon', 'adaptiveForeground', 'adaptiveBackground', 'adaptiveMonochrome', 'favicon', 'logoSymbol'];

  function fieldOf(sectionKey, key) {
    const s = SECTIONS.find((x) => x.key === sectionKey);
    return s && s.fields.find((x) => x.key === key);
  }

  function checkValue(field, v) {
    switch (field.type) {
      case 'string':
      case 'text':
        if (typeof v !== 'string') return 'debe ser texto';
        if (field.max && v.length > field.max) return `máximo ${field.max} caracteres`;
        if (field.pattern && v !== '' && !field.pattern.test(v)) return 'formato inválido';
        return null;
      case 'int':
        return Number.isInteger(v) && v >= 0 ? null : 'debe ser un entero positivo';
      case 'bool':
        return typeof v === 'boolean' ? null : 'debe ser sí o no (true/false)';
      case 'color':
        return typeof v === 'string' && HEX.test(v) ? null : 'debe ser un color como #C8735A';
      case 'url':
        return typeof v === 'string' && URL_RE.test(v) ? null : 'debe ser una URL que empiece con https://';
      case 'email':
        return typeof v === 'string' && EMAIL.test(v) ? null : 'correo inválido';
      case 'emails':
        return Array.isArray(v) && v.every((e) => typeof e === 'string' && EMAIL.test(e)) ? null : 'lista de correos inválida';
      case 'list':
        return Array.isArray(v) && v.every((e) => typeof e === 'string') ? null : 'debe ser una lista de textos';
      case 'enum':
        return field.options.some((o) => o.value === v) ? null : `debe ser uno de: ${field.options.map((o) => o.value).join(', ')}`;
      case 'json':
        return null;
      default:
        return 'tipo desconocido';
    }
  }

  /**
   * Valida un tenant. Devuelve { ok, errors: [{ path, message }] }.
   * `id` es el nombre de la carpeta (debe coincidir con tenant.id).
   */
  function validate(tenant, id) {
    const errors = [];
    const err = (path, message) => errors.push({ path, message });
    if (!tenant || typeof tenant !== 'object' || Array.isArray(tenant)) {
      return { ok: false, errors: [{ path: '', message: 'tenant.json debe ser un objeto' }] };
    }
    if (typeof tenant.id !== 'string' || !ID_PATTERN.test(tenant.id)) err('id', 'id inválido: minúsculas, números y guiones (2 a 31)');
    if (id && tenant.id !== id) err('id', `debe ser igual al nombre de la carpeta (${id})`);
    if (tenant.active !== undefined && typeof tenant.active !== 'boolean') err('active', 'debe ser true o false');
    if (tenant.protected !== undefined && typeof tenant.protected !== 'boolean') err('protected', 'debe ser true o false');
    if (tenant.template !== undefined && typeof tenant.template !== 'boolean') err('template', 'debe ser true o false');
    // PeachGlow (la app ya publicada) siempre va protegida: así no se le pueden quitar los candados.
    if (tenant.id === LEGACY_ID && tenant.protected !== true) err('protected', `${LEGACY_ID} debe quedar protegido ("protected": true)`);

    const known = new Set(['id', 'active', 'protected', 'template', 'seed', '$schema', ...SECTIONS.map((s) => s.key)]);
    for (const k of Object.keys(tenant)) if (!known.has(k)) err(k, 'clave desconocida');

    for (const section of SECTIONS) {
      const data = tenant[section.key];
      if (data === undefined) {
        if (section.fields.some((x) => x.required)) err(section.key, 'falta la sección');
        continue;
      }
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        err(section.key, 'debe ser un objeto');
        continue;
      }
      const keys = new Set(section.fields.map((x) => x.key));
      for (const k of Object.keys(data)) if (!keys.has(k)) err(`${section.key}.${k}`, 'clave desconocida');
      for (const field of section.fields) {
        const v = data[field.key];
        if (v === undefined || v === null || v === '') {
          if (field.required) err(`${section.key}.${field.key}`, `falta: ${field.label}`);
          continue;
        }
        const problem = checkValue(field, v);
        if (problem) err(`${section.key}.${field.key}`, `${field.label}: ${problem}`);
      }
    }
    if (tenant.seed !== undefined && (typeof tenant.seed !== 'object' || tenant.seed === null)) err('seed', 'debe ser un objeto');
    return { ok: errors.length === 0, errors };
  }

  /** Lee un valor por ruta "seccion.clave". */
  function get(tenant, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), tenant);
  }

  /** Convierte texto (CLI o formulario) al tipo del campo. */
  function parseValue(path, raw) {
    const [s, k] = path.split('.');
    const field = fieldOf(s, k);
    if (!field) {
      if (path === 'active' || path === 'protected' || path === 'template') return raw === true || raw === 'true' || raw === 'si' || raw === 'sí';
      throw new Error(`Clave desconocida: ${path}`);
    }
    if (typeof raw !== 'string') return raw;
    switch (field.type) {
      case 'int': {
        const n = Number(raw);
        if (!Number.isInteger(n)) throw new Error(`${path}: debe ser un entero`);
        return n;
      }
      case 'bool':
        if (/^(true|si|sí|1|yes)$/i.test(raw)) return true;
        if (/^(false|no|0)$/i.test(raw)) return false;
        throw new Error(`${path}: usa true o false`);
      case 'list':
      case 'emails':
        return raw.trim().startsWith('[') ? JSON.parse(raw) : raw.split(',').map((x) => x.trim()).filter(Boolean);
      case 'json':
        return JSON.parse(raw);
      default:
        return raw;
    }
  }

  /** Asigna un valor por ruta y devuelve una copia nueva del tenant. */
  function set(tenant, path, value) {
    const copy = JSON.parse(JSON.stringify(tenant));
    const parts = path.split('.');
    let o = copy;
    for (let i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
      o = o[parts[i]];
    }
    if (value === undefined) delete o[parts[parts.length - 1]];
    else o[parts[parts.length - 1]] = value;
    return copy;
  }

  /**
   * Compara dos versiones de un tenant.
   * Devuelve { changed: [paths], native: [paths], lockedViolations: [paths] }.
   */
  function diff(before, after) {
    const changed = [];
    const native = [];
    const lockedViolations = [];
    const protectedTenant = !!(before && before.protected);
    for (const section of SECTIONS) {
      for (const field of section.fields) {
        const path = `${section.key}.${field.key}`;
        const a = JSON.stringify(get(before || {}, path));
        const b = JSON.stringify(get(after || {}, path));
        if (a === b) continue;
        changed.push(path);
        if (field.native) native.push(path);
        // easProjectId vacío → lleno es el alta normal, no una violación.
        if (protectedTenant && field.locked && a !== undefined) lockedViolations.push(path);
      }
    }
    for (const k of ['active', 'protected', 'template', 'id']) {
      if (JSON.stringify(before && before[k]) !== JSON.stringify(after && after[k])) changed.push(k);
    }
    if (protectedTenant && after && after.protected !== true) lockedViolations.push('protected');
    if (JSON.stringify(before && before.seed) !== JSON.stringify(after && after.seed)) changed.push('seed');
    return { changed, native, lockedViolations };
  }

  const VERSION_FIELDS = ['app.versionCode', 'app.version', 'app.runtimeVersion'];

  /**
   * Si el cambio va dentro de la app instalada (campos 🔶 o imágenes nativas) y no se subió la versión a mano,
   * sube versionCode y runtimeVersion en el mismo guardado (así no hay que acordarse).
   * `nativeAssets` = true cuando también cambió una imagen nativa (ícono, splash…).
   * Devuelve { tenant, bumped, reasons }.
   */
  function autoBump(before, after, nativeAssets) {
    const d = diff(before, after);
    const reasons = d.native.filter((p) => VERSION_FIELDS.indexOf(p) === -1);
    if (nativeAssets) reasons.push('imagen de la app');
    const manual = d.changed.some((p) => p === 'app.versionCode' || p === 'app.runtimeVersion');
    if (!reasons.length || manual || !before.app) return { tenant: after, bumped: false, reasons };
    const code = (before.app.versionCode || 0) + 1;
    let out = set(after, 'app.versionCode', code);
    out = set(out, 'app.runtimeVersion', String(code));
    return { tenant: out, bumped: true, reasons };
  }

  /** Tenant nuevo con los valores por defecto. */
  function blank(id, name) {
    const t = { id, active: true };
    for (const section of SECTIONS) {
      const data = {};
      for (const field of section.fields) if (field.default !== undefined) data[field.key] = field.default;
      t[section.key] = data;
    }
    t.app.name = name || id;
    t.app.slug = id.replace(/-/g, '');
    t.app.scheme = id.replace(/-/g, '');
    t.app.androidPackage = `com.${id.replace(/-/g, '')}.app`;
    t.app.iosBundleId = t.app.androidPackage;
    t.signing.gradlePrefix = id.replace(/-/g, '_').toUpperCase();
    return t;
  }

  /** Reemplaza {app} en los textos de permisos. */
  function fill(text, tenant) {
    return String(text || '').replace(/\{app\}/g, tenant.app.name);
  }


  // ---------- Negocio nuevo ----------

  const SAMPLE_SERVICES = {
    pestanas: [
      ['clasicas', 'Extensiones clásicas', 'Extensiones', 120, 650],
      ['lifting', 'Lifting de pestañas', 'Lifting', 60, 550],
      ['cejas', 'Diseño de cejas', 'Cejas', 45, 350],
    ],
    unas: [
      ['manicure-gel', 'Manicure en gel', 'Gel', 60, 350],
      ['acrilico', 'Uñas acrílicas', 'Acrílico', 120, 600],
      ['pedicure', 'Pedicure spa', 'Pedicure', 60, 400],
    ],
    barberia: [
      ['corte', 'Corte de cabello', 'Corte', 40, 250],
      ['barba', 'Arreglo de barba', 'Barba', 30, 180],
      ['corte-barba', 'Corte y barba', 'Corte y barba', 60, 380],
    ],
    spa: [
      ['relajante', 'Masaje relajante', 'Masajes', 60, 700],
      ['facial', 'Facial hidratante', 'Faciales', 60, 650],
      ['piedras', 'Masaje con piedras calientes', 'Masajes', 90, 950],
    ],
    estetica: [
      ['corte', 'Corte y peinado', 'Corte', 60, 400],
      ['tinte', 'Tinte completo', 'Color', 120, 900],
      ['tratamiento', 'Tratamiento hidratante', 'Tratamientos', 45, 450],
    ],
    generico: [
      ['servicio-1', 'Servicio de ejemplo', 'Servicios', 60, 500],
      ['servicio-2', 'Servicio largo', 'Servicios', 90, 800],
    ],
  };

  /** Datos iniciales de un negocio nuevo según su rubro (se cargan con `seed`). */
  function sampleSeed(t) {
    const rows = SAMPLE_SERVICES[t.industry.preset] || SAMPLE_SERVICES.generico;
    const hours = [{ start: '10:00', end: '19:00' }];
    return {
      settings: {
        name: t.app.name,
        email: t.legal.supportEmail || '',
        publicUrl: t.firebase.appUrl,
        brandColor: t.brand.primaryColor,
        booking: { slotStepMin: 30, minNoticeHours: 2, maxDaysAhead: 60, cancellationHours: 24, requireDeposit: t.features.payments !== false },
        reminders: { email: true, hoursBefore: 24 },
      },
      services: rows.map(([id, name, category, durationMin, price]) => ({
        id,
        name,
        category,
        durationMin,
        price,
        depositAmount: Math.round(price * 0.3),
        description: '',
      })),
      staff: [
        {
          id: 'principal',
          name: 'Especialista principal',
          color: t.brand.primaryColor,
          workingHours: { 0: [], 1: hours, 2: hours, 3: hours, 4: hours, 5: hours, 6: [{ start: '10:00', end: '15:00' }] },
        },
      ],
      inventory: [],
    };
  }

  /** google-services.json de relleno (hasta descargar el real de Firebase). Sirve para compilar, no para push. */
  function placeholderGoogleServices(t) {
    return {
      project_info: { project_number: '000000000000', project_id: t.firebase.projectId, storage_bucket: `${t.firebase.projectId}.firebasestorage.app` },
      client: [
        {
          client_info: { mobilesdk_app_id: '1:000000000000:android:0000000000000000', android_client_info: { package_name: t.app.androidPackage } },
          oauth_client: [],
          api_key: [{ current_key: 'REEMPLAZAR-CON-EL-google-services.json-REAL' }],
          services: { appinvite_service: { other_platform_oauth_client: [] } },
        },
      ],
      configuration_version: '1',
      _placeholder: true,
    };
  }

  /** Arma un tenant nuevo. `answers` trae lo que se preguntó o se pasó por opciones. */
  function buildNew(id, answers = {}) {
    if (!ID_PATTERN.test(id)) throw new Error('El id debe ir en minúsculas, con números o guiones (ej. nails-ana).');
    const t = blank(id, answers.name || id);
    t.industry.preset = answers.industry || 'generico';
    if (answers.primaryColor) t.brand.primaryColor = answers.primaryColor;
    t.app.easOwner = answers.easOwner || 'sergio.parissi.reyes';
    if (answers.androidPackage) {
      t.app.androidPackage = answers.androidPackage;
      t.app.iosBundleId = answers.androidPackage;
    }
    t.firebase.projectId = answers.projectId || `${id}-prod`;
    t.firebase.hostingSite = answers.hostingSite || t.firebase.projectId;
    t.firebase.appUrl = answers.appUrl || `https://${t.firebase.hostingSite}.web.app`;
    t.legal = {
      privacyUrl: answers.privacyUrl || `${t.firebase.appUrl}/privacidad`,
      deleteAccountUrl: answers.deleteAccountUrl || `${t.firebase.appUrl}/privacidad#eliminar-cuenta`,
      supportEmail: answers.supportEmail || 'soporte@example.com',
      ...(answers.adminEmails && answers.adminEmails.length ? { adminEmails: answers.adminEmails } : {}),
    };
    t.integrations = { mpStatementDescriptor: t.app.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 22), googleWalletClassSuffix: `${id.replace(/-/g, '_')}_lealtad` };
    for (const f of FEATURES) t.features[f.key] = answers.features ? answers.features.includes(f.key) : f.key !== 'ads';
    t.seed = sampleSeed(t);
    return t;
  }


  return {
    ID_PATTERN,
    LEGACY_ID,
    INDUSTRIES,
    FEATURES,
    SECTIONS,
    SECRETS,
    ASSETS,
    REQUIRED_ASSETS,
    fieldOf,
    validate,
    get,
    set,
    parseValue,
    diff,
    autoBump,
    blank,
    fill,
    sampleSeed,
    placeholderGoogleServices,
    buildNew,
  };
});
