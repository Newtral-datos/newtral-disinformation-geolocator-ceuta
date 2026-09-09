# Vídeos de Ceuta — mapa de verificación

Mapa interactivo de vídeos virales ha recopilado Guille y su equipo. Cada punto del mapa es un vídeo con
su geolocalización real, su rating (Falso / Engañoso / Verdadero), el nivel de
confianza de esa geolocalización y un enlace al artículo de verificación
correspondiente.

Publicado en: https://newtral-datos.github.io/newtral-disinformation-geolocator-ceuta/

## Cómo está montado

- **Mapa**: [MapLibre GL JS](https://maplibre.org/) sobre teselas raster de
  OpenStreetMap sin API key, desaturadas a gris (`raster-saturation: -1` en
  `app.js`) para un aspecto monocromo. Sin librerías de pago ni claves que
  gestionar.
- **Puntos**: relleno menta corporativo fijo, el contorno (grueso) es el que
  codifica el rating — rojo (falso), amarillo (engañoso/falta contexto), menta
  (verdadero), gris (sin clasificar).
- **Sitio estático**: no hay backend. Todo el contenido sale de
  `data/videos.geojson`, que se genera con un script de Python
  (`generar_geojson.py`) a partir de `data/formulario.csv`.
- **Vídeos**: se descargan a `data/videos/` en vez de enlazarse en remoto,
  porque el CDN de X/Twitter devuelve 403 en cuanto detecta un `Referer` que
  no es el suyo — un `<video src="...">` remoto nunca llegaría a reproducirse
  incrustado en esta página.
- **Ficha de Newtral**: tarjeta de previsualización (imagen + título +
  descripción) extraída de los metadatos Open Graph del artículo, cacheados en
  `data/og_cache.json`.

## Estructura de archivos

```
mapa/
├── index.html            cabecera, controles, panel lateral de vídeo
├── styles.css             todo el diseño (sistema monocromo + acentos de rating)
├── app.js                  mapa, ficha de vídeo, leyenda, pastilla de confianza
├── generar_geojson.py      CSV → GeoJSON (ver siguiente sección)
├── servir.py                servidor local con soporte de peticiones Range
│                              (para que los vídeos permitan avanzar/retroceder)
└── data/
    ├── formulario.csv       ← fuente de datos, una fila por vídeo verificado
    ├── videos.geojson       generado, NO editar a mano
    ├── og_cache.json         caché de metadatos de artículos de Newtral
    └── videos/                .mp4 descargados, uno por vídeo
```

## Cómo actualizar el mapa con filas nuevas

1. **Añade la(s) fila(s) nueva(s) a `data/formulario.csv`**, respetando las
   cabeceras de columna existentes. Dos formatos de coordenadas aceptados en
   "Coordenadas de geolocalización":
   - DMS estilo Google Maps: `35°16’00.4″N 2°55’29.4″W`
   - Decimal: `35.2668, -2.9248`

2. **Ejecuta el generador** desde `mapa/`:

   ```bash
   python3 generar_geojson.py
   ```

   Por cada fila nueva, el script:
   - convierte las coordenadas a decimal y las valida (si no reconoce el
     formato, avisa por consola y omite esa fila en vez de romper el mapa);
   - descarga el vídeo a `data/videos/<hash>.mp4` (con el `Referer` que hace
     falta para esquivar el bloqueo de X/Twitter) — si ya existe, no lo vuelve
     a descargar;
   - clasifica el rating en `falso` / `enganoso` / `verdadero` / `otro` por
     palabra clave (ver `categorizar_rating()` — "Falso", "Engañoso",
     "Impreciso" y "Falta contexto" ya están cubiertos; si Newtral usa una
     categoría nueva, cae en "otro" y toca añadir la palabra clave);
   - extrae el nivel de confianza (1-5) y el texto entre paréntesis
     ("Verificado", "Muy probable"...) de la columna de confianza;
   - pide los metadatos Open Graph del artículo de Newtral y los cachea en
     `data/og_cache.json` (si la URL ya está en caché, no vuelve a pedir la
     página — solo tarda en artículos nuevos);
   - reescribe `data/videos.geojson` entero con todas las filas válidas.

   Las filas que ya estaban no se reprocesan de cero gracias a la caché de
   vídeos/OG (comprueban si el archivo/URL ya existe antes de descargar), así
   que ejecutar el script con el CSV entero cada vez es seguro y rápido.

3. **Revisa los avisos por consola** — `[aviso] coordenadas no reconocidas`,
   `[aviso] no se pudo descargar el vídeo` o `[aviso] no se pudieron leer los
   metadatos`. Una fila con aviso de coordenadas se omite del mapa entero, así
   que hay que corregirla en el CSV y volver a ejecutar el script.

4. **Comprueba el resultado en local** antes de publicar:

   ```bash
   python3 servir.py
   ```

   y abre `http://localhost:8000`.

5. **Publica los cambios**:

   ```bash
   git add data/formulario.csv data/videos.geojson data/og_cache.json data/videos/
   git commit -m "Añade N vídeo(s) nuevo(s)"
   git push
   ```

   GitHub Pages reconstruye el sitio solo al hacer push a `main` — no hace
   falta ningún paso de build aparte.

## Columnas esperadas en `formulario.csv`

| Columna | Uso |
|---|---|
| Marca temporal | solo se guarda, no se muestra |
| URL del vídeo | se descarga a `data/videos/` |
| Versión archivada | enlace en la ficha ("Versión archivada del vídeo") |
| País del vídeo | se muestra en la ficha |
| Ciudad o región del vídeo | título de la ficha |
| Coordenadas de geolocalización | DMS o decimal, ver arriba |
| Grado de confianza en la geolocalización | `"5 - Muy alto (verificado)"` → pastilla de 5 niveles |
| Ejemplo de publicación viral asociada al vídeo | se guarda, no se muestra actualmente |
| Versión archivada de publicación viral | enlace en la ficha |
| Claim de publicación viral | cita en cursiva en la ficha |
| Rating aplicado a mensajes virales vinculados al vídeo | badge de color |
| Comentarios | descripción de la narrativa en la ficha |
| URL Newtral | tarjeta de previsualización del artículo |
| Fecha de observación (posible origen) | se muestra junto al país |
