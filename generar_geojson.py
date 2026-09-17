#!/usr/bin/env python3
"""
Convierte data/formulario.csv (respuestas del formulario de verificación) en
data/videos.geojson, que es lo que app.js carga en el mapa.

Uso:
  python3 generar_geojson.py

Formato esperado de la columna "Coordenadas de geolocalización": DMS estilo
Google Maps, p.ej. 35°16’00.4″N 2°55’29.4″W (grado ° + minuto ’ + segundo ″),
o decimal "lat, lon", p.ej. 35.2668, -2.9248 (el formulario ha usado los dos
formatos en filas distintas).

Vídeos: se descargan a data/videos/ y la ficha enlaza al archivo local en vez
de al CDN de origen — video.twimg.com (y CDNs equivalentes) rechazan la
petición con 403 en cuanto el navegador manda un Referer que no sea el suyo
propio, así que un <video src="URL de X/Twitter"> nunca llega a reproducirse
incrustado en esta página, ya sea en local o ya subido a GitHub Pages.

Artículo de Newtral: se extraen sus metadatos Open Graph (og:title,
og:description, og:image) para pintar una tarjeta de previsualización en vez
de un enlace de texto plano — cacheados en data/og_cache.json por URL para no
volver a pedir la página en cada ejecución.
"""

import csv
import hashlib
import html
import json
import math
import re
import subprocess
import unicodedata
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

CSV_PATH = Path(__file__).parent / "data" / "formulario.csv"
GEOJSON_PATH = Path(__file__).parent / "data" / "videos.geojson"
VIDEOS_DIR = Path(__file__).parent / "data" / "videos"
OG_CACHE_PATH = Path(__file__).parent / "data" / "og_cache.json"
DESCARGAS_FALLIDAS_PATH = Path(__file__).parent / "data" / "descargas_fallidas.json"

OG_RE = {
    clave: re.compile(
        r'<meta[^>]+(?:property=["\']og:%s["\'][^>]+content=["\']([^"\']*)["\']'
        r'|content=["\']([^"\']*)["\'][^>]+property=["\']og:%s["\'])' % (clave, clave),
        re.I,
    )
    for clave in ("title", "description", "image")
}

DMS_RE = re.compile(r"(\d+)°(\d+)[’'](\d+(?:\.\d+)?)[″\"]([NSEW])")
DECIMAL_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$")
CONFIANZA_RE = re.compile(r"^\s*(\d)")
CONFIANZA_PARENTESIS_RE = re.compile(r"\(([^)]+)\)")

# Categoría normalizada del rating -> color en app.js (RATING_COLORES). Por
# palabra clave en vez de valor exacto porque Newtral no siempre usa la misma
# redacción literal (p.ej. "Falso" vs "Falso ⚠️"), así que un match exacto se
# rompería en cuanto cambiara un emoji o un espacio.
def categorizar_rating(rating):
    texto = unicodedata.normalize("NFKD", rating).encode("ascii", "ignore").decode().lower()
    if "falso" in texto:
        return "falso"
    if "enganos" in texto or "imprecis" in texto or "contexto" in texto:
        return "enganoso"
    if "verdader" in texto:
        return "verdadero"
    return "otro"


def dms_a_decimal(coord_texto):
    """'35°16’00.4″N 2°55’29.4″W' -> (35.2667..., -2.9248...)"""
    coincidencias = DMS_RE.findall(coord_texto)
    if len(coincidencias) != 2:
        return None
    valores = {}
    for grados, minutos, segundos, direccion in coincidencias:
        decimal = float(grados) + float(minutos) / 60 + float(segundos) / 3600
        if direccion in ("S", "W"):
            decimal = -decimal
        valores[direccion] = decimal
    lat = valores.get("N", valores.get("S"))
    lon = valores.get("E", valores.get("W"))
    if lat is None or lon is None:
        return None
    return lat, lon


def decimal_directo(coord_texto):
    """'35.2668, -2.9248' -> (35.2668, -2.9248)"""
    m = DECIMAL_RE.match(coord_texto)
    return (float(m.group(1)), float(m.group(2))) if m else None


def coords_a_decimal(coord_texto):
    return dms_a_decimal(coord_texto) or decimal_directo(coord_texto)


def _curl_a_archivo(url, destino, referer=None):
    """Ejecuta curl para descargar `url` a `destino`. Devuelve None si fue bien,
    o el mensaje de error de curl en caso contrario (y borra el fichero
    parcial, si llegó a crearse).

    Comprueba el content-type devuelto además del código de salida: TikTok (y
    en general cualquier URL que en realidad sea la página web del vídeo, no
    el fichero) responde 200 con la página HTML de "Make Your Day" en vez de
    un 403/404 — curl la da por buena, y sin esta comprobación se guardaba esa
    página como si fuera el .mp4, un fallo silencioso que ni se detectaba ni
    llegaba a activar el fallback a la copia archivada."""
    cabeceras = ["-H", f"Referer: {referer}"] if referer else []
    resultado = subprocess.run(
        ["curl", "-fsSL", "--max-time", "60", *cabeceras,
         "-w", "%{content_type}", "-o", str(destino), url],
        capture_output=True, text=True,
    )
    if resultado.returncode == 0 and destino.exists():
        content_type = resultado.stdout.strip()
        if content_type.startswith("text/") or "html" in content_type:
            destino.unlink(missing_ok=True)
            return f"la URL devolvió una página web, no un vídeo (content-type: {content_type or 'desconocido'})"
        return None
    destino.unlink(missing_ok=True)
    return resultado.stderr.strip() or f"curl salió con código {resultado.returncode}"


ARCHIVE_ORG_ID_RE = re.compile(r"archive\.org/details/\s*([^/?#\s]+)")
EXTENSIONES_VIDEO = (".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi")


def resolver_archive_org(url_details):
    """A partir de una URL tipo https://archive.org/details/<id>, consulta la
    API de metadatos de archive.org y devuelve la URL directa de descarga del
    fichero de vídeo original (no una miniatura), o None si la URL no es de
    archive.org o el ítem no tiene ningún fichero de vídeo."""
    m = ARCHIVE_ORG_ID_RE.search(url_details or "")
    if not m:
        return None
    identificador = m.group(1)

    resultado = subprocess.run(
        ["curl", "-fsSL", "--max-time", "30", f"https://archive.org/metadata/{identificador}"],
        capture_output=True, text=True,
    )
    if resultado.returncode != 0:
        return None
    try:
        metadata = json.loads(resultado.stdout)
    except json.JSONDecodeError:
        return None

    candidatos = [
        f["name"] for f in metadata.get("files", [])
        if f.get("source") == "original" and f.get("name", "").lower().endswith(EXTENSIONES_VIDEO)
    ]
    if not candidatos:
        return None
    return f"https://archive.org/download/{identificador}/{quote(candidatos[0])}"


def descargar_video(url, archivo_video=""):
    """Descarga `url` a data/videos/ (si no está ya) y devuelve (ruta, error):
    `ruta` es la ruta relativa a usar como src del <video>, o la propia URL
    remota si la descarga falla; `error` es None si fue bien o el motivo del
    fallo (para poder informarlo, ver DESCARGAS_FALLIDAS_PATH en generar()).

    Si la descarga del CDN original falla y `archivo_video` es un enlace de
    archive.org (columna "Vídeo/imagen archivado" del formulario, pensada
    para archivar la publicación, no como fuente alternativa de descarga, pero
    sirve igual), se intenta de nuevo a partir de la copia archivada antes de
    darse por vencido — a los CDNs de X/Instagram/Facebook les caducan las
    URLs firmadas en horas, así que para cuando se ejecuta este script muchas
    ya devuelven 403/404 aunque el vídeo original siga vivo.

    Usa curl (no urllib) porque el Python de macOS no trae certificados de CA
    propios y falla con CERTIFICATE_VERIFY_FAILED; curl reutiliza el almacén
    de confianza del sistema, que sí los tiene."""
    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    nombre = hashlib.sha1(url.encode()).hexdigest()[:16] + ".mp4"
    destino = VIDEOS_DIR / nombre
    ruta_relativa = f"data/videos/{nombre}"

    if destino.exists():
        return ruta_relativa, None

    # Referer del propio origen del CDN — es lo que le hace falta a
    # video.twimg.com (y equivalentes) para no devolver 403 (ver docstring del
    # módulo). Al descargar server-side no importa qué Referer mandemos
    # nosotros, así que usamos el que sabemos que acepta.
    error = _curl_a_archivo(url, destino, referer="https://twitter.com/")
    if error is None:
        print(f"  descargado: {nombre}")
        return ruta_relativa, None
    print(f"[aviso] no se pudo descargar el vídeo ({error}), probando copia archivada: {url}")

    url_archivada = resolver_archive_org(archivo_video)
    if url_archivada:
        error_archivo = _curl_a_archivo(url_archivada, destino)
        if error_archivo is None:
            print(f"  descargado desde archive.org: {nombre}")
            return ruta_relativa, None
        print(f"[aviso] tampoco se pudo descargar la copia archivada ({error_archivo}): {url_archivada}")
        error = f"{error} | copia archivada: {error_archivo}"
    elif archivo_video:
        error = f"{error} | copia archivada sin fichero de vídeo descargable: {archivo_video}"

    print(f"[aviso] se enlaza la URL remota sin copia local: {url}")
    return url, error


UMBRAL_SOLAPE_M = 20  # a menos distancia, dos puntos se pintan casi uno encima del otro
RADIO_SEPARACION_M = 15  # > mitad del umbral, así el grupo separado ya no vuelve a solaparse


def distancia_m(lat1, lon1, lat2, lon2):
    """Distancia entre dos puntos en metros (fórmula de haversine)."""
    radio_tierra = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * radio_tierra * math.asin(math.sqrt(a))


def separar_puntos_solapados(features):
    """Vídeos geolocalizados a menos de UMBRAL_SOLAPE_M entre sí se pintan
    prácticamente encima uno del otro y no se pueden distinguir ni hacer clic
    por separado en el mapa. Agrupa por proximidad (transitiva: A cerca de B
    y B cerca de C los mete en el mismo grupo aunque A y C no lo estén entre
    sí) y reparte cada grupo en corro alrededor de su centroide. Solo cambia
    la coordenada pintada — no toca ninguna otra propiedad."""
    coords = [(f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0]) for f in features]
    n = len(features)
    visitados = [False] * n

    for i in range(n):
        if visitados[i]:
            continue
        grupo = [i]
        visitados[i] = True
        pendientes = [i]
        while pendientes:
            a = pendientes.pop()
            lat_a, lon_a = coords[a]
            for b in range(n):
                if not visitados[b] and distancia_m(lat_a, lon_a, *coords[b]) <= UMBRAL_SOLAPE_M:
                    visitados[b] = True
                    grupo.append(b)
                    pendientes.append(b)

        if len(grupo) < 2:
            continue

        lat_centro = sum(coords[j][0] for j in grupo) / len(grupo)
        lon_centro = sum(coords[j][1] for j in grupo) / len(grupo)
        m_por_grado_lat = 111320
        m_por_grado_lon = 111320 * math.cos(math.radians(lat_centro))
        for k, j in enumerate(grupo):
            angulo = 2 * math.pi * k / len(grupo)
            dlat = RADIO_SEPARACION_M * math.sin(angulo) / m_por_grado_lat
            dlon = RADIO_SEPARACION_M * math.cos(angulo) / m_por_grado_lon
            features[j]["geometry"]["coordinates"] = [lon_centro + dlon, lat_centro + dlat]


def confianza_a_valor(texto):
    """'5 - Muy alto (verificado)' -> 5. None si no hay un número inicial."""
    m = CONFIANZA_RE.match(texto)
    return int(m.group(1)) if m else None


def confianza_a_texto(texto):
    """'5 - Muy alto (verificado)' -> 'Verificado' — solo lo de dentro del
    paréntesis (a petición expresa), no la frase completa del formulario."""
    m = CONFIANZA_PARENTESIS_RE.search(texto)
    return m.group(1).capitalize() if m else texto


def cargar_cache_og():
    if OG_CACHE_PATH.exists():
        return json.loads(OG_CACHE_PATH.read_text(encoding="utf-8"))
    return {}


def guardar_cache_og(cache):
    OG_CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def og_metadata(url, cache):
    """Extrae og:title/og:description/og:image de `url` (típicamente el
    artículo de Newtral) para la tarjeta de previsualización. Cacheado en
    data/og_cache.json por URL — si ya lo tenemos no vuelve a pedir la
    página."""
    if url in cache:
        return cache[url]

    datos = {"titulo": "", "descripcion": "", "imagen": ""}
    resultado = subprocess.run(
        ["curl", "-fsSL", "--max-time", "20", url],
        capture_output=True, text=True,
    )
    if resultado.returncode == 0:
        html_pagina = resultado.stdout
        for clave, campo in (("title", "titulo"), ("description", "descripcion"), ("image", "imagen")):
            m = OG_RE[clave].search(html_pagina)
            if m:
                valor = m.group(1) or m.group(2)
                datos[campo] = html.unescape(valor).strip()
        print(f"  metadatos Newtral: {datos['titulo'][:60]!r}")
    else:
        print(f"[aviso] no se pudieron leer los metadatos de {url}")

    cache[url] = datos
    return datos


def generar():
    features = []
    descargas_fallidas = []
    cache_og = cargar_cache_og()
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        for fila in csv.DictReader(f):
            coords_texto = fila.get("Coordenadas de geolocalización", "").strip()
            coords = coords_a_decimal(coords_texto)
            if coords is None:
                print(f"[aviso] coordenadas no reconocidas, fila omitida: {coords_texto!r}")
                continue
            lat, lon = coords
            rating = fila.get("Rating aplicado a mensajes virales vinculados al vídeo", "").strip()

            video_url = fila.get("URL del vídeo", "").strip()
            archivo_video = fila.get("Vídeo/imagen archivado", "").strip()
            video_local, error_descarga = (
                descargar_video(video_url, archivo_video) if video_url else ("", None)
            )
            if error_descarga:
                descargas_fallidas.append({
                    "zona": fila.get("Ciudad o región del vídeo", "").strip(),
                    "pais": fila.get("País del vídeo", "").strip(),
                    "url": video_url,
                    "error": error_descarga,
                    "marca_temporal": fila.get("Marca temporal", "").strip(),
                })
            confianza = fila.get("Grado de confianza en la geolocalización", "").strip()

            newtral_url = fila.get("URL Newtral", "").strip()
            newtral_og = og_metadata(newtral_url, cache_og) if newtral_url else {"titulo": "", "descripcion": "", "imagen": ""}

            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "zona": fila.get("Ciudad o región del vídeo", "").strip(),
                    "pais": fila.get("País del vídeo", "").strip(),
                    "video": video_local,
                    "video_original": video_url,
                    "archivo_video": archivo_video,
                    "confianza": confianza,
                    "confianza_valor": confianza_a_valor(confianza),
                    "confianza_texto": confianza_a_texto(confianza),
                    "publicacion_viral": fila.get("Ejemplo de publicación viral asociada al vídeo", "").strip(),
                    "archivo_publicacion": fila.get("Versión archivada de publicación viral", "").strip(),
                    "claim": fila.get("Claim de publicación viral", "").strip(),
                    "rating": rating,
                    "rating_categoria": categorizar_rating(rating),
                    "comentarios": fila.get("Contexto", "").strip(),
                    "newtral_url": newtral_url,
                    "newtral_titulo": newtral_og["titulo"],
                    "newtral_descripcion": newtral_og["descripcion"],
                    "newtral_imagen": newtral_og["imagen"],
                    "fecha_origen": fila.get("Fecha de observación (posible origen)", "").strip(),
                    "marca_temporal": fila.get("Marca temporal", "").strip(),
                },
            })

    guardar_cache_og(cache_og)
    separar_puntos_solapados(features)
    geojson = {"type": "FeatureCollection", "features": features}
    GEOJSON_PATH.write_text(json.dumps(geojson, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(features)} vídeo(s) escrito(s) en {GEOJSON_PATH.relative_to(Path.cwd())}")

    # Informe de descargas fallidas: se escribe siempre (aunque esté vacío) para
    # que el fichero refleje el estado de la última ejecución, no el de una
    # anterior con más o menos fallos — y así sea fácil de identificar de un
    # vistazo qué vídeos siguen enlazando a la URL remota en vez de a una copia
    # local.
    DESCARGAS_FALLIDAS_PATH.write_text(
        json.dumps({"generado": datetime.now().isoformat(timespec="seconds"),
                     "total_fallidas": len(descargas_fallidas),
                     "fallidas": descargas_fallidas}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if descargas_fallidas:
        print(f"[aviso] {len(descargas_fallidas)} descarga(s) fallida(s) — detalle en "
              f"{DESCARGAS_FALLIDAS_PATH.relative_to(Path.cwd())}")


if __name__ == "__main__":
    generar()
