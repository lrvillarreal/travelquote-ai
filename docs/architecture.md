# Arquitectura y alcance acordado

## Objetivo

Ahorrar captura repetitiva al preparar propuestas de hotel, hotel con traslados, o vuelos con hotel y traslados. El usuario selecciona los servicios y conserva la decisión sobre las opciones finales.

## Primera versión

React + TypeScript en navegador, API Node.js y SQLite en la misma computadora. El proceso local ejecutará posteriormente los conectores de proveedores. Las consultas se dirigirán con reglas: RV Online para hotel y traslado redondo aeropuerto-hotel-aeropuerto; Viva Aerobus para vuelos.

La interfaz no invoca proveedores ni OpenAI directamente. El generador de Excel recibe una instantánea validada por el backend. Los importes se calculan en centavos y se rechazan monedas diferentes. Los datos demo no se pueden presentar como una reserva o tarifa real.

## IA y costos

La versión 0.1 no contiene cliente OpenAI ni admite habilitar IA mediante una variable. `/api/ai` siempre rechaza solicitudes. La futura asistencia será opcional para interpretar solicitudes, explicar alternativas y redactar. La búsqueda, selección, cálculos, historial y exportación deben seguir funcionando sin IA.

Antes de habilitarla: presupuesto configurado por el usuario, reserva de consumo estimado antes de cada llamada, límite de llamadas por acción, deduplicación de solicitudes iguales, límites de salida y reintentos, registro del uso real y bloqueo ante consumo no conciliado. Los precios de los proveedores se revalidan por separado de las respuestas reutilizadas de IA.

## Proveedores reales pendientes

1. Revisar una sesión de RV Online y determinar API oficial o automatización permitida.
2. Identificar autenticación, verificación, formulario, impuestos, moneda, cancelaciones y precios netos/finales.
3. Integrar una búsqueda real y cotejarla manualmente.
4. Modelar paquetes de proveedor que incluyan hotel y traslado para impedir doble conteo. La demostración actual contiene solo servicios independientes.
5. Evaluar Viva Aerobus, equipaje, tasas, tarifas por edad y horarios.
6. Validar aeropuerto, llegada al hotel, regreso y tiempos de traslado antes de emitir propuestas reales.

No se asumirá que todos los sitios aceptan automatización ni que una API es gratuita. Una intervención de usuario será necesaria si el proveedor exige verificación. No se intentarán eludir restricciones del portal.

## Fases

1. Revisión de este flujo demo y reglas comerciales.
2. Prueba de viabilidad de RV Online con la cuenta de la agencia.
3. Conector real de hotel y traslados e historial de procedencia y vigencia.
4. Plantilla final de Excel, logo y términos proporcionados por la agencia.
5. Conector Viva Aerobus y validación de compatibilidad del itinerario.
6. Asistencia IA opcional si aporta ahorro medible.
7. Piloto y decisión sobre alojamiento remoto.

## GitHub y Vercel

Repositorio indicado por el usuario: https://github.com/lrvillarreal/travelquote-ai . La rama de integración es la rama por defecto del repositorio (`main`). Entregas coherentes por fase, con pruebas en GitHub Actions. Los cambios futuros se revisarán con ramas y pull requests.

El frontend puede compilarse para Vercel. No se conecta un frontend público al backend local mediante CORS abierto ni se publican puertos de la computadora. El uso operativo de la agencia requiere un plan apto para uso comercial. SQLite y sesiones permanecen locales en esta arquitectura; un despliegue completo requiere almacenamiento persistente y un ejecutor de navegador separados.
