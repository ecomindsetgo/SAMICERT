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
- `index.html` — aplicación web.
- `firebase-config.js` — configuración Firebase y UID administrativo.
- `firestore.rules` — seguridad de Firestore.
- `sello-jorge.png` — sello del certificador Jorge.
- `sello-roberto.png` — sello del certificador Roberto.


## Corrección v2.0.1
Se corrigió un error de sintaxis en `firebase-config.js` que impedía cargar el módulo JavaScript de Firebase. El archivo contenía secuencias `\n` literales después del objeto de configuración. Esto hacía que la aplicación no pudiera inicializar Firebase y, por tanto, ningún usuario podía ingresar.

La aplicación debe publicarse mediante un servidor web (por ejemplo Netlify), no abrirse directamente con `file://`.
