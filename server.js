require("dotenv").config();

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { DefaultAzureCredential } = require("@azure/identity");
const { AIProjectClient } = require("@azure/ai-projects");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR =
    process.env.DATA_DIR ||
    path.join(__dirname, "data");
const FACTURAS_CSV_PATH =
    process.env.FACTURAS_CSV_PATH ||
    path.join(DATA_DIR, "facturas-procesadas.csv");
const REQUIRE_ENTRA_AUTH =
    process.env.REQUIRE_ENTRA_AUTH === "true";
const CSV_HEADER =
    "folio,proveedor,fecha,rfc,subtotal,iva,total,moneda,nivel_confianza,estado_revision,duplicado,fecha_procesamiento,archivo_origen,observaciones,tipo_registro,conceptos_json\n";

fs.mkdirSync(path.dirname(FACTURAS_CSV_PATH), {
    recursive: true
});

if (!fs.existsSync(FACTURAS_CSV_PATH)) {
    fs.writeFileSync(FACTURAS_CSV_PATH, CSV_HEADER, "utf8");
}

app.set("trust proxy", 1);
app.use(express.json({ limit: "16kb" }));

const rutasInternas =
    new Set([
        "/proveedor.html",
        "/admin.html",
        "/registrar-factura",
        "/subir-factura",
        "/guardar-factura",
        "/historial"
    ]);

function esRutaInterna(ruta) {
    return rutasInternas.has(ruta) ||
        ruta.startsWith("/consultar-folio/");
}

app.use((req, res, next) => {
    if (
        REQUIRE_ENTRA_AUTH &&
        esRutaInterna(req.path) &&
        !req.get("x-ms-client-principal-id")
    ) {
        if (
            req.method === "GET" &&
            (req.path === "/proveedor.html" ||
                req.path === "/admin.html")
        ) {
            const destino =
                encodeURIComponent(`${req.originalUrl}`);
            return res.redirect(
                `/.auth/login/aad?post_login_redirect_uri=${destino}`
            );
        }

        return res.status(401).json({
            error: "Inicia sesión con tu cuenta de la organización para acceder a las funciones de facturación."
        });
    }

    next();
});

app.use(express.static(PUBLIC_DIR));

const solicitudesChat = new Map();
const ventanaLimiteChatMs = 60 * 1000;
const limiteSolicitudesChat = 20;

app.use("/chat", (req, res, next) => {
    if (req.method !== "POST") return next();

    const ahora = Date.now();
    const llave = req.ip;
    let limite = solicitudesChat.get(llave);

    if (!limite || ahora - limite.inicio >= ventanaLimiteChatMs) {
        limite = { inicio: ahora, solicitudes: 0 };
    }

    limite.solicitudes += 1;
    solicitudesChat.set(llave, limite);

    if (solicitudesChat.size > 10000) {
        for (const [ip, registro] of solicitudesChat) {
            if (ahora - registro.inicio >= ventanaLimiteChatMs) {
                solicitudesChat.delete(ip);
            }
        }
    }

    if (limite.solicitudes > limiteSolicitudesChat) {
        res.set(
            "Retry-After",
            String(Math.ceil(
                (ventanaLimiteChatMs - (ahora - limite.inicio)) / 1000
            ))
        );
        return res.status(429).json({
            respuesta: "Se alcanzó el límite temporal de consultas. Espera un minuto e inténtalo de nuevo."
        });
    }

    next();
});

const solicitudesFactura = new Map();
const ventanaLimiteFacturaMs = 60 * 1000;
const limiteSolicitudesFactura = 5;

app.use("/subir-factura", (req, res, next) => {
    if (req.method !== "POST") return next();

    const ahora = Date.now();
    const llave = req.ip;
    let limite = solicitudesFactura.get(llave);

    if (!limite || ahora - limite.inicio >= ventanaLimiteFacturaMs) {
        limite = { inicio: ahora, solicitudes: 0 };
    }

    limite.solicitudes += 1;
    solicitudesFactura.set(llave, limite);

    if (limite.solicitudes > limiteSolicitudesFactura) {
        res.set(
            "Retry-After",
            String(Math.ceil(
                (ventanaLimiteFacturaMs - (ahora - limite.inicio)) / 1000
            ))
        );
        return res.status(429).json({
            error: "Se alcanzó el límite temporal de análisis de facturas. Espera un minuto e inténtalo de nuevo."
        });
    }

    next();
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const directorioTemporal =
            path.join(os.tmpdir(), "rio-claro-uploads");
        fs.mkdirSync(directorioTemporal, { recursive: true });
        cb(null, directorioTemporal);
    },
    filename: (req, file, cb) => {
        cb(
            null,
            `${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`
        );
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 8 * 1024 * 1024,
        files: 1
    }
});

function extraerCampo(texto, campo) {

    const textoNormalizado =
        String(texto || "")
            .replace(/\*\*/g, "");

    const regex = new RegExp(
        `^\\s*(?:[-*]\\s*)?${campo}\\s*:\\s*(.*?)\\s*$`,
        "im"
    );

    const match =
        textoNormalizado.match(regex);

    return match
        ? match[1].trim()
        : "";
}

function limpiarNumero(valor) {

    if (!valor) return null;

    const numero =
        Number(
        valor
            .replace(/,/g, "")
            .replace("$", "")
            .trim()
    );

    return Number.isFinite(numero)
        ? numero
        : null;

}

function normalizarFolio(valor) {
    return String(valor || "")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[‐‑‒–—―−]/g, "-")
        .replace(/\s*-\s*/g, "-")
        .trim()
        .toLowerCase();
}

function normalizarIdentificador(valor) {
    return String(valor || "")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toUpperCase();
}

function normalizarRfc(valor) {
    const rfc =
        String(valor || "")
            .trim()
            .toUpperCase()
            .replace(/[\s-]/g, "");

    return /^[A-ZÑ&0-9]{12,13}$/.test(rfc)
        ? rfc
        : "";
}

function esMismaFactura(registro, factura) {
    if (
        normalizarFolio(registro[0]) !==
        normalizarFolio(factura.folio)
    ) {
        return false;
    }

    if (String(registro[14] || "").toUpperCase() === "DIGITAL") {
        return false;
    }

    const rfcExistente = normalizarRfc(registro[3]);
    const rfcNuevo = normalizarRfc(factura.rfc);

    if (rfcExistente && rfcNuevo) {
        return rfcExistente === rfcNuevo;
    }

    const proveedorExistente =
        normalizarIdentificador(registro[1]);
    const proveedorNuevo =
        normalizarIdentificador(factura.proveedor);

    return Boolean(proveedorExistente) &&
        proveedorExistente === proveedorNuevo;
}

function parsearLineaCsv(linea) {
    const campos = [];
    let campo = "";
    let entreComillas = false;

    for (let i = 0; i < linea.length; i++) {
        const caracter = linea[i];

        if (caracter === '"') {
            if (entreComillas && linea[i + 1] === '"') {
                campo += '"';
                i++;
            } else {
                entreComillas = !entreComillas;
            }
        } else if (caracter === "," && !entreComillas) {
            campos.push(campo);
            campo = "";
        } else {
            campo += caracter;
        }
    }

    campos.push(campo);
    return campos;
}

function escaparCampoCsv(valor) {
    return `"${String(valor ?? "")
        .replace(/[\r\n]+/g, " ")
        .replace(/"/g, '""')}"`;
}

function fechaActualLocal() {
    const ahora = new Date();
    const anio = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, "0");
    const dia = String(ahora.getDate()).padStart(2, "0");

    return `${anio}-${mes}-${dia}`;
}

/* ====================================
   CHATBOT RÍO CLARO
==================================== */

app.post(
    "/chat",
    async (req, res) => {

        try {

            const pregunta =
                typeof req.body?.pregunta === "string"
                    ? req.body.pregunta.trim()
                    : "";

            if (!pregunta || pregunta.length > 2000) {
                return res.status(400).json({
                    respuesta: "Escribe una pregunta de hasta 2,000 caracteres."
                });
            }

            const projectClient =
                new AIProjectClient(
                    process.env.PROJECT_ENDPOINT,
                    new DefaultAzureCredential(),
                    {
                        allowPreview: true
                    }
                );

            const openaiClient =
                projectClient.getOpenAIClient({
                    azureConfig: {
                        agentName:
                            process.env.AGENT_NAME,
                        allowPreview: true
                    }
                });

            const response =
                await openaiClient.responses.create({
                    model: "gpt-4.1-mini-1",
                    input: `
Responde al siguiente mensaje en español con un tono cálido, natural y conversacional. Habla de forma cercana y sencilla, como el equipo de atención de Distribuidora Río Claro, sin afirmar que eres una persona real. Evita respuestas rígidas, demasiado formales o genéricas. Ve directo a lo que necesita, explica los pasos prácticos con claridad y usa párrafos breves. Si ayuda, reconoce brevemente su situación y ofrece ayuda adicional. No repitas toda la consulta ni uses frases de relleno.

Usa primero la información y los documentos de conocimiento del agente para responder a clientes y empleados sobre políticas, compras, facturas y procesos de Río Claro. Adapta los pasos al contexto de quien pregunta; si no está claro y afecta la respuesta, pide una aclaración. No compartas información confidencial interna con clientes. En preguntas sobre políticas, incluye los plazos y requisitos exactos de esos documentos; no los reemplaces por expresiones vagas.

Si preguntan por un producto específico, sus características, compatibilidad o información general y esos datos no están en el conocimiento de Río Claro, utiliza la herramienta de búsqueda web antes de responder. Da prioridad a la página oficial del fabricante y a fuentes confiables; resume lo relevante en tus propias palabras e indica las fuentes consultadas cuando estén disponibles. Si el producto o la pregunta no están suficientemente identificados, pide una aclaración en vez de adivinar.

La búsqueda web no confirma el catálogo, inventario, precios ni promociones de Distribuidora Río Claro. No afirmes que un producto está disponible, que Río Claro lo vende ni cuál es su precio salvo que esa información aparezca en las fuentes internas. Separa claramente los datos públicos del producto de lo que no puedes confirmar sobre Río Claro, y ofrece ayudar a consultar disponibilidad por un canal oficial.

No inventes condiciones, precios, plazos ni promesas. Si la búsqueda no encuentra una fuente fiable, dilo con claridad y explica qué dato falta.

Mensaje de la persona:
${pregunta}
                    `.trim()
                });

            res.json({
                respuesta:
                    response.output_text ||
                    "No pude preparar una respuesta en este momento. ¿Podrías intentarlo de nuevo?"
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                respuesta:
                    "No fue posible consultar el asistente."
            });

        }

    }
);

/* ====================================
   ANALIZAR FACTURA
==================================== */

app.post(
    "/registrar-factura",
    (req, res) => {
        try {
            if (
                !req.body ||
                typeof req.body !== "object" ||
                Array.isArray(req.body)
            ) {
                return res.status(400).json({
                    error: "Los datos enviados para la factura no son válidos."
                });
            }

            const cliente =
                String(req.body.cliente || "").trim();

            const rfc =
                String(req.body.rfc || "")
                    .trim()
                    .toUpperCase();

            const conceptosEntrada =
                req.body.conceptos;

            if (!cliente || cliente.length > 150) {
                return res.status(400).json({
                    error: "Ingresa el nombre del cliente o razón social (máximo 150 caracteres)."
                });
            }

            if (
                !/^[A-ZÑ&0-9]{12,13}$/.test(rfc)
            ) {
                return res.status(400).json({
                    error: "Ingresa un RFC de 12 o 13 caracteres, sin espacios ni guiones."
                });
            }

            if (
                !Array.isArray(conceptosEntrada) ||
                conceptosEntrada.length === 0 ||
                conceptosEntrada.length > 50
            ) {
                return res.status(400).json({
                    error: "Agrega entre 1 y 50 conceptos a la factura."
                });
            }

            const conceptos = [];

            for (const concepto of conceptosEntrada) {
                if (
                    !concepto ||
                    typeof concepto !== "object" ||
                    Array.isArray(concepto)
                ) {
                    return res.status(400).json({
                        error: "Cada concepto debe incluir descripción, cantidad, precio e impuesto."
                    });
                }

                const descripcion =
                    String(concepto.descripcion || "").trim();
                const cantidad =
                    Number(concepto.cantidad);
                const precioUnitario =
                    Number(concepto.precioUnitario);
                const impuestoPorcentaje =
                    Number(concepto.impuestoPorcentaje);

                if (
                    !descripcion ||
                    descripcion.length > 200 ||
                    !Number.isFinite(cantidad) ||
                    cantidad <= 0 ||
                    cantidad > 1000000 ||
                    !Number.isFinite(precioUnitario) ||
                    precioUnitario < 0 ||
                    precioUnitario > 1000000000 ||
                    !Number.isFinite(impuestoPorcentaje) ||
                    impuestoPorcentaje < 0 ||
                    impuestoPorcentaje > 100
                ) {
                    return res.status(400).json({
                        error: "Revisa la descripción, cantidad, precio e impuesto de cada concepto."
                    });
                }

                const importeCentavos =
                    Math.round(cantidad * precioUnitario * 100);
                const impuestoCentavos =
                    Math.round(
                        importeCentavos * impuestoPorcentaje / 100
                    );

                conceptos.push({
                    descripcion,
                    cantidad,
                    precioUnitario:
                        Math.round(precioUnitario * 100) / 100,
                    impuestoPorcentaje,
                    importe:
                        importeCentavos / 100,
                    impuesto:
                        impuestoCentavos / 100
                });
            }

            const subtotalCentavos =
                conceptos.reduce(
                    (total, concepto) =>
                        total + Math.round(concepto.importe * 100),
                    0
                );
            const impuestosCentavos =
                conceptos.reduce(
                    (total, concepto) =>
                        total + Math.round(concepto.impuesto * 100),
                    0
                );

            if (subtotalCentavos <= 0) {
                return res.status(400).json({
                    error: "El subtotal de la factura debe ser mayor a cero."
                });
            }

            const contenido =
                fs.readFileSync(
                    FACTURAS_CSV_PATH,
                    "utf8"
                );
            const lineas =
                contenido.split(/\r?\n/).filter(Boolean);
            const anio =
                new Date().getFullYear();
            const prefijo =
                `RC-${anio}-`;
            let consecutivo = 0;

            for (const linea of lineas.slice(1)) {
                const existente =
                    parsearLineaCsv(linea)[0] || "";
                const coincidencia =
                    existente.match(
                        new RegExp(`^RC-${anio}-(\\d+)$`, "i")
                    );

                if (coincidencia) {
                    consecutivo = Math.max(
                        consecutivo,
                        Number(coincidencia[1])
                    );
                }
            }

            const folio =
                `${prefijo}${String(consecutivo + 1).padStart(6, "0")}`;
            const fecha =
                fechaActualLocal();
            const subtotal =
                (subtotalCentavos / 100).toFixed(2);
            const iva =
                (impuestosCentavos / 100).toFixed(2);
            const total =
                ((subtotalCentavos + impuestosCentavos) / 100).toFixed(2);
            const nuevaLinea = [
                folio,
                cliente,
                fecha,
                rfc,
                subtotal,
                iva,
                total,
                "MXN",
                "Alta",
                "Pendiente",
                "No",
                fecha,
                "portal-facturacion",
                "Registro digital interno; no es un CFDI",
                "DIGITAL",
                JSON.stringify(conceptos)
            ]
                .map(escaparCampoCsv)
                .join(",");

            fs.appendFileSync(
                FACTURAS_CSV_PATH,
                `${contenido.endsWith("\n") ? "" : "\n"}${nuevaLinea}\n`
            );

            res.status(201).json({
                folio,
                cliente,
                rfc,
                fecha,
                subtotal,
                iva,
                total,
                moneda: "MXN",
                tipoRegistro: "DIGITAL",
                cfdi: false,
                conceptos
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                error: "No fue posible registrar la factura."
            });
        }
    }
);

app.post(
    "/subir-factura",
    upload.single("factura"),
    async (req, res) => {

        let filesClient = null;
        let uploadedFileId = null;

        try {
            if (!req.file) {
                return res.status(400).json({
                    error: "Selecciona una factura en formato PDF."
                });
            }

            if (
                path.extname(req.file.originalname).toLowerCase() !== ".pdf" ||
                req.file.mimetype !== "application/pdf"
            ) {
                return res.status(415).json({
                    error: "Por el momento, solo se pueden analizar facturas en formato PDF."
                });
            }

            const projectClient =
                new AIProjectClient(
                    process.env.PROJECT_ENDPOINT,
                    new DefaultAzureCredential(),
                    {
                        allowPreview: true
                    }
                );

            filesClient =
                projectClient.getOpenAIClient();

            const archivo =
                fs.createReadStream(
                    req.file.path
                );

            const file =
                await filesClient.files.create({
                    file: archivo,
                    purpose: "assistants"
                });
            uploadedFileId = file.id;

            const response =
                await filesClient.responses.create({
                    model: "gpt-4.1-mini-1",
                    input: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "input_text",
                                    text: `
Analiza esta factura y responde únicamente:
No inventes datos. Si el RFC no es legible o no aparece, deja ese campo vacío.

Proveedor:
RFC:
Folio:
Fecha:
Subtotal:
IVA:
Total:
`
                                },
                                {
                                    type: "input_file",
                                    file_id: file.id
                                }
                            ]
                        }
                    ]
                });

            const texto =
                response.output_text;

            const proveedor =
                extraerCampo(
                    texto,
                    "Proveedor"
                );

            const rfc =
                normalizarRfc(extraerCampo(
                    texto,
                    "RFC"
                ));

            const folio =
                extraerCampo(
                    texto,
                    "Folio"
                );

            const fecha =
                extraerCampo(
                    texto,
                    "Fecha"
                );

            const subtotalTexto =
                extraerCampo(
                    texto,
                    "Subtotal"
                );

            const ivaTexto =
                extraerCampo(
                    texto,
                    "IVA"
                );

            const totalTexto =
                extraerCampo(
                    texto,
                    "Total"
                );

            const subtotal =
                limpiarNumero(
                    subtotalTexto
                );

            const iva =
                limpiarNumero(
                    ivaTexto
                );

            const total =
                limpiarNumero(
                    totalTexto
                );

            if (
                !proveedor ||
                !folio ||
                !fecha ||
                subtotal === null ||
                iva === null ||
                total === null
            ) {
                return res.status(422).json({
                    error:
                        "No se pudieron identificar todos los datos de la factura. Verifique que el archivo sea legible e inténtelo de nuevo."
                });
            }

            const totalFormateado =
                total.toFixed(2);

            const contenido =
                fs.readFileSync(
                    FACTURAS_CSV_PATH,
                    "utf8"
                );

            const lineas =
                contenido.split(/\r?\n/).filter(Boolean);

            const facturaAnalizada = {
                proveedor,
                rfc,
                folio
            };

            const duplicado =
                lineas
                    .slice(1)
                    .map(parsearLineaCsv)
                    .some(registro =>
                        esMismaFactura(registro, facturaAnalizada)
                    );

            const registrar =
                req.body.registrar === "true";

            if (registrar && !duplicado) {
                const nuevaLinea = [
                    folio,
                    proveedor,
                    fecha,
                    rfc || "SIN-RFC",
                    subtotal.toFixed(2),
                    iva.toFixed(2),
                    totalFormateado,
                    "MXN",
                    "Alta",
                    "Pendiente",
                    "No",
                    new Date().toISOString().split("T")[0],
                    path.basename(req.file.originalname),
                    "Factura recibida de proveedor",
                    "CARGADA",
                    JSON.stringify([])
                ]
                    .map(escaparCampoCsv)
                    .join(",");

                fs.appendFileSync(
                    FACTURAS_CSV_PATH,
                    `${contenido.endsWith("\n") ? "" : "\n"}${nuevaLinea}\n`
                );
            }

            res.json({
                proveedor,
                rfc,
                folio,
                fecha,
                subtotal:
                    subtotal.toFixed(2),
                iva:
                    iva.toFixed(2),
                total: totalFormateado,
                duplicado,
                registrada:
                    registrar && !duplicado
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error:
                    error.message
            });

        } finally {
            if (uploadedFileId && filesClient) {
                try {
                    await filesClient.files.delete(uploadedFileId);
                } catch (error) {
                    console.error(
                        "No fue posible eliminar el archivo temporal de Foundry.",
                        error
                    );
                }
            }

            if (req.file?.path && fs.existsSync(req.file.path)) {
                try {
                    fs.unlinkSync(req.file.path);
                } catch (error) {
                    console.error(
                        "No fue posible eliminar el archivo temporal de factura.",
                        error
                    );
                }
            }
        }

    }
);

/* ====================================
   GUARDAR FACTURA
==================================== */

app.post(
    "/guardar-factura",
    (req, res) => {

        const factura =
            req.body;

        if (
            !factura ||
            !factura.folio ||
            !factura.proveedor ||
            !factura.fecha ||
            !factura.subtotal ||
            !factura.iva ||
            !factura.total
        ) {
            return res.status(400).json({
                error: "Faltan datos para guardar la factura."
            });
        }

        const contenido =
            fs.readFileSync(
                FACTURAS_CSV_PATH,
                "utf8"
            );
        const duplicado =
            contenido
                .split(/\r?\n/)
                .filter(Boolean)
                .slice(1)
                .map(parsearLineaCsv)
                .some(registro =>
                    esMismaFactura(registro, factura)
                );

        if (duplicado) {
            return res.status(409).json({
                error: "Ya existe una factura de este proveedor con el mismo folio."
            });
        }

        const nuevaLinea = [
            factura.folio,
            factura.proveedor,
            factura.fecha,
            normalizarRfc(factura.rfc) || "SIN-RFC",
            factura.subtotal,
            factura.iva,
            factura.total,
            "MXN",
            "Alta",
            "Pendiente",
            factura.duplicado ? "Si" : "No",
            new Date().toISOString().split("T")[0],
            "web-app",
            "Guardada desde Rio Claro AI",
            "CARGADA",
            JSON.stringify([])
        ]
            .map(escaparCampoCsv)
            .join(",");

        fs.appendFileSync(
            FACTURAS_CSV_PATH,
            `${contenido.endsWith("\n") ? "" : "\n"}${nuevaLinea}\n`
        );

        res.json({
            mensaje:
                "Factura guardada correctamente"
        });

    }
);

/* ====================================
   HISTORIAL
==================================== */

app.get(
    "/historial",
    (req, res) => {

        try {

            const contenido =
                fs.readFileSync(
                    FACTURAS_CSV_PATH,
                    "utf8"
                );

            res
                .type("text/csv")
                .set("X-Content-Type-Options", "nosniff")
                .send(contenido);

        } catch (error) {

            res.status(500).json({
                error:
                    error.message
            });

        }

    }
);

/* ====================================
   CONSULTAR FOLIO
==================================== */

app.get(
    "/consultar-folio/:folio",
    (req, res) => {

        try {

            const folioBuscado =
                normalizarFolio(
                    req.params.folio
                );

            const contenido =
                fs.readFileSync(
                    FACTURAS_CSV_PATH,
                    "utf8"
                );

            const lineas =
                contenido
                    .split("\n")
                    .filter(
                        linea =>
                            linea.trim() !== ""
                    );

            let factura =
                null;

            for (
                let i = 1;
                i < lineas.length;
                i++
            ) {

                const c =
                    parsearLineaCsv(lineas[i]);

                const folio =
                    normalizarFolio(c[0]);

                if (
                    folio ===
                    folioBuscado
                ) {

                    factura = {

                        folio:
                            c[0],

                        proveedor:
                            c[1],

                        rfc:
                            c[3],

                        fecha:
                            c[2],

                        subtotal:
                            c[4],

                        iva:
                            c[5],

                        total:
                            c[6],

                        duplicado:
                            c[10],

                        tipoRegistro:
                            c[14] || "CARGADA",

                        conceptos:
                            c[15]
                                ? JSON.parse(c[15])
                                : []

                    };

                    break;

                }

            }

            if (!factura) {

                return res
                    .status(404)
                    .json({
                        mensaje:
                            "Folio no encontrado"
                    });

            }

            res.json(
                factura
            );

        } catch (error) {

            res.status(500).json({
                error:
                    error.message
            });

        }

    }
);

app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        const estado =
            error.code === "LIMIT_FILE_SIZE"
                ? 413
                : 400;
        return res.status(estado).json({
            error: estado === 413
                ? "El archivo supera el límite de 8 MB."
                : "No se pudo recibir el archivo de factura."
        });
    }

    console.error("Error no controlado en la solicitud.", error);
    if (res.headersSent) return next(error);

    res.status(500).json({
        error: "Ocurrió un error interno. Inténtalo de nuevo."
    });
});

app.get("/healthz", (req, res) => {
    res.json({ status: "ok" });
});

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Servidor ejecutándose en http://localhost:${PORT}`
        );

    }
);
