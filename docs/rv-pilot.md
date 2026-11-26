# RV Online: piloto local de consulta

## Alcance

El 26 de noviembre de 2026 se validaron mediante el navegador compartido las búsquedas del portal de RV Online: hotel en Cancún y traslado redondo CUN–hotel–CUN, una habitación, dos adultos y una menor de seis años. El portal usa Juniper. Esta comprobación manual no valida todavía la ejecución del nuevo programa en Windows.

El piloto abre Chrome o Edge instalado en la computadora. El usuario inicia sesión directamente en el portal. La sesión vive en un contexto temporal; no se exportan contraseñas, cookies, perfiles, trazas, capturas, identificadores de sesión ni HTML del proveedor. Los resultados se guardan en `data/rv-pilot/`, excluida de Git. No hay llamadas a OpenAI ni servicios de pago.

El programa solo consulta los controles visibles del portal. No utiliza una API privada, no registra cuentas y no acepta nuevas condiciones contractuales. Bloquea rutas de reserva y pago. Las credenciales de la web no se consideran credenciales de API. La documentación de Juniper indica que una conexión API requiere un acuerdo con el seller; no se ha confirmado ese acceso para esta cuenta.

## Ejecutar desde Windows

1. Conserva la demo abierta o ciérrala; el piloto funciona por separado.
2. Abre `PROBAR_RV_ONLINE.cmd` con doble clic. Instala las dependencias fijadas en el repositorio.
3. Inicia sesión en la ventana nueva de RV Online. Si el portal requiere una verificación, complétala personalmente. El piloto no almacena el perfil y el acceso habitual de tu navegador no se transfiere a esta ventana.
4. El programa consulta el ejemplo: Cancún, entrada dentro de 30 días, cuatro noches, una habitación, dos adultos y una menor de seis años, Riu Dunamar, horarios de prueba 10:00 y 10:00.
5. Revisa el archivo JSON indicado por la ventana. Si falla el traslado, conserva el resultado del hotel y marca el error; no lo sustituye por precios demo. Código de salida 0: ambas consultas completas; 2: resultado parcial; 1: fallo.

Node.js 24 o posterior y Chrome o Edge son necesarios. No requiere PowerShell ni descarga un navegador adicional. El portal debe mostrar las etiquetas en inglés que se validaron en esta fase. Si cambia la interfaz, el piloto debe detenerse para adaptarlo, sin adivinar campos ni repetir búsquedas.

El acceso se detecta por el enlace de cierre de sesión del portal y el buscador, incluso si el enlace está dentro de un menú o cambia su texto. Se revisan las pestañas de la ventana temporal por si el acceso abrió otra. CMD informa cada 15 segundos mientras espera. Si detecta acceso con un idioma de búsqueda aún no soportado, muestra ese motivo en lugar de seguir esperando. La sesión de tu navegador habitual no se comparte con la ventana del piloto.

Para verificar dependencias y solicitud sin abrir el navegador:

```bat
npm.cmd run rv:check
```

Para consultar otro caso dentro del alcance validado, crea un JSON local bajo `data/` con el siguiente formato y pásalo al piloto:

```json
{
  "trip": {
    "client": "",
    "destination": "Cancún",
    "start": "2027-02-10",
    "end": "2027-02-14",
    "rooms": [{ "adults": 2, "children": [6] }],
    "services": ["hotel", "transfer"],
    "airport": "CUN",
    "origin": "MTY",
    "meal": "any",
    "notes": ""
  },
  "hotelName": "Riu Dunamar",
  "outboundTime": "10:00",
  "returnTime": "10:00"
}
```

```bat
PROBAR_RV_ONLINE.cmd --request "data\mi-prueba.json"
```

## Hallazgos que cambian el modelo del cotizador

- El autocompletado debe seleccionar un destino o hotel del catálogo. Escribir su nombre no es suficiente.
- Los contadores crean los campos de edad al usar sus botones; llenar solo el número no reproduce el flujo.
- El portal muestra inicialmente propuestas mientras busca. No deben capturarse como resultado completo.
- La lista puede mostrar importes redondeados. El conversor de moneda de cada tarifa expone el importe exacto; el piloto conserva sus centavos y rechaza importes ambiguos o monedas diferentes.
- Cada habitación y plan tiene su tarifa y política. Consultar una política no valida el resto de opciones.
- El formulario de traslados exige confirmar los dos selectores de hora. Puede devolver un horario diferente al solicitado o pendiente de determinar.
- Cada horario tiene un botón para computadora y una copia oculta para móvil. El piloto selecciona solo los dos botones visibles y comprueba su cantidad antes de continuar. En Windows se reprodujo otro fallo: `filter({ has: panel.locator(...) })` busca el panel dentro de cada botón y devuelve cero controles. La excepción local era «No se encontraron exactamente dos selectores de hora visibles». Se corrigió con `button:has(input.hour-selector-text)` dentro del panel, conservando el filtro de visibilidad. Una prueba con Edge real y HTML sintético reproduce el selector anterior y valida la corrección sin datos de cuenta.
- CMD muestra cada paso de traslados. Ante un fallo, el JSON conserva `diagnostics` con el paso y una clasificación segura (`TIMEOUT`, `STEP_FAILED` o `TIME_CONTROL_COUNT`); esta última incluye únicamente la cantidad numérica de controles. No guarda mensajes internos, URLs de sesión ni trazas del navegador. La ventana distingue una consulta parcial de un fallo total.
- Una opción redonda puede combinar compartido y privado. El importe es por todos los pasajeros y ambos trayectos; no se duplica.
- Hay productos cuyo nombre indica 18+ aunque la búsqueda incluya menores. El piloto los descarta; otras restricciones requieren revisión humana.
- Existe exportación nativa de hoteles en PDF, abierta en otra pestaña. No es un endpoint de disponibilidad.

## Comprobación local en Windows

El 26 de noviembre de 2026 se ejecutó `npm.cmd run rv:pilot` desde CMD con Node.js 26.12.0, Playwright 1.65.1 y Edge instalado (Chrome no estaba instalado). Después del inicio de sesión manual, la ejecución terminó con código 0: dos tarifas hoteleras y doce opciones de traslado, sin descartes, errores ni diagnósticos. Se confirmaron ambos selectores de hora y se validó el encabezado del proveedor con ruta, fechas y ocupación antes de normalizar los resultados. No se reservaron productos ni se usó el carrito. Los resultados quedaron únicamente en `data/rv-pilot/`, excluida de Git.

Los resultados incluyeron horarios por determinar y horarios distintos del solicitado; se conservaron las advertencias correspondientes. La base validada se conservó en el commit `db16462` del PR #2. La interfaz continúa en modo demo.

### Cancelación aislada

`server/providers/rv-cancellation.mjs` consulta únicamente el control `.js-condition-policy` de la primera tarifa capturada. Antes y después valida hotel, código público de hotel, habitación, alimentos, ocupación, importe exacto y moneda. Conserva una referencia a esa fila del DOM: si se reemplaza, no continúa con la fila que ocupe su lugar. Solo acepta un aviso contenido en el control o vinculado mediante `aria-describedby`/`aria-controls`; rechaza referencias compartidas, varios avisos y políticas globales sin asociación. Los identificadores de los tooltips se usan en memoria y no se exportan.

El resultado distingue `cancellationStatus: captured` de `pending`; este último incluye un motivo seguro y conserva la advertencia. Una marca de no reembolsable no equivale a haber obtenido la política completa. Las restantes tarifas siguen pendientes y no heredan el aviso de la primera.

La ejecución autenticada final en Edge completó dos tarifas hoteleras y doce traslados con código 0. La cancelación quedó pendiente con `rate-changed`: la fila fue reemplazada durante la consulta. No se guardó ningún aviso como política de esa tarifa. Pasaron las 31 pruebas, incluidas regresiones con Edge real sobre HTML sintético para cambios de fila, reordenamientos, políticas ajenas y asociaciones ambiguas. También pasó el build de producción. Esta evidencia complementa la ejecución autenticada; las pruebas por sí solas no validan al proveedor.

### Cotejo local de tarifas

Se cotejó una tarifa hotelera y una de traslado mediante lecturas separadas del portal y sus resultados normalizados: importe exacto del conversor (`data-amount`), MXN, ocupación, fechas del encabezado y habitación/plan del hotel. También se comprobó que las etiquetas visibles en MXN coinciden con esos importes redondeados a pesos enteros. En el traslado se cotejaron ambos trayectos de la misma tarjeta y el mismo importe mostrado en sus dos vistas, conservado una sola vez como total redondo para la ocupación indicada. No se multiplicó por pasajeros ni por trayectos. Los horarios de esa opción estaban por determinar.

El cotejo conserva sus detalles exclusivamente en `data/rv-pilot/`, ignorada por Git. No se incluyen tarifas de cuenta, HTML, resultados ni identificadores de sesión en el repositorio. Los centavos provienen del conversor del portal; una etiqueta redondeada no demuestra por sí sola el importe exacto. Este cotejo no constituye revalidación para venta ni confirma cargos posteriores, comisión o condiciones contractuales.

## Límite de esta entrega

El piloto aún no activa precios reales en la interfaz ni genera cotizaciones para clientes. Captura una muestra de tarifas visibles del hotel solicitado, sin recorrer todo el inventario ni todas las páginas. El cotejo cubre una tarifa de cada servicio. Falta revalidar precios y condiciones para venta, completar las políticas de cancelación, confirmar si algún hotel incluye traslados, definir precios/comisiones de la cuenta y validar la relación de horarios con vuelos. Después se integrará el resultado normalizado al cotizador y su exportación Excel.

Referencias públicas consultadas:

- https://www.rvonline.mx/
- https://www.rvonline.mx/content/content.aspx?id=39037
- https://api-edocs.ejuniper.com/
- https://playwright.dev/docs/browsers
- https://playwright.dev/docs/locators

No subir los JSON de resultados, credenciales, capturas de la cuenta o cotizaciones privadas a GitHub.
