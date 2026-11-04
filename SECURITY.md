# Política de seguridad

PrysmaStudio procesa documentos personales (identificaciones, facturas, nómina). Una vulnerabilidad aquí
expone datos de personas reales, así que se toma en serio cualquier reporte.

## Versiones con soporte

Solo la rama `main` y la última etiqueta publicada reciben correcciones.

## Cómo reportar

- Usa el [reporte privado de vulnerabilidades de GitHub](https://github.com/torresjr94dev/PrysmaStudio/security/advisories/new).
  No abras un issue público ni un pull request con el detalle del fallo.
- Incluye: versión o commit afectado, pasos para reproducir, impacto que observas y, si lo tienes, un
  archivo de prueba (sin datos reales de terceros).
- Se intenta acusar recibo en menos de 7 días y publicar la corrección con un aviso de seguridad.

## Alcance

- La PWA y el motor PDF que corren en el navegador (`apps/web`, `packages/engine`).
- El servidor opcional (`server`) y la configuración de despliegue (`deploy`).

Fuera de alcance: instancias ajenas de PrysmaStudio. Prueba contra tu propio despliegue o contra el
entorno local (`pnpm dev` o `docker compose`), nunca contra servidores de terceros.

## Qué se considera vulnerabilidad

Cualquier forma de que un archivo salga del equipo del usuario sin que la interfaz lo anuncie, de leer
archivos de otros usuarios en el servidor, de ejecutar código a partir de un documento malicioso, o de
saltarse la llave de acceso de una instancia privada.
