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

La versión actual **no guarda los PDF en Firebase**. El PDF certificado se descarga en el equipo del certificador. Por tanto, el respaldo JSON protege el registro de certificación, no el archivo PDF.

Para respaldos automáticos programados en la nube (por ejemplo, diarios) se recomienda añadir posteriormente una Cloud Function/servicio de servidor con privilegios de Firebase Admin SDK.

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
- `sello-jorge.png` — sello del certificador Jorge.
- `sello-roberto.png` — sello del certificador Roberto.

No requiere build ni bundler: los cuatro archivos (`index.html`, `style.css`, `app.js`, `firebase-config.js`) deben publicarse juntos, en la misma carpeta, tal como están.


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
