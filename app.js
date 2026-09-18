/* ── Control de dominio ──
   Barrera de tráfico (2026-09-17, a petición expresa), no seguridad real:
   cualquiera con las herramientas de desarrollador puede saltársela — solo
   pretende desviar el tráfico casual que llegue por la URL de GitHub Pages
   directamente, o por un iframe embebido en un dominio que no sea Newtral,
   de vuelta al artículo original en vez de dejarlo ver el mapa suelto.
   Todo el script vive dentro de esta IIFE para poder cortar la ejecución con
   un `return` en cuanto se detecta un dominio no autorizado, sin tener que
   reindentar el resto del fichero dentro de un condicional. */
(function () {

  const DOMINIOS_PERMITIDOS = ['newtral.es', 'localhost', '127.0.0.1'];
  const URL_DESTINO_BLOQUEO = 'https://www.newtral.es/repositorio-desinformacion-videos-ceuta/';

  function hostnamePermitido(hostname) {
    return DOMINIOS_PERMITIDOS.some(d => hostname === d || hostname.endsWith('.' + d));
  }

  function accesoAutorizado() {
    // Visita directa (no embebido en iframe): manda el dominio del propio documento.
    if (window.self === window.top) {
      return hostnamePermitido(window.location.hostname);
    }
    // Embebido en iframe: no podemos leer window.top.location (cross-origin),
    // así que el dominio que lo incrusta se identifica por el referrer. Sin
    // referrer no hay forma de verificar quién lo embebe — se bloquea.
    try {
      return Boolean(document.referrer) && hostnamePermitido(new URL(document.referrer).hostname);
    } catch (e) {
      return false;
    }
  }

  function mostrarBloqueoAcceso() {
    document.body.innerHTML = `
      <div class="acceso-bloqueado">
        <span class="ab-eyebrow">Vídeos de Ceuta — mapa</span>
        <h1 class="ab-titulo">Este contenido solo está disponible en Newtral</h1>
        <p class="ab-texto">Ir a la publicación original</p>
        <a class="ab-boton" href="${URL_DESTINO_BLOQUEO}">Ir a newtral.es</a>
      </div>
    `;
  }

  if (!accesoAutorizado()) {
    mostrarBloqueoAcceso();
    return;
  }

/* ── Centro inicial ──
   Vista por defecto: toda Europa (2026-09-17, a petición expresa) — centro
   aproximado del continente y zoom bajo para que quepa de punta a punta sin
   necesidad de que el usuario aleje el mapa a mano. Ya no hay maxBounds (ver
   más abajo) que fuerce un zoom mínimo distinto del que se pide aquí. Latitud
   bajada de 54 a 47 (mismo día, a petición expresa) para orientar la vista
   algo más al sur, hacia el Mediterráneo, sin perder el norte de Europa.
   Centrada en España (mismo día, a petición expresa) en vez del centro
   geográfico de Europa, ya que el proyecto gira en torno a Ceuta. */
const CENTRO_INICIAL = { center: [-3.7, 40], zoom: 3.5 };

/* ── Rating ──
   Cada vídeo trae un rating tipo fact-check (ver "rating_categoria" en
   generar_geojson.py, que normaliza el texto libre de Newtral a una de estas
   claves). Colores corporativos (2026-09-09, a petición expresa) — es el
   único bloque de color de toda la interfaz aparte del propio vídeo, a
   propósito, para poder distinguir de un vistazo qué vídeos son falsos. */
const RATING_COLORES = {
  falso:          '#CF023D',
  falta_contexto: '#EAEA40',
  enganoso:       '#FF8A00',
  verdadero:      '#01F3B3',
  otro:           '#D8D8D8',
};
// Color de texto del badge (ver abrirPanelVideo): amarillo, naranja, menta y
// gris claro son fondos claros — texto blanco encima no se leería, hace
// falta tinta oscura. Solo "falso" es lo bastante oscuro para texto blanco.
const RATING_TEXTO = {
  falso:          '#FFFFFF',
  falta_contexto: '#1C1C1C',
  enganoso:       '#1C1C1C',
  verdadero:      '#1C1C1C',
  otro:           '#1C1C1C',
};
const RATING_LABELS = {
  falso: 'Falso',
  falta_contexto: 'Falta contexto',
  enganoso: 'Engañoso / impreciso',
  verdadero: 'Verdadero',
  otro: 'Sin clasificar',
};

/* ── Confianza en la geolocalización ──
   Escala de 5 niveles del formulario, 1 (Muy bajo/hipótesis) a 5 (Muy
   alto/verificado) — ver "confianza_valor" en generar_geojson.py. Degradado
   monocromo del verde corporativo (2026-09-17, a petición expresa: paleta
   verde en vez del rojo→amarillo→verde anterior) — mismo tono (#01F3B3) en
   distintas luminosidades, de menta muy pálido (1) a verde corporativo a
   toda intensidad (5). */
const CONFIANZA_COLORES = ['#DBFFF5', '#A4FFE7', '#67FED6', '#2AFEC6', '#01F3B3'];

function renderConfianzaPill(valor, texto) {
  if (valor === null || valor === undefined) return '';
  const indice = valor - 1; // valor es 1-5, el array de colores es 0-4
  const segmentos = CONFIANZA_COLORES
    .map((c, i) => `<span class="cf-seg${i === indice ? ' cf-seg--activo' : ''}" style="background:${c}"></span>`)
    .join('');
  const posicion = ((indice + 0.5) / CONFIANZA_COLORES.length) * 100;
  // El puntero va FUERA de .cf-segmentos (que recorta en border-radius) — si
  // viviera dentro, ese mismo overflow:hidden que redondea las esquinas de la
  // barra se lo comía entero y nunca llegaba a pintarse.
  return `
    <div class="cf-wrap">
      <div class="cf-pill">
        <div class="cf-segmentos">${segmentos}</div>
        <span class="cf-marca" style="left:${posicion.toFixed(1)}%"></span>
      </div>
      <div class="cf-etiquetas"><span>Baja</span><span>Alta</span></div>
      <p class="cf-texto">${escapeHtml(texto || '')}</p>
    </div>`;
}

const map = new maplibregl.Map({
  container: 'map',
  style: { version: 8, sources: {}, layers: [] },
  center: CENTRO_INICIAL.center,
  zoom: CENTRO_INICIAL.zoom,
  minZoom: 3,
  maxZoom: 19,
  // Sin maxBounds (2026-09-17, a petición expresa): el mapa se puede mover y
  // alejar libremente en cualquier dirección — antes estaba limitado a
  // Europa/norte de África porque los vídeos virales que dicen mostrar Ceuta
  // a menudo se grabaron en realidad al otro lado del Estrecho, pero ese
  // límite de movimiento ya no se quiere.
  antialias: true,
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
// bottom-right, no bottom-left: ahí abajo a la izquierda vive la leyenda de
// ratings (#leyenda-panel), se pisaban.
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

document.getElementById('reset-btn').addEventListener('click', () =>
  map.flyTo({ center: CENTRO_INICIAL.center, zoom: CENTRO_INICIAL.zoom, duration: 800 })
);

/* ── Panel de vídeo ── */
const videoPanelEl = document.getElementById('video-panel');
const videoContenidoEl = document.getElementById('video-contenido');

function esEmbedExterno(url) {
  return /youtube\.com|youtu\.be|vimeo\.com/i.test(url || '');
}

function urlEmbed(url) {
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return url;
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function enlace(url, texto) {
  if (!url) return '';
  return `<a class="vc-enlace-chip" href="${url}" target="_blank" rel="noopener">
    <span class="vc-enlace-icono">↗</span>${texto}
  </a>`;
}

/* Tarjeta de previsualización del artículo de Newtral, tipo "link unfurl"
   (Slack/Twitter) — a partir de los og:title/og:description/og:image que
   extrae generar_geojson.py, en vez de un enlace de texto plano. */
function renderNewtralCard(url, titulo, descripcion, imagen) {
  if (!url) return '';
  return `
    <a class="nt-card" href="${url}" target="_blank" rel="noopener">
      ${imagen ? `<img class="nt-card-img" src="${imagen}" alt="" loading="lazy" />` : ''}
      <div class="nt-card-cuerpo">
        <span class="nt-card-fuente">Artículo de verificación | Newtral</span>
        <span class="nt-card-titulo">${escapeHtml(titulo || url)}</span>
        ${descripcion ? `<span class="nt-card-descripcion">${escapeHtml(descripcion)}</span>` : ''}
      </div>
    </a>`;
}

function abrirPanelVideo(props) {
  const {
    zona, pais, video, tipo, archivo_video, confianza, confianza_valor, confianza_texto,
    archivo_publicacion, claim, rating, rating_categoria,
    comentarios, newtral_url, newtral_titulo, newtral_descripcion, newtral_imagen,
    fecha_origen,
  } = props;

  const color = RATING_COLORES[rating_categoria] || RATING_COLORES.otro;
  const colorTexto = RATING_TEXTO[rating_categoria] || RATING_TEXTO.otro;
  // `video` es el fichero local descargado por generar_geojson.py (data/videos/*):
  // los CDN de X/Twitter devuelven 403 en cuanto detectan un Referer que no es el
  // suyo, así que enlazar el fichero remoto directamente no se reproduce incrustado.
  // Algunas filas del formulario son una imagen viral en vez de un vídeo (`tipo`
  // === 'imagen', detectado por content-type en generar_geojson.py).
  const player = video
    ? (esEmbedExterno(video)
        ? `<iframe src="${urlEmbed(video)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`
        : tipo === 'imagen'
          ? `<img src="${video}" alt="" />`
          : `<video src="${video}" controls playsinline></video>`)
    : '';

  const enlaces = [
    enlace(archivo_video, 'Versión archivada del vídeo'),
    enlace(archivo_publicacion, 'Versión archivada de la publicación'),
  ].filter(Boolean).join('');
  const newtralCard = renderNewtralCard(newtral_url, newtral_titulo, newtral_descripcion, newtral_imagen);
  // El badge de rating va junto a la etiqueta "Afirmación" (a petición
  // expresa), no junto al título — por eso vive dentro de vc-contexto-titulo
  // en vez de al lado de vc-titulo. Se muestra si hay claim o rating para no
  // perder el badge en la única fila que no tiene claim (ver `otro` en
  // RATING_LABELS).
  const badge = `<span class="vc-badge" style="background:${color};color:${colorTexto}">${escapeHtml(rating || RATING_LABELS.otro)}</span>`;

  const antetitulo = [pais, fecha_origen].filter(Boolean).map(escapeHtml).join(' - ');

  videoContenidoEl.innerHTML = `
    ${antetitulo ? `<span class="vc-antetitulo">${antetitulo}</span>` : ''}
    <h2 class="vc-titulo">${escapeHtml(zona || 'Ubicación sin especificar')}</h2>
    ${player ? `<div class="vc-player">${player}</div>` : ''}
    ${(claim || rating) ? `<div class="vc-afirmacion"><p class="vc-contexto-titulo">Afirmación${badge}</p>${claim ? `<p class="vc-claim">${escapeHtml(claim)}</p>` : ''}</div>` : ''}
    ${comentarios ? `<p class="vc-contexto-titulo">Contexto</p><p class="vc-descripcion">${escapeHtml(comentarios)}</p>` : ''}
    ${confianza ? `<p class="cf-titulo">Confianza en la geolocalización</p>${renderConfianzaPill(confianza_valor, confianza_texto)}` : ''}
    ${newtralCard}
    ${enlaces ? `<div class="vc-enlaces">${enlaces}</div>` : ''}
  `;
  videoPanelEl.classList.remove('hidden');
}

function cerrarPanelVideo() {
  videoPanelEl.classList.add('hidden');
  videoContenidoEl.innerHTML = '';
}
document.getElementById('video-cerrar').addEventListener('click', cerrarPanelVideo);

/* ── Leyenda de ratings ──
   Sin "sátira" (2026-09-09, a petición expresa): con una sola fila de datos
   todavía no sabemos qué otras categorías de rating usará el formulario, así
   que la leyenda solo lista las que de verdad puede producir hoy
   categorizar_rating() en generar_geojson.py en vez de adelantar categorías
   que quizá no lleguen a usarse nunca.
   Recuento (2026-09-17, a petición expresa): total de vídeos monitoreados y
   desglose por categoría, calculado a partir del propio geojson que ya carga
   el mapa — así el número nunca se desincroniza de los puntos dibujados. */
async function cargarConteos() {
  try {
    const res = await fetch('data/videos.geojson');
    const geojson = await res.json();
    const conteos = { total: 0, verdadero: 0, enganoso: 0, falta_contexto: 0, falso: 0, otro: 0 };
    for (const feature of geojson.features) {
      conteos.total++;
      const cat = feature.properties.rating_categoria;
      conteos[cat] !== undefined ? conteos[cat]++ : conteos.otro++;
    }
    return conteos;
  } catch (e) {
    console.warn('No se pudieron calcular los recuentos de la leyenda', e);
    return null;
  }
}

function renderLeyenda(conteos) {
  const claves = ['verdadero', 'falta_contexto', 'enganoso', 'falso', 'otro'];
  const items = claves.map(k => `
    <div class="lp-item" data-cat="${k}">
      <span class="lp-dot" style="border-color:${RATING_COLORES[k]}"></span>
      <span class="lp-label">${RATING_LABELS[k]}</span>
      ${conteos ? `<span class="lp-count">${conteos[k] || 0}</span>` : ''}
    </div>
  `).join('');
  document.getElementById('leyenda-panel').innerHTML = `
    <div class="lp-header">
      <span class="lp-titulo">Nivel de verificación</span>
      <button id="lp-deseleccionar" class="lp-clear">Ver todos</button>
    </div>
    ${conteos ? `<div class="lp-total">${conteos.total} vídeos e imágenes monitorizadas</div>` : ''}
    ${items}
  `;

  document.querySelectorAll('#leyenda-panel .lp-item').forEach(el => {
    const cat = el.dataset.cat;
    el.addEventListener('mouseenter', () => { categoriaHover = cat; aplicarResaltado(); });
    el.addEventListener('mouseleave', () => { categoriaHover = null; aplicarResaltado(); });
    el.addEventListener('click', () => {
      categoriaSeleccionada = categoriaSeleccionada === cat ? null : cat;
      aplicarResaltado();
    });
  });
  document.getElementById('lp-deseleccionar').addEventListener('click', () => {
    categoriaSeleccionada = null;
    aplicarResaltado();
  });
  aplicarResaltado();
}

/* ── Resaltado por categoría al pasar el ratón/seleccionar en la leyenda ──
   (2026-09-17, a petición expresa) Atenúa los puntos que no son de la
   categoría activa en vez de ocultarlos del todo — así se mantiene el
   contexto geográfico del resto de vídeos mientras se resalta un rating.
   Hover (categoriaHover) manda mientras dura, y al retirar el ratón se
   vuelve a la selección fija por click (categoriaSeleccionada), que persiste
   hasta volver a hacer click en la misma categoría. */
const CIRCULO_OPACIDAD_ATENUADA = 0.12;
let categoriaHover = null;
let categoriaSeleccionada = null;

function aplicarResaltado() {
  const cat = categoriaHover || categoriaSeleccionada;
  const conCase = (normal) => cat
    ? ['case', ['==', ['get', 'rating_categoria'], cat], normal, CIRCULO_OPACIDAD_ATENUADA]
    : normal;

  map.setPaintProperty('videos-circle-halo', 'circle-opacity', conCase(0.8));
  map.setPaintProperty('videos-circle', 'circle-opacity', conCase(1));
  map.setPaintProperty('videos-circle', 'circle-stroke-opacity', conCase(0.8));
  map.setPaintProperty('videos-circle-borde-interior', 'circle-stroke-opacity', conCase(0.8));

  document.querySelectorAll('#leyenda-panel .lp-item').forEach(el => {
    el.classList.toggle('lp-item--activo', el.dataset.cat === categoriaSeleccionada);
  });
  const botonLimpiar = document.getElementById('lp-deseleccionar');
  if (botonLimpiar) botonLimpiar.classList.toggle('lp-clear--visible', !!categoriaSeleccionada);
}

/* ── Carga del mapa ── */
map.on('load', async () => {

  /* Basemap: teselas OSM crudas (sin API key) desaturadas a gris — misma técnica que
     el mapa de "Análisis distancia bancos" (raster-saturation en vez de un estilo
     vectorial monocromo, que sí necesitaría una clave de proveedor). */
  map.addSource('basemap', {
    type: 'raster',
    tiles: [
      'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
      'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
      'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
    ],
    tileSize: 256,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  map.addLayer({
    id: 'basemap',
    type: 'raster',
    source: 'basemap',
    paint: {
      'raster-saturation': -1,
      'raster-brightness-min': 0.35,
      'raster-brightness-max': 1,
      'raster-contrast': 0.05,
    },
  });

  /* Puntos de vídeo — se generan con generar_geojson.py a partir de
     data/formulario.csv (respuestas del formulario de verificación). */
  map.addSource('videos', {
    type: 'geojson',
    data: 'data/videos.geojson',
  });

  /* Halo debajo del círculo principal — borde doble (2026-09-17, a petición
     expresa, "probemos") para que los puntos destaquen más sobre el basemap:
     un anillo extra justo por fuera del borde de color de rating, en gris
     oscuro y semitransparente en vez de otro color de rating, para no
     interferir con el código de colores existente. */
  map.addLayer({
    id: 'videos-circle-halo',
    type: 'circle',
    source: 'videos',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 11, 16, 16],
      'circle-color': '#494949',
      'circle-opacity': 0.8,
    },
  });

  map.addLayer({
    id: 'videos-circle',
    type: 'circle',
    source: 'videos',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 16, 10],
      'circle-color': RATING_COLORES.verdadero,
      'circle-stroke-width': 4,
      'circle-stroke-color': [
        'match', ['get', 'rating_categoria'],
        'falso', RATING_COLORES.falso,
        'falta_contexto', RATING_COLORES.falta_contexto,
        'enganoso', RATING_COLORES.enganoso,
        'verdadero', RATING_COLORES.verdadero,
        RATING_COLORES.otro,
      ],
      'circle-stroke-opacity': 0.8,
    },
  });

  /* Mismo borde doble también en el círculo central (2026-09-17, a petición
     expresa) — un anillo fino en el mismo gris oscuro justo donde el relleno
     verde se encuentra con el aro de color de rating, encima de éste (mismo
     radio que el relleno, para que el propio circle-stroke lo dibuje hacia
     fuera exactamente ahí). */
  map.addLayer({
    id: 'videos-circle-borde-interior',
    type: 'circle',
    source: 'videos',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 16, 10],
      'circle-opacity': 0,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#494949',
      'circle-stroke-opacity': 0.8,
    },
  });

  map.on('click', 'videos-circle', (e) => {
    const feature = e.features[0];
    abrirPanelVideo(feature.properties);
  });
  map.on('mouseenter', 'videos-circle', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'videos-circle', () => { map.getCanvas().style.cursor = ''; });

  renderLeyenda(await cargarConteos());
});

})();
