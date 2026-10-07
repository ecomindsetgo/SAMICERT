# Corrección de firma y consulta pública

1. Subir todos los archivos de este paquete al repositorio que publica SAMICERT, reemplazando los anteriores.
2. En Firebase Console → Firestore Database → Reglas, copiar TODO el contenido de firestore.rules y pulsar Publicar. Subir este archivo a GitHub no publica las reglas en Firebase.
3. Recargar SAMICERT con Ctrl + F5 y volver a ingresar como Mesa de Partes.
4. Abrir el envío pendiente, seleccionar el PDF firmado por Firma ONPE y registrar. No es necesario generar otro envío si el anterior sigue pendiente.
5. Abrir el enlace/QR de consulta en una ventana privada y comprobar el PDF final. El archivo [SF] sin firma debe rechazarse al registrar y no coincidir con la huella final.

Se valida la estructura ByteRange/Contents con cobertura de todo el archivo antes de guardar. Esto no es validación criptográfica del certificado, cadena de confianza o revocación; esa validación corresponde al validador de firma digital.

El registro privado y su resumen público se crean en una misma transacción. La consulta pública solo obtiene un resumen por ID: no permite listar certificaciones ni expone correos o UID. Se conservan las restricciones de las reglas existentes.

Las certificaciones antiguas que no tengan resumen en certificacionesPublicas no aparecerán en la consulta pública. Esta actualización publica las nuevas al registrarlas; no migra ni altera automáticamente registros anteriores.

Validación local de sintaxis y pruebas con datos simulados. No se publicaron cambios en el sitio ni en el proyecto Firebase real. Después de desplegar, comprobar el flujo con un PDF firmado real.
