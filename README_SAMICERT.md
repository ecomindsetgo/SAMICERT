# SAMICERT v3.0.0

SAMICERT es el Sistema de Archivo y Manejo de Información para la Certificación de Documentos de la Corte Superior de Justicia del Santa · Archivo Desconcentrado.

## Mejoras principales de esta versión

- Validación reforzada del PDF firmado antes del registro definitivo.
- El PDF final debe conservar el ID de certificación en la carátula.
- El PDF final debe conservar exactamente la cantidad esperada de páginas.
- La huella SHA-256 final debe ser distinta a la del documento provisional `[SF]`.
- Se exige estructura de firma PDF con `ByteRange`, objeto de firma, contenedor criptográfico y `SubFilter` PKCS#7/CAdES.
- La certificación definitiva, el índice público, el evento de auditoría y el retiro del pendiente se registran como una operación atómica de Firestore.
- Los documentos pendientes cancelados por el certificador ya no se borran: quedan con estado `cancelado-certificador`, motivo, usuario y fecha.
- Las cancelaciones de Visto Bueno quedan registradas con motivo y evento de auditoría.
- La eliminación administrativa fue reemplazada por archivo controlado: se conserva una copia del registro retirado, el motivo, responsable y fecha.
- Se añadió una bitácora administrativa de auditoría de solo lectura desde la aplicación.
- La consulta pública ya no lee la colección interna `certificaciones`; utiliza `certificacionesPublicas`, que contiene únicamente los datos necesarios para validar el documento.
- Firebase Storage queda bloqueado porque el flujo actual conserva los PDF en la carpeta compartida/local y no los almacena en Storage.
- Se eliminaron los comentarios de los archivos de código de la aplicación.

## Alcance de la validación de firma

SAMICERT v3.0.0 valida que el archivo tenga una estructura compatible con una firma digital PDF/PAdES y que sea distinto del `[SF]`. Esta comprobación evita aceptar nuevamente el provisional sin firmar y detecta numerosos errores de asociación o archivo.

La aplicación web no sustituye la validación criptográfica completa de la cadena de confianza, vigencia, revocación y autoridad certificadora que realiza el software oficial de Firma ONPE u otra herramienta de validación PKI autorizada. Por eso la interfaz indica expresamente que la comprobación de SAMICERT es estructural y de integridad documental.

## Colecciones Firestore

- `usuarios`: perfiles de usuarios autorizados.
- `documentosVB`: trazabilidad del Visto Bueno.
- `pendientesFirma`: documentos enviados por certificadores a Mesa de Partes, incluidos cancelados.
- `certificaciones`: registro interno completo de certificaciones definitivas.
- `certificacionesPublicas`: índice mínimo utilizado por `verificar.html` y los QR.
- `auditoria`: eventos críticos de trazabilidad; no se pueden editar ni borrar desde la aplicación.
- `archivoEliminados`: copia de registros retirados por Administración; no se pueden editar ni borrar desde la aplicación.

## Orden recomendado de despliegue

1. Publique todos los archivos web de esta carpeta.
2. Publique `firestore.rules` y `storage.rules` en Firebase.
3. Ingrese con la cuenta Administrador.
4. Abra `Administración`.
5. Pulse `Sincronizar consulta pública` una sola vez para crear el índice público de las certificaciones históricas.
6. Compruebe varios QR antiguos y una certificación nueva en `verificar.html`.
7. Genere un respaldo administrativo después de la migración.

Durante el breve intervalo entre publicar las reglas nuevas y ejecutar la sincronización, una certificación histórica que aún no exista en `certificacionesPublicas` puede aparecer como no encontrada en la consulta pública. Las nuevas certificaciones se publican automáticamente al registrarse.

## Flujo operativo

### Visto Bueno

El usuario autorizado aplica el sello VB, guarda el PDF `[VB]` en la ubicación institucional y SAMICERT registra el ingreso a la bandeja del certificador.

### Certificación

El certificador selecciona el PDF, define las páginas a certificar, genera la carátula y el documento provisional `[SF]`. SAMICERT registra el pendiente con SHA-256 previo a la firma.

### Firma de Mesa de Partes

Mesa de Partes ubica el `[SF]` en la carpeta compartida, lo firma con Firma ONPE y carga el PDF firmado. SAMICERT valida identidad, páginas, diferencia de hash y estructura de firma. Si todo es correcto, registra la certificación definitiva, publica el índice mínimo para el QR, genera auditoría y elimina el pendiente en una sola operación.

### Consulta pública

`verificar.html` permite buscar por código y comparar localmente el SHA-256 del PDF recibido. El archivo seleccionado por el ciudadano se procesa en su navegador y no se sube a Firebase.

## Administración

El administrador puede generar respaldos, sincronizar el índice público, consultar la bitácora y archivar registros de prueba o error. El retiro exige motivo. La copia archivada y el evento de auditoría permanecen protegidos.

## Archivos principales

- `index.html`: interfaz principal.
- `style.css`: estilos de la aplicación.
- `app.js`: lógica de autenticación, VB, certificación, firma, verificación interna, historial, auditoría y administración.
- `verificar.html`, `verificar.css`, `verificar.js`: consulta pública.
- `firebase-config.js`: configuración pública del cliente Firebase y UID administrativo.
- `firestore.rules`: reglas de autorización y separación de datos internos/públicos.
- `storage.rules`: Storage bloqueado en esta versión.
- `qrcode.js`: generación local de QR.
- `sello-jorge.png`, `sello-roberto.png`, `sello-vb.png`: sellos.
- `logo-institucional.png`: identidad gráfica institucional.

La aplicación es estática y no requiere build. Debe publicarse mediante HTTPS; no debe abrirse directamente con `file://`.
