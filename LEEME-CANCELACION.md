# Corrección de cancelación de envíos a Mesa de Partes

## Instalación

1. Reemplazar `app.js` e `index.html` en el sitio por los archivos de este paquete.
2. Conservar las reglas de Firebase que compartiste el 7 de octubre de 2026. Se incluye esa misma versión en `firestore.rules`; no es necesario modificarlas para cancelar.
3. Recargar el navegador con Ctrl + F5 e ingresar con el certificador que generó el envío.
4. Abrir **Certificar Documento → Mis documentos enviados a Mesa de Partes**, pulsar **Cancelar / eliminar** y confirmar.
5. Si Mesa de Partes ya tenía la bandeja abierta, pulsar **Actualizar pendientes** para refrescarla.

## Corrección

El botón anterior ejecutaba `deleteDoc`, operación prohibida para certificadores por las reglas publicadas. Ahora actualiza el documento a `estado: "cancelado-certificador"`, registra `canceladoPorUid`, nombre, correo y fecha del servidor. El envío sale de las bandejas de pendientes y queda conservado para trazabilidad en administración.

La cancelación comprueba en una transacción que el envío pertenece al certificador, sigue pendiente y no tiene una certificación final registrada. El registro final también vuelve a comprobar el estado del envío para detectar una cancelación hecha mientras Mesa de Partes tenía el documento abierto. Las operaciones desde esta versión coordinan esas comprobaciones mediante transacciones; actualizar el sitio también para las sesiones de Mesa de Partes.

La acción elimina el envío de las bandejas, no borra físicamente el registro ni los PDF de la carpeta compartida. Un archivo [SF] cancelado no debe seguir usándose; para volver a enviarlo, generar un nuevo documento. Si el registro tenía VB, se conserva su estado histórico de procesado por certificador.

## Validación realizada

- Comprobación de sintaxis JavaScript.
- 11 pruebas locales con Firestore simulado: cancelación propia, rechazo de otra cuenta, otro propietario, cancelado, inexistente o certificado; confirmación rechazada; mensaje de éxito; error de permisos y reintento; registro final permitido o bloqueado según el estado.
- No se accedió al proyecto Firebase real ni se publicaron cambios en el sitio.

## Incompatibilidad adicional del ZIP original

Las reglas compartidas exigen `validacionFirmaEstructural == true` al crear la certificación definitiva. El flujo original adjunto no implementa esa validación ni genera ese campo; por tanto, ese paso puede ser rechazado independientemente de esta corrección. No se añadió un valor `true` artificial ni se eliminó la exigencia de las reglas.

Además, el verificador público original consulta `certificaciones`, mientras estas reglas reservan la lectura pública para `certificacionesPublicas`. Este paquete corrige la cancelación solicitada; no constituye una adaptación completa del flujo de firma y verificación a esas reglas. Estas observaciones se basan en el ZIP adjunto y las reglas compartidas, no en una prueba del sitio publicado.
