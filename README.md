# Río Claro AI

Portal de demostración para atención al cliente y gestión de facturas. Incluye
un asistente conectado a Azure AI Foundry, recepción de facturas PDF y registro
digital interno para clientes.

## Requisitos

- Node.js 20, 21 o 22
- Un proyecto de Azure AI Foundry con un agente configurado
- Azure CLI para autenticarte localmente (`az login`) o credenciales de Azure
  disponibles para `DefaultAzureCredential`

## Ejecución local

1. Instala las dependencias:

   ```powershell
   npm install
   ```

2. Copia `.env.example` a `.env` y configura:

   - `PROJECT_ENDPOINT`: endpoint del proyecto de Foundry.
   - `AGENT_NAME`: nombre del agente.
   - `PORT`: puerto local (opcional; por defecto, `3000`).
   - `DATA_DIR`: directorio de datos local (opcional; por defecto, `data`).
   - `REQUIRE_ENTRA_AUTH`: `false` para la demo pública; `true` para proteger
     rutas con autenticación de App Service y Microsoft Entra.

3. Inicia el servidor:

   ```powershell
   npm start
   ```

4. Abre <http://localhost:3000/>.

El servidor usa `DefaultAzureCredential`; no necesita una clave de API en el
repositorio. Para desarrollo local, inicia sesión en Azure CLI con una cuenta
que tenga permiso para usar el proyecto de Foundry. En App Service puede
utilizarse una identidad administrada con los permisos correspondientes.

## Funciones

- Chat con el agente de Foundry, dictado por voz y lectura opcional de respuestas.
- Recepción de facturas PDF (máximo 8 MB), extracción de datos y comprobación
  de posibles duplicados.
- Registro digital interno para clientes; no genera un CFDI.
- Consulta de facturas por folio e historial.

## Datos y demo pública

La aplicación de demostración está disponible en
<https://rio-claro-practica-77486.azurewebsites.net/>.

La demo no requiere inicio de sesión para que pueda revisarse como práctica.
Quien la utiliza es responsable de los datos que ingresa y de contar con
autorización para compartirlos. Los registros guardados pueden ser consultados
por las personas con acceso al sitio. Evalúa cuidadosamente qué información
envías y no utilices esta demo como sistema de producción.

Los datos locales y archivos cargados no se incluyen en el repositorio. Al
iniciar el servidor, se crea el archivo CSV de datos en `DATA_DIR` si no existe.

## Publicación

Para desplegar en Azure App Service, configura las variables de aplicación
`PROJECT_ENDPOINT`, `AGENT_NAME`, `PORT` y `DATA_DIR`, además de asignar a la
identidad administrada del sitio los permisos necesarios para Foundry. No
almacenes secretos en el código ni en GitHub; utiliza la configuración protegida
del servicio o un almacén de secretos.
