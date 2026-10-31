# Descargar video a MP4

Extensión para Brave, Chrome y Edge que guarda en **un solo archivo `.mp4`** los videos que las páginas reproducen en pedazos (streaming HLS, los famosos `.m3u8` y `.ts`).

Abrís la página, le das play, tocás el ícono y tocás **Descargar**. El archivo queda en tu carpeta de Descargas con el nombre de la página. No hace falta instalar programas ni usar la terminal, y no se reconvierte nada: la imagen y el sonido quedan tal cual los manda el sitio.

<p align="center">
  <img src="captura.png" width="760" alt="La ventanita de la extensión. A la izquierda, el video encontrado, con la calidad elegida y el botón Descargar. A la derecha, la descarga al 39 % con una tira de bloques que se va llenando.">
</p>

## Qué hace

- **Encuentra el video sola.** Cuando la página empieza a reproducir, el ícono muestra una flechita.
- **Te deja elegir la calidad.** Si el sitio ofrece varias, aparece un menú con la mejor primero, y es la que baja si no tocás nada.
- **Junta video y audio.** Si el sitio los manda por separado, quedan en el mismo archivo.
- **Funciona en sitios que rechazan a otros programas.** La descarga se hace desde la propia página, igual que la hace el reproductor, así que el sitio la ve como una visita normal. Por eso suele andar donde ffmpeg o curl reciben "error 403".
- **Aguanta videos largos.** Probada con archivos de más de 4 GB. Si se corta la conexión, reintenta sola.
- **Te avisa en palabras simples** cuánto falta, si el link venció o si el video está protegido.

## Instalación

Necesitás un navegador basado en Chromium (Brave, Chrome, Edge, Vivaldi u Opera), versión 110 o más nueva. No funciona en Firefox ni en Safari.

La extensión no está en la tienda de extensiones, así que se instala a mano:

1. Bajá este repositorio: botón verde **Code** → **Download ZIP**. Descomprimilo.
2. Dejá la carpeta en un lugar fijo, por ejemplo en tu carpeta personal. El navegador la lee desde ahí: si la movés o la borrás, la extensión deja de andar.
3. Abrí la página de extensiones: `brave://extensions` en Brave, `chrome://extensions` en Chrome o `edge://extensions` en Edge.
4. Prendé el **Modo de desarrollador**. En Brave y Chrome está arriba a la derecha.
5. Tocá **Cargar descomprimida** (en inglés, *Load unpacked*) y elegí la carpeta que tiene el archivo `manifest.json`.
6. Para tener el ícono a mano, tocá la pieza de rompecabezas de la barra y fijalo.

Si ya tenías abierta la página del video, recargala una vez.

**Para actualizar:** bajá la versión nueva, reemplazá los archivos de la carpeta y tocá el botón de recargar (↻) de la extensión en la página de extensiones.

## Cómo se usa

1. Abrí la página del video y dale play.
2. Tocá el ícono de la extensión. Si querés, cambiá el nombre del archivo o la calidad.
3. Tocá **Descargar** y dejá abierta la pestaña del video hasta que termine. La ventanita la podés cerrar.

El ícono te va mostrando cómo viene la cosa:

| Ícono | Significa |
| --- | --- |
| ↓ | Encontró un video en esta pestaña |
| 37% | Está descargando |
| ✓ | Terminó: el archivo está en Descargas |
| ! | Hubo un problema: abrí la ventanita para ver qué pasó |

## Qué se puede bajar y qué no

| Video | Resultado |
| --- | --- |
| HLS con pedazos `.ts` (H.264 + AAC), lo más común | ✅ Archivo `.mp4` |
| HLS con pedazos `.m4s` o `.mp4` (fMP4, CMAF): H.264, HEVC, VP9, AAC, Opus y otros | ✅ Archivo `.mp4` |
| Video y audio en listas separadas | ✅ Un solo `.mp4` con los dos |
| Pedazos `.ts` con otros formatos (HEVC, MP3, AC-3) | ⚠️ Se guarda sin convertir, como `.ts` (se ve con VLC) |
| Transmisiones en vivo | ⚠️ Guarda solo lo que hay disponible en ese momento |
| Videos cifrados o con protección anticopia (DRM), como los de Netflix o Disney+ | ❌ No se pueden guardar; la extensión avisa |
| Videos DASH (`.mpd`) | ❌ Todavía no |

Los subtítulos no se guardan. Si hay varios idiomas de audio, usa el que el sitio marca como principal.

## Preguntas frecuentes

**No aparece ningún video.**
Dale play y volvé a abrir la ventanita. Si recién instalaste la extensión, recargá la página. Si sigue sin aparecer, podés pegar el link a mano en **¿No aparece tu video?**. Para encontrarlo: apretá F12, andá a la pestaña **Red** (*Network*), escribí `m3u8` en el filtro y hacé clic derecho en la lista → **Copiar** → **Copiar URL**.

**Me dice "error 403".**
El link del video venció. Recargá la página, dale play y probá de nuevo.

**Me bajó un archivo `.ts` en vez de `.mp4`.**
El video viene en un formato que no entra en un mp4 sin reconvertirlo. VLC lo reproduce igual. Si tenés ffmpeg, lo podés pasar a mp4 con `ffmpeg -i video.ts -c copy video.mp4`.

**¿Baja en la calidad original?**
Baja la mejor calidad que ofrece el sitio. El archivo que se subió originalmente casi nunca llega al reproductor: el sitio fabrica copias en varias calidades y manda solo esas. Si el menú de calidades del sitio tiene una opción "Original" o "Fuente", esa sí suele ser el video tal cual se subió.

**Me dice que el navegador se quedó sin lugar.**
Mientras descarga, el navegador guarda los pedazos en el disco. Necesitás libre más o menos el doble de lo que pesa el video. En las ventanas privadas los videos grandes no entran.

**Me dice que la página se recargó.**
La descarga corre dentro de la pestaña del video: si la recargás o la cerrás, se corta. Hay que volver a empezar.

**¿Para qué sirve "Guardar sin convertir a mp4"?**
Está en **Opciones**. Deja los pedazos unidos tal cual vienen, casi siempre como `.ts`. Es un plan B por si algún mp4 saliera mal.

## Privacidad y permisos

La extensión **no manda nada a ningún servidor**: no tiene publicidad, estadísticas ni cuentas. Lo único que descarga es el video, desde el mismo sitio donde lo estás mirando.

| Permiso | Para qué lo usa |
| --- | --- |
| Acceso a los sitios | Ver qué videos carga cada página y bajarlos desde ella |
| `scripting` | Correr el motor de descarga dentro de la página del video |
| `webRequest` | Detectar las listas de video (`.m3u8`). Solo mira, no cambia nada |
| `downloads` | Guardar el archivo final en tu carpeta de Descargas |
| `storage` | Recordar, mientras el navegador está abierto, qué videos vio en cada pestaña y cómo va la descarga |
| `webNavigation` | Darse cuenta si recargás la página en medio de una descarga |

## Cómo funciona

<details>
<summary>Para curiosos y para quien quiera colaborar</summary>

1. **Detección.** `detector.js` corre en cada página y en cada marco (iframe), y avisa cuando ve pasar una lista `.m3u8`. El proceso de fondo (`background.js`) además reconoce las respuestas de tipo `mpegurl`.
2. **Descarga desde la página.** El motor (`engine.fn.js`) se inyecta en el mismo contexto de JavaScript que el reproductor del sitio, dentro del marco donde está el video. Así cada pedido sale con las mismas cookies, el mismo `Referer` y pasando por el mismo *service worker* que los del reproductor. Por eso funciona en sitios que rechazan a ffmpeg o curl aunque se les copien los encabezados.
3. **Armado del MP4, sin dependencias.** Lee MPEG-TS (H.264 y AAC) y MP4 fragmentado (cualquier códec). Respeta los cortes de la lista (`EXT-X-DISCONTINUITY`), los rangos de bytes (`EXT-X-BYTERANGE`) y los saltos de reloj. Escribe un MP4 común con el índice al principio, para que abra rápido en cualquier reproductor. No reconvierte: copia cada cuadro tal cual.
4. **Guardado.** Va guardando las partes en `Blob`s (el navegador las pasa a disco cuando hace falta), comprueba que cada una quedó bien y al final entrega el archivo con la API de descargas del navegador.

En las pruebas, con decenas de casos (`.ts` y fMP4, varias calidades, audio aparte, cortes, archivos de más de 4 GB), la imagen del `.mp4` resultante es idéntica cuadro por cuadro a la del que arma `ffmpeg -c copy`, y el sonido queda en sincronía.

| Archivo | Qué es |
| --- | --- |
| `manifest.json` | La ficha de la extensión |
| `background.js` | Proceso de fondo: detecciones, descargas e ícono |
| `detector.js` | Detector de videos que corre en cada página |
| `engine.fn.js` | Motor: baja los pedazos y arma el MP4 |
| `popup.html`, `popup.css`, `popup.js` | La ventanita |
| `LEEME.txt` | Instrucciones cortas, para quien baja solo la carpeta |

El código está sin minificar, así que se puede leer tal cual.

</details>

## Uso responsable

Usala para guardar videos que tengas permiso de guardar: los tuyos, los de dominio público o los de sitios que lo permitan. Respetá los términos de cada sitio y los derechos de autor. La extensión no saltea protecciones anticopia (DRM) ni cifrado.

## Problemas y sugerencias

Si un video no se descarga, abrí un *issue* contando:

- el mensaje que muestra la ventanita,
- el navegador y su versión,
- y, si es público, el link de la página.
