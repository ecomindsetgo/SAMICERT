# SAMICERT v2.0.0

## Sistema
**Sistema de Archivo y Manejo de Información para la Certificación de Documentos (SAMICERT)**

**Creado por:** Alfredo Raúl Cruzado Palacios.

## Usuarios
SAMICERT mantiene dos usuarios certificadores autorizados:
- Jorge Luis Desposorio Castillo
- Roberto Alexander Dávila Arquiñigo

Cada certificador utiliza su propio sello.

## Nuevo rol: Administrador
Se incorporó un tercer usuario con rol administrativo. El administrador:
- No certifica documentos.
- Tiene acceso a **Administración**.
- Puede generar un respaldo JSON de los registros de Firestore.
- Puede seleccionar y eliminar registros de prueba o erróneos.
- Puede actualizar el historial después de una limpieza.
- No puede modificar una certificación existente: la eliminación es la única operación administrativa sobre el registro.

### Configuración del administrador
1. En Firebase Authentication cree la cuenta del administrador.
2. Copie el **UID** de esa cuenta.
3. Reemplace `REEMPLAZAR_CON_TU_UID_ADMIN` por ese UID en:
   - `firebase-config.js`
   - `firestore.rules`
4. Publique nuevamente las reglas de Firestore y el sitio.

**Importante:** el UID es la identidad de seguridad; no basta con ocultar el botón de Administración en la interfaz. Las reglas de Firestore también bloquean o permiten las operaciones.

## Respaldos
La función **Generar respaldo** descarga un archivo JSON con los registros de certificación, incluyendo SHA-256, identificador, certificador, fecha, hora y páginas certificadas.

El **PDF final certificado se guarda únicamente en el equipo del certificador**: el sistema no sube ni conserva una copia del archivo en sí (Firestore solo almacena los metadatos y el SHA-256 del documento, lo que permite verificar su integridad sin necesitar el PDF).

Para respaldos automáticos programados en la nube (por ejemplo, diarios de la base de Firestore) se recomienda añadir posteriormente una Cloud Function/servicio de servidor con privilegios de Firebase Admin SDK.

## Versión 2.2.0
- **Se quitó el respaldo del PDF final en el sistema.** Desde esta versión, el PDF certificado ya no se sube a Firebase Storage: el único ejemplar del archivo final queda en el equipo del certificador (descarga local), como en versiones anteriores a la 2.1.0.
- Se eliminó el botón "Ver PDF certificado" del Historial y de Verificar Documento (por ID o por hash), ya que no hay archivo respaldado que abrir.
- Los registros de Firestore siguen guardando el SHA-256 del documento, por lo que la verificación de integridad contra el PDF que tenga en mano el usuario sigue funcionando igual.
- El botón "Eliminar seleccionados" de Administración sigue intentando borrar, por compatibilidad, cualquier PDF que haya quedado respaldado en Storage por certificaciones hechas con la versión 2.1.0; si no existe, simplemente lo ignora.

## Versión 2.3.0
- **Logo institucional en la primera hoja:** `logo-institucional.png` es en realidad una imagen JPEG con extensión ".png". `pdf-lib` intentaba leerla como PNG, fallaba y la carátula caía en silencio al marcador "PJ". Ahora `app.js` detecta el formato real por los primeros bytes del archivo (PNG o JPEG) y la incrusta correctamente. Como el logo ya trae la leyenda "Poder Judicial del Perú", la carátula no repite el nombre de la institución debajo de él.
- **Página pública de consulta (`verificar.html`, `verificar.css`, `verificar.js`):** es el destino del enlace y del QR de la carátula (`https://samicert.ecomindsetgo.com/verificar.html?consulta=CERT-AAAA-XXXXXXXXXXXX`). No requiere iniciar sesión. Muestra código, fecha y hora, certificador, folios certificados y estado (con aviso si fue recertificación), y permite subir el PDF para comparar su SHA-256 con el registrado (el archivo se procesa en el navegador y no se envía a ningún servidor). No muestra correo del certificador ni nombre del archivo original.
- **Compatibilidad:** los PDF ya emitidos con enlace `/?consulta=ID` siguen funcionando: `index.html` redirige esos enlaces a `verificar.html`.
- **Reglas de Firestore (`firestore.rules`):** `certificaciones` ahora permite `get` público (un registro a la vez, conociendo su código de 12 caracteres aleatorios) y deja `list` solo para certificadores y administrador. **Deben publicarse en Firebase Console → Firestore → Reglas**; sin ese paso la página pública mostrará "servicio de consulta no habilitado".
- **QR sin depender de un CDN:** se incluye `qrcode.js` (qrcode-generator 1.4.4, licencia MIT) junto a los demás archivos y `index.html` lo carga localmente, evitando el error "qrcode is not defined" cuando la red institucional bloquea cdnjs.

## Limpieza de pruebas
Antes de eliminar registros de prueba:
1. Generar un respaldo.
2. Seleccionar los registros que deben eliminarse.
3. Confirmar la eliminación.

La eliminación se ejecuta contra Firestore y es irreversible desde la aplicación.

## Integridad
El sistema calcula SHA-256 sobre los bytes exactos del PDF final después de aplicar el sello y registra la huella en Firestore.

## Archivos
- `index.html` — marcado de la aplicación (sin estilos ni lógica embebidos).
- `style.css` — estilos de la interfaz.
- `app.js` — lógica de la aplicación (Firebase, sellado con pdf-lib, visor con pdf.js, administración).
- `firebase-config.js` — configuración Firebase y UID administrativo.
- `firestore.rules` — seguridad de Firestore.
- `storage.rules` — seguridad de Firebase Storage. Ya no se usa para subir PDFs certificados (ver v2.2.0); se conserva solo para permitir a Administración borrar respaldos antiguos de versiones previas del sistema, si existieran.
- `sello-jorge.png` — sello del certificador Jorge.
- `sello-roberto.png` — sello del certificador Roberto.
- `logo-institucional.png` — logo institucional de la carátula del PDF final y de la página pública (acepta PNG o JPEG, aunque conserve la extensión .png). Si no existe o no se puede leer, la carátula dibuja un marcador con las iniciales "PJ".
- `verificar.html`, `verificar.css`, `verificar.js` — página pública de consulta de certificaciones (destino del enlace y QR).
- `qrcode.js` — librería local para generar el QR de la carátula.

No requiere build ni bundler: todos los archivos de la carpeta (`index.html`, `style.css`, `app.js`, `firebase-config.js`, `qrcode.js`, `verificar.*`, logo y sellos) deben publicarse juntos, en la misma carpeta, tal como están.


## Corrección v2.0.1
Se corrigió un error de sintaxis en `firebase-config.js` que impedía cargar el módulo JavaScript de Firebase. El archivo contenía secuencias `\n` literales después del objeto de configuración. Esto hacía que la aplicación no pudiera inicializar Firebase y, por tanto, ningún usuario podía ingresar.

La aplicación debe publicarse mediante un servidor web (por ejemplo Netlify), no abrirse directamente con `file://`.

## Corrección v2.0.2
- Se corrigió el mismo tipo de error de escape (`\n` literal en vez de salto de línea real) que afectó a `firebase-config.js` en v2.0.1, esta vez en el mensaje de confirmación de `index.html` al eliminar registros desde Administración.
- Se configuró explícitamente `pdfjsLib.GlobalWorkerOptions.workerSrc`. Sin esto, el visor de páginas podía caer en un worker de un solo hilo, más lento e inestable con documentos de muchas páginas.
- El visor de páginas ahora renderiza cada página de forma independiente: si una página individual está dañada o no se puede previsualizar, se muestra un aviso "Sin vista previa" en esa página en vez de cancelar la vista previa completa del documento. La página sigue pudiendo seleccionarse y certificarse igual (el sellado con pdf-lib no depende de la previsualización con pdf.js).
- En documentos de varias páginas, el visor ahora muestra el avance de carga ("Cargando vista previa… (n de total)").
- Se agregó manejo específico para PDF protegidos con contraseña/encriptados y para archivos corruptos al momento de certificar, con mensajes de error más claros.
- No se impuso ningún límite de tamaño ni de número de páginas: el sistema está pensado para certificar documentos tanto de pocas páginas como de varios cientos.

## División v2.0.2
El `index.html` monolítico (marcado + estilos + lógica en un solo archivo de ~2000 líneas) se separó en tres archivos para facilitar el mantenimiento: `index.html` (marcado), `style.css` (estilos) y `app.js` (lógica). No cambia nada del comportamiento ni requiere build: siguen siendo archivos estáticos que se publican juntos tal cual.

## Versión 2.1.0
- **Íconos profesionales:** se reemplazaron los emojis y glifos de texto (lupa, rotar, cerrar, zoom, menú lateral, tarjetas de inicio, avatar) por un set de íconos SVG en línea de trazo limpio, consistentes en toda la interfaz.
- **Carátula del PDF final:** el documento certificado ahora se entrega con una primera hoja de "Constancia de Certificación de Copias", con los datos de la certificación (certificador, fecha, código, folios), y un enlace + código QR de consulta (generado localmente con `qrcode-generator`, sin servicios externos). Si se publica un archivo `logo-institucional.png`, se usa como logo; si no, se dibuja un marcador.
- **Numeración de página:** cada hoja certificada (con sello) incluye ahora "Página X/N" en el pie, respetando la rotación aplicada a la página.
- **Respaldo del PDF en el sistema:** el PDF final se sube automáticamente a Firebase Storage (`certificaciones/{ID}.pdf`) además de descargarse en el equipo del certificador. Se agregó `storage.rules` con el mismo esquema de permisos que Firestore (solo certificadores/administrador).
- **Consulta del PDF certificado:** se agregó el botón "Ver PDF certificado" en el Historial y en los resultados de Verificar Documento (por ID o por hash), que abre el PDF respaldado en una pestaña nueva.
- **Enlace de consulta directo:** el enlace/QR de la carátula (`?consulta=ID`) ahora, tras iniciar sesión, lleva automáticamente a la sección Verificar con esa consulta ya realizada.
- **Limpieza de administración:** al eliminar registros de prueba también se elimina, si existe, el PDF respaldado correspondiente en Storage.
