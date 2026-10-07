# Corrección de la ventana de guardado

El selector de guardado se abre directamente al pulsar el botón, antes de consultar Firebase, leer el PDF o calcular su huella. Corregido en Visto Bueno, entrega del certificador a Mesa de Partes y registro del PDF firmado.

Ahora primero se elige dónde guardar y después se procesa el documento. Si se cancela el selector, no se registra el envío. Elegir la ubicación no confirma por sí solo que el proceso haya finalizado: esperar el mensaje de éxito.

Reemplazar app.js por el incluido y recargar con Ctrl + F5. Se incluyen todos los archivos y las correcciones anteriores de firma y consulta pública. Este ajuste no modifica las reglas de Firebase.

Verificación local: sintaxis JavaScript y comprobación de que showSaveFilePicker es la primera operación asíncrona de los tres controladores. Falta comprobar la interacción en el navegador del sitio publicado.
