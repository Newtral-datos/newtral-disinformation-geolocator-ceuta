# AGENTS.md — Vídeos de Ceuta, mapa de verificación

Contexto para cualquier agente (o persona) que retome este proyecto. Describe
el estado **actual** del código, no el historial de cómo se llegó ahí — para
eso está `git log`.

## Qué es esto

Sitio estático (sin backend) publicado en GitHub Pages:
https://newtral-datos.github.io/newtral-disinformation-geolocator-ceuta/

Mapa interactivo donde cada punto es un vídeo o imagen viral relacionado con
Ceuta, verificado por Newtral: geolocalización real, rating (Falso /
Engañoso / Verdadero), nivel de confianza de esa geolocalización y enlace al
artículo de verificación.

Todo el contenido sale de `data/videos.geojson`, generado por
`generar_geojson.py` a partir de `data/formulario.csv` (exportado de un
formulario de Google que rellena el equipo de verificación).

## Archivos

```
mapa/
├── index.html              cabecera, controles, panel de vídeo (esqueleto HTML)
├── styles.css               todo el diseño
├── app.js                    lógica del mapa, control de dominio, panel, leyenda
├── generar_geojson.py        CSV → GeoJSON (descarga vídeos, comprime, extrae OG)
├── servir.py                  servidor local con soporte de peticiones Range
├── logo_newtral.png / logo-newtral-favicon.png
└── data/
    ├── formulario.csv         fuente de datos, una fila por vídeo/imagen — editar a mano
    ├── videos.geojson         GENERADO, no editar a mano
    ├── og_cache.json          caché de metadatos Open Graph de artículos Newtral
    ├── descargas_fallidas.json  GENERADO, informe de la última ejecución
    └── videos/                 .mp4 descargados y comprimidos, uno por vídeo
```

## ⚠️ El bug que se repite: nombres de columna desincronizados

El formulario de Google del que sale `formulario.csv` ha cambiado el nombre
de varias columnas con el tiempo (sin avisar), y `generar_geojson.py` seguía
leyendo el nombre antiguo con `fila.get("Nombre viejo", "")` — como
`.get()` no falla si la clave no existe, esto **no lanza ningún error**, solo
deja ese campo siempre vacío en el geojson. Se han encontrado y corregido
tres casos así en la misma sesión:

- `"Comentarios"` → ahora es `"Contexto"`
- `"Versión archivada"` → ahora es `"Vídeo/imagen archivado"`
- `"Fecha de observación (posible origen)"` → ahora es `"Fecha real del
  vídeo (aparición en internet)"`

**Si el formulario cambia otra vez y algo deja de aparecer en la ficha sin
ningún aviso en consola, sospecha primero de esto.** Comprobación rápida:

```bash
head -1 data/formulario.csv | tr ',' '\n' | nl
```

y compararlo con cada `fila.get("...")` de `generar()` en `generar_geojson.py`
(sección "Columnas del CSV" más abajo tiene la tabla actualizada).

## `generar_geojson.py`

Ejecutar con `python3 generar_geojson.py` desde `mapa/`. Reescribe
`data/videos.geojson` entero cada vez; es seguro ejecutarlo repetidamente
porque vídeos y metadatos OG están cacheados por URL/hash (no se vuelven a
descargar/pedir si ya existen).

### Columnas del CSV (nombres exactos actuales)

| Columna del formulario | Propiedad en el geojson | Uso en la ficha |
|---|---|---|
| Marca temporal | `marca_temporal` | no se muestra (solo en `descargas_fallidas.json`) |
| URL del vídeo | `video_original` | fuente para descargar `video` |
| Vídeo/imagen archivado | `archivo_video` | enlace "Versión archivada del vídeo" + fallback de descarga (ver abajo) |
| País del vídeo | `pais` | antetítulo encima del vídeo |
| Ciudad o región del vídeo | `zona` | título de la ficha |
| Coordenadas de geolocalización | (se convierte a `lat, lon`) | posición del punto |
| Grado de confianza en la geolocalización | `confianza`, `confianza_valor`, `confianza_texto` | pastilla de 5 niveles |
| Ejemplo de publicación viral asociada al vídeo | `publicacion_viral` | se guarda, no se muestra actualmente |
| Versión archivada de publicación viral | `archivo_publicacion` | enlace "Versión archivada de la publicación" |
| Claim de publicación viral | `claim` | cita en cursiva, estilo blockquote |
| Rating aplicado a mensajes virales vinculados al vídeo | `rating`, `rating_categoria` | badge de color |
| Contexto | `comentarios` | párrafo bajo la etiqueta "CONTEXTO" |
| URL Newtral | `newtral_url` (+ og:title/description/image) | tarjeta de previsualización del artículo |
| Fecha real del vídeo (aparición en internet) | `fecha_origen` | junto al título |

Coordenadas: dos formatos aceptados en la misma columna, DMS estilo Google
Maps (`35°16'00.4″N 2°55'29.4″W`) o decimal (`35.2668, -2.9248`). Fila que no
matchea ninguno de los dos: aviso por consola y se omite del mapa.

Rating: `categorizar_rating()` clasifica por palabra clave (no exacta, porque
Newtral no siempre redacta igual) en `falso` / `enganoso` (incluye
"engañoso", "impreciso", "falta contexto") / `verdadero` / `otro`.

### Descarga de vídeo — cadena de fallbacks

`descargar_video(url, archivo_video)` intenta, en este orden, y **solo pasa
al siguiente paso si el anterior falla**:

1. `curl` directo a `url` (con `Referer: https://twitter.com/`, que es lo que
   evita el 403 de video.twimg.com/cdninstagram/fbcdn). Valida además el
   `content-type` de la respuesta: si es HTML (p.ej. TikTok devuelve 200 con
   su página normal, no el vídeo), se trata como fallo aunque curl no diera
   ningún error.
2. Si `archivo_video` es una URL de `archive.org/details/<id>`, se resuelve
   contra la API `archive.org/metadata/<id>` para encontrar el fichero de
   vídeo original (no una miniatura) y se descarga desde
   `archive.org/download/<id>/<fichero>`. Esto rescata los casos en los que
   la URL firmada del CDN de origen (X/Instagram/Facebook) ya ha caducado
   para cuando se ejecuta el script — caducan en horas.
3. Si todo falla, se enlaza la URL remota original (probablemente rota) y se
   registra el fallo.

Cualquier fallo final (tras agotar los dos intentos) se añade a
`data/descargas_fallidas.json`, que se **reescribe entero en cada
ejecución** (refleja el estado de la última pasada, no un acumulado
histórico) con zona/país/URL/error/fecha de cada fila afectada.

### Compresión de vídeo

Tras cualquier descarga nueva con éxito (por cualquiera de las dos vías),
`comprimir_video()` reencoda el fichero in situ con `ffmpeg`:
- recorta a `DURACION_MAXIMA_S` = 300 s (5 min) — un vídeo real llegó a durar
  7 min y disparó el aviso de GitHub de "fichero > 50 MB";
- limita resolución a `RESOLUCION_MAXIMA_PX` = 960 px en el lado más largo
  (nunca hace upscale, solo cap);
- reencoda a H.264/AAC (`VIDEO_CRF` = 30) — algunas copias de archive.org
  llegan en AV1, que Safari no reproduce.

Se aplica **una sola vez**, justo tras la descarga — los ficheros que ya
existían en `data/videos/` no se vuelven a tocar en ejecuciones futuras
(evita ir degradando el mismo vídeo en pasadas sucesivas). Requiere `ffmpeg`
instalado (`brew install ffmpeg`); si no está, avisa por consola y deja el
vídeo sin comprimir en vez de romper la generación.

Si algún día hace falta recomprimir todo lo ya existente (p.ej. cambiar los
parámetros), no hay comando dedicado — se hizo una vez a mano:

```python
import generar_geojson as g
for f in g.VIDEOS_DIR.glob('*.mp4'):
    g.comprimir_video(f)
```

### Puntos solapados

`separar_puntos_solapados()` agrupa (transitivamente) vídeos a menos de
`UMBRAL_SOLAPE_M` = 20 m entre sí y los reparte en corro alrededor del
centroide del grupo — solo para que se puedan pintar y clicar por separado,
no cambia ningún dato salvo la coordenada dibujada.

## `app.js`

Todo el fichero vive dentro de una IIFE `(function () { ... })();` para
poder cortar la ejecución con un `return` temprano si el control de dominio
falla (ver siguiente sección) sin tener que indentar el resto del código
dentro de un condicional.

### Control de dominio

Al principio del fichero, antes de crear el mapa: si el dominio no está
autorizado, sustituye `document.body` por una pantalla de bloqueo con un
botón (verde corporativo) al artículo original en newtral.es, y corta la
ejecución (no se llega a cargar MapLibre ni el geojson).

- **Dominios permitidos**: `newtral.es` (+ subdominios) y `localhost` /
  `127.0.0.1` (para que el desarrollo local no se vea afectado).
- **Visita directa** (no embebido en iframe): decide `window.location.hostname`.
- **Embebido en iframe**: no se puede leer `window.top.location` (cross-origin
  si el sitio embebido está en otro dominio), así que se usa
  `document.referrer`. Sin referrer, se bloquea (fail-closed).
- **Esto NO es seguridad real** — es una barrera de tráfico para que quien
  llegue por la URL cruda de GitHub Pages, o por un iframe embebido fuera de
  Newtral, vuelva al artículo en vez de quedarse viendo el mapa suelto.
  Cualquiera con las herramientas de desarrollador puede saltársela.
- URL de destino del botón y lista de dominios: constantes
  `URL_DESTINO_BLOQUEO` / `DOMINIOS_PERMITIDOS` al principio del fichero.

### Vista y límites del mapa

`CENTRO_INICIAL` = centro en España (`[-3.7, 40]`), zoom 3.5, pensado para
que la vista por defecto muestre toda Europa con España en el centro. Sin
`maxBounds` (se puede mover/alejar libremente); `minZoom: 3` es el único
límite de alejamiento.

### Colores

- `RATING_COLORES` / `RATING_TEXTO` / `RATING_LABELS`: los 4 colores de
  rating (único acento cromático de la interfaz aparte del vídeo en
  reproducción y el verde corporativo `--acento`).
- `CONFIANZA_COLORES`: paleta monocroma en degradado del verde corporativo
  `#01F3B3` (5 tonos, de menta pálido a verde pleno) para la pastilla de
  confianza en la geolocalización — deliberadamente NO es un semáforo
  rojo→verde.

### Capas del mapa (triple anillo por punto)

Cada punto son en realidad 3 capas de círculo superpuestas (de fuera adentro):
1. `videos-circle-halo`: anillo exterior gris `#494949` semitransparente.
2. `videos-circle`: relleno verde fijo + aro de color de rating (el
   `circle-stroke`).
3. `videos-circle-borde-interior`: anillo fino gris, mismo radio que el
   relleno, dibujado por encima para separar visualmente el relleno del aro
   de rating ("borde doble").

### Resaltado por categoría (leyenda)

`aplicarResaltado()` recalcula `circle-opacity`/`circle-stroke-opacity` de
las 3 capas con una expresión `case` de MapLibre: si hay categoría activa
(`categoriaHover` mientras dura el ratón encima del ítem, si no
`categoriaSeleccionada` fijada por click), atenúa (opacidad 0.12) los puntos
de otra categoría en vez de ocultarlos. Click alterna la selección fija
(mismo click sobre la misma categoría la quita).

Los recuentos de la leyenda (`cargarConteos()`) se calculan haciendo un
`fetch` del propio `data/videos.geojson` y contando por
`rating_categoria` — así nunca se desincronizan de los puntos dibujados.

### Panel de vídeo (`abrirPanelVideo`)

Orden de la ficha: antetítulo de país → reproductor (vídeo local o iframe de
YouTube/Vimeo si `video` es una URL externa) → título (zona) → badge de
rating → fecha → cita del claim → etiqueta "CONTEXTO" + párrafo → pastilla
de confianza → tarjeta de Newtral (link unfurl con OG) → chips de enlaces
archivados.

## `styles.css`

Sistema monocromo (tinta sobre papel) con el verde corporativo `#01F3B3`
como único acento — más los colores de rating, que son la excepción
deliberada. Una sola familia tipográfica en toda la interfaz vía
`--font-display` / `--font-body` / `--font-mono` (las tres apuntan al mismo
valor); en este momento está puesta a Helvetica Neue — hubo una prueba con
IBM Plex Mono (por eso el `<link>` de Google Fonts sigue en `index.html`,
por si se quiere volver a probar) pero se descartó.

Responsive: un único breakpoint `@media (max-width: 600px)` — panel de
vídeo a pantalla completa, cabecera/leyenda más compactas.

## Flujo para añadir vídeos/imágenes nuevos

1. Añadir fila(s) a `data/formulario.csv` (o volcar de nuevo la respuesta del
   formulario de Google, con cuidado con el aviso de arriba sobre nombres de
   columna).
2. `python3 generar_geojson.py` — revisar los avisos por consola.
3. `python3 servir.py` y comprobar en `http://localhost:8000`.
4. `git add data/... && git commit && git push` — GitHub Pages reconstruye
   solo al hacer push a `main`, sin paso de build.

Si `git push` avisa de algún fichero grande (>50 MB): ver si `ffmpeg` está
instalado y si `comprimir_video()` se aplicó — un vídeo de más de 5 min sin
comprimir es la causa más probable.
