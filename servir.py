#!/usr/bin/env python3
"""
Servidor estático local con soporte de peticiones Range (HTTP byte serving).

`python3 -m http.server` no soporta peticiones Range: siempre devuelve el
fichero completo con 200 OK, ignorando la cabecera `Range`. Los vídeos
servidos localmente (<video src="...">) necesitan Range para poder avanzar/
retroceder sin descargarse enteros primero — por eso hace falta este script
en vez del servidor estándar.

Uso:
  python3 servir.py            # puerto 8000 por defecto
  python3 servir.py 8123       # puerto a medida
"""

import http.server
import os
import re
import sys


class RangeRequestHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path) or not os.path.exists(path):
            return super().send_head()

        range_header = self.headers.get("Range")
        if not range_header:
            return super().send_head()

        file_size = os.path.getsize(path)
        m = re.match(r"bytes=(\d*)-(\d*)", range_header)
        if not m:
            self.send_error(416, "Rango no válido")
            return None

        start_s, end_s = m.groups()
        start = int(start_s) if start_s else 0
        end = int(end_s) if end_s else file_size - 1
        end = min(end, file_size - 1)

        if start >= file_size or start > end:
            self.send_error(416, "Rango fuera de límites")
            self.send_header("Content-Range", f"bytes */{file_size}")
            return None

        f = open(path, "rb")
        f.seek(start)
        length = end - start + 1

        self.send_response(206)
        ctype = self.guess_type(path)
        self.send_header("Content-type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.send_header("Content-Length", str(length))
        self.end_headers()

        self._range = (f, length)
        return f

    def copyfile(self, source, outputfile):
        if hasattr(self, "_range") and source is self._range[0]:
            remaining = self._range[1]
            while remaining > 0:
                chunk = source.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                remaining -= len(chunk)
            del self._range
        else:
            super().copyfile(source, outputfile)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    with http.server.ThreadingHTTPServer(("", port), RangeRequestHandler) as httpd:
        print(f"Sirviendo en http://localhost:{port} (con soporte Range para vídeos)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
