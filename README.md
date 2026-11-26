# Viajes AGYL · TravelQuote

Aplicación de cotizaciones vacacionales. Primera entrega: flujo funcional de demostración, sin llamadas de IA y sin conexión a proveedores reales.

## Estado de esta fase

- Selección independiente de hotel, traslados y vuelos.
- Datos del viaje, ocupación por habitación y edades de niños.
- Enrutamiento: hoteles y traslados a RV Online; vuelos a Viva Aerobus.
- Ofertas **ficticias** calculadas para la solicitud. No representan disponibilidad ni tarifas reales.
- Selección de una opción por servicio, ajuste comercial fijo opcional y validación del total en el servidor.
- Historial local en SQLite y exportación Excel con nombre, logo opcional y condiciones de la agencia.
- Los documentos llevan una advertencia de demostración. No son válidos para venta.
- IA desactivada. No se necesita API key y el código no realiza llamadas a OpenAI.

## Abrir en Windows con doble clic

Con Node.js 24 LTS instalado, abre `ABRIR_TRAVELQUOTE.cmd`. La primera vez instala las dependencias fijadas en `package-lock.json`, compila la interfaz y abre el navegador cuando el servidor responde. Conserva la ventana abierta durante el uso; Ctrl+C detiene la app. Si aparece un error, la ventana permanece abierta para leerlo.

El arranque comprueba la respuesta local con un limite de 5 segundos. Si el entorno de ejecucion bloquea localhost, ejecuta el archivo directamente en Windows desde la carpeta del proyecto.

## Ejecutar desde PowerShell

Instala Node.js 24 LTS desde su fuente oficial. Desde PowerShell, en la carpeta del proyecto:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run dev
```

Abre http://127.0.0.1:4173. El servidor local corre en http://127.0.0.1:4180.

Para ejecutar la versión compilada:

```powershell
npm.cmd run build
npm.cmd start
```

Abre http://127.0.0.1:4180. La computadora debe permanecer encendida durante el uso. Las búsquedas y descargas requieren el backend local.

## Verificación

```powershell
npm.cmd test
npm.cmd run build
```

GitHub Actions verifica la lógica, compila la interfaz y prueba el servidor y la generación de Excel. Guarda el frontend compilado como artefacto de la ejecución. Las dependencias estan fijadas en package-lock.json; npm ci reproduce esa instalacion en Windows y GitHub Actions.

## Costos y Vercel

La opción inicial para operar sin hosting de pago es la ejecución local. Las herramientas locales no requieren suscripciones adicionales; se utiliza la computadora e internet existentes.

`vercel.json` configura **solo el frontend**. No publica el backend, SQLite, sesiones ni automatización. Una interfaz alojada en Vercel no queda conectada automáticamente a esta computadora. Una futura conexión remota requiere diseño de autenticación y transporte seguro.

Vercel indica que Hobby es para uso personal y no comercial: https://vercel.com/pricing . Antes de usarlo para la operación de la agencia hay que elegir un plan apto y revisar costos. No se ha contratado, configurado ni desplegado un servicio de pago.

## Seguridad y datos

- El servidor escucha solo en localhost y rechaza orígenes externos.
- `data/travelquote.sqlite` contiene los datos de esta instalación. Respaldar `data/` al cerrar la app.
- `data/`, `.env`, sesiones de navegador y resultados de prueba están excluidos de Git.
- No introducir credenciales en archivos del frontend, variables `VITE_`, Issues ni commits.
- No hay campos de contraseña en esta versión. Las sesiones de proveedores se implementarán después de validar el método de acceso.
- Las cotizaciones guardadas son instantáneas. Al cambiar datos del viaje se descartan los resultados y la selección actuales.
- El Excel del cliente no desglosa el costo del proveedor ni el ajuste comercial interno.
- El logo y las condiciones son editables por documento. El logo no se guarda en el repositorio.

## Estructura

```text
src/               Interfaz React + TypeScript
shared/domain.mjs  Validación, proveedores, ejemplos y cálculos
server/            API local, SQLite y exportador Excel
tests/             Pruebas de lógica e integración
docs/              Arquitectura, decisiones y fases
```

## Piloto de consulta real de RV Online

`PROBAR_RV_ONLINE.cmd` abre un navegador temporal para iniciar sesión y consultar un caso de hotel y traslados en Cancún. Guarda resultados locales para cotejarlos con el portal. La prueba manual del portal ya se realizó; falta validar este programa en Windows. La interfaz de cotizaciones continúa en modo demo. Instrucciones, alcance y límites: [docs/rv-pilot.md](docs/rv-pilot.md).

```bat
npm.cmd run rv:check
```

## Próxima fase

Validar con la agencia la interfaz, sus reglas comerciales y una búsqueda real de hotel y traslados en RV Online. La conexión a Viva Aerobus depende de una evaluación independiente de acceso y automatización. No se realizan reservas, compras ni envíos a clientes.
