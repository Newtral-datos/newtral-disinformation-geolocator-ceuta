/* ── Centro inicial ──
   Zoom bajo (2026-09-09, a petición expresa) para ver de entrada toda la zona
   del Estrecho (Ceuta + norte de Marruecos), no solo la ciudad — los vídeos
   pueden originarse a ambos lados, ver maxBounds más abajo. */
const CENTRO_INICIAL = { center: [-4.1, 35.5], zoom: 8 };

/* ── Rating ──
   Cada vídeo trae un rating tipo fact-check (ver "rating_categoria" en
   generar_geojson.py, que normaliza el texto libre de Newtral a una de estas
   claves). Colores corporativos (2026-09-09, a petición expresa) — es el
   único bloque de color de toda la interfaz aparte del propio vídeo, a
   propósito, para poder distinguir de un vistazo qué vídeos son falsos. */
const RATING_COLORES = {
  falso:     '#CF023D',
  enganoso:  '#EAEA40',
  verdadero: '#01F3B3',
  otro:      '#D8D8D8',
};
// Color de texto del badge (ver abrirPanelVideo): amarillo, menta y gris
// claro son fondos claros — texto blanco encima no se leería, hace falta
// tinta oscura. Solo "falso" es lo bastante oscuro para texto blanco.
const RATING_TEXTO = {
  falso:     '#FFFFFF',
  enganoso:  '#1C1C1C',
  verdadero: '#1C1C1C',
  otro:      '#1C1C1C',
};
const RATING_LABELS = {
  falso: 'Falso',
  enganoso: 'Engañoso / impreciso',
  verdadero: 'Verdadero',
  otro: 'Sin clasificar',
};

/* ── Confianza en la geolocalización ──
   Escala 0-5 del formulario (ver "confianza_valor" en generar_geojson.py).
   Degradado de los 3 colores corporativos (2026-09-09, a petición expresa):
   RATING_COLORES.falso (0, sin verificar) → .enganoso → .verdadero (5,
   verificado) — mismo extremo rojo/menta que el badge de rating, para que
   "rojo" y "menta" signifiquen siempre lo mismo en toda la interfaz. */
const CONFIANZA_COLORES = ['#CF023D', '#DA5F3E', '#E5BC3F', '#BBEC57', '#5EEF85', '#01F3B3'];

function renderConfianzaPill(valor, textoOriginal) {
  if (valor === null || valor === undefined) return '';
  const segmentos = CONFIANZA_COLORES
    .map((c, i) => `<span class="cf-seg${i === valor ? ' cf-seg--activo' : ''}" style="background:${c}"></span>`)
    .join('');
  const posicion = ((valor + 0.5) / CONFIANZA_COLORES.length) * 100;
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
      <p class="cf-texto">${escapeHtml(textoOriginal || '')}</p>
    </div>`;
}

const map = new maplibregl.Map({
  container: 'map',
  style: { version: 8, sources: {}, layers: [] },
  center: CENTRO_INICIAL.center,
  zoom: CENTRO_INICIAL.zoom,
  minZoom: 7,
  maxZoom: 19,
  // Ceuta y el entorno del Estrecho (Tánger–Tetuán–Nador–Melilla–Algeciras): los
  // vídeos virales que dicen mostrar Ceuta a menudo se grabaron en realidad al
  // otro lado del Estrecho (ver el primer caso cargado, en Nador, Marruecos), así
  // que el mapa tiene que poder llegar hasta ahí en vez de quedarse solo en Ceuta.
  maxBounds: [[-7.0, 34.0], [-1.0, 37.0]],
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
  return url ? `<a href="${url}" target="_blank" rel="noopener">${texto}</a>` : '';
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
    zona, pais, video, archivo_video, confianza, confianza_valor,
    archivo_publicacion, claim, rating, rating_categoria,
    comentarios, newtral_url, newtral_titulo, newtral_descripcion, newtral_imagen,
    fecha_origen,
  } = props;

  const color = RATING_COLORES[rating_categoria] || RATING_COLORES.otro;
  const colorTexto = RATING_TEXTO[rating_categoria] || RATING_TEXTO.otro;
  // `video` es el fichero local descargado por generar_geojson.py (data/videos/*.mp4):
  // los CDN de X/Twitter devuelven 403 en cuanto detectan un Referer que no es el
  // suyo, así que enlazar el .mp4 remoto directamente no se reproduce incrustado.
  const player = video
    ? (esEmbedExterno(video)
        ? `<iframe src="${urlEmbed(video)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`
        : `<video src="${video}" controls playsinline></video>`)
    : '';

  const enlaces = [
    enlace(archivo_video, 'Versión archivada del vídeo'),
    enlace(archivo_publicacion, 'Versión archivada de la publicación'),
  ].filter(Boolean).join('');
  const newtralCard = renderNewtralCard(newtral_url, newtral_titulo, newtral_descripcion, newtral_imagen);

  videoContenidoEl.innerHTML = `
    ${player ? `<div class="vc-player">${player}</div>` : ''}
    <span class="vc-badge" style="background:${color};color:${colorTexto}">${escapeHtml(rating || RATING_LABELS.otro)}</span>
    <h2 class="vc-titulo">${escapeHtml(zona || 'Ubicación sin especificar')}</h2>
    <p class="vc-zona">${escapeHtml(pais || '')}${fecha_origen ? ` | ${escapeHtml(fecha_origen)}` : ''}</p>
    ${claim ? `<p class="vc-claim">${escapeHtml(claim)}</p>` : ''}
    ${comentarios ? `<p class="vc-descripcion">${escapeHtml(comentarios)}</p>` : ''}
    ${confianza ? `<p class="cf-titulo">Confianza en la geolocalización</p>${renderConfianzaPill(confianza_valor, confianza)}` : ''}
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
   que quizá no lleguen a usarse nunca. */
function renderLeyenda() {
  const claves = ['verdadero', 'enganoso', 'falso', 'otro'];
  const items = claves.map(k => `
    <div class="lp-item">
      <span class="lp-dot" style="background:${RATING_COLORES[k]}"></span>
      ${RATING_LABELS[k]}
    </div>
  `).join('');
  document.getElementById('leyenda-panel').innerHTML = `
    <div class="lp-titulo">Nivel de verificación</div>
    ${items}
  `;
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

  map.addLayer({
    id: 'videos-circle',
    type: 'circle',
    source: 'videos',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 16, 10],
      'circle-color': [
        'match', ['get', 'rating_categoria'],
        'falso', RATING_COLORES.falso,
        'enganoso', RATING_COLORES.enganoso,
        'verdadero', RATING_COLORES.verdadero,
        RATING_COLORES.otro,
      ],
      'circle-stroke-width': 2,
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

  renderLeyenda();
});
