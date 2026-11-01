const formFacturaDigital =
    document.getElementById("formFacturaDigital");
const listaConceptos =
    document.getElementById("listaConceptos");
const resultadoDigital =
    document.getElementById("resultadoDigital");
const formSubirFactura =
    document.getElementById("formSubirFactura");
const archivo =
    document.getElementById("archivo");
const resultado =
    document.getElementById("resultado");
const formConsultar =
    document.getElementById("formConsultar");
const folioConsulta =
    document.getElementById("folioConsulta");
const estadoFactura =
    document.getElementById("estadoFactura");
const formatoMoneda =
    new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN"
    });

function mostrarMensaje(contenedor, mensaje, esError = false) {
    const parrafo = document.createElement("p");
    parrafo.className = esError ? "error-mensaje" : "";
    parrafo.textContent = mensaje;
    contenedor.replaceChildren(parrafo);
}

function agregarCampoConcepto(contenedor, texto, tipo, nombre, valor, opciones = {}) {
    const etiqueta = document.createElement("label");
    etiqueta.className = "campo-formulario";
    etiqueta.textContent = texto;

    const entrada = document.createElement("input");
    entrada.type = tipo;
    entrada.name = nombre;
    entrada.value = valor;
    entrada.required = true;

    if (tipo === "number") {
        entrada.min = opciones.min ?? "0";
        entrada.step = opciones.step ?? "0.01";
    }

    etiqueta.appendChild(entrada);
    contenedor.appendChild(etiqueta);
    return entrada;
}

function agregarConcepto() {
    const tarjeta = document.createElement("div");
    tarjeta.className = "concepto-factura";

    const campos = document.createElement("div");
    campos.className = "concepto-campos";

    agregarCampoConcepto(
        campos,
        "Descripción",
        "text",
        "descripcion",
        "",
        {}
    ).maxLength = 200;
    agregarCampoConcepto(
        campos,
        "Cantidad",
        "number",
        "cantidad",
        "1",
        { min: "0.01", step: "0.01" }
    );
    agregarCampoConcepto(
        campos,
        "Precio unitario",
        "number",
        "precioUnitario",
        "0.00",
        { min: "0", step: "0.01" }
    );
    agregarCampoConcepto(
        campos,
        "Impuesto (%)",
        "number",
        "impuestoPorcentaje",
        "16",
        { min: "0", step: "0.01" }
    ).max = "100";

    const eliminar = document.createElement("button");
    eliminar.type = "button";
    eliminar.className = "boton-eliminar";
    eliminar.textContent = "Eliminar concepto";
    eliminar.addEventListener("click", () => {
        tarjeta.remove();
        actualizarTotales();
    });

    campos.addEventListener("input", actualizarTotales);
    tarjeta.append(campos, eliminar);
    listaConceptos.appendChild(tarjeta);
    actualizarTotales();
}

function leerConceptosFormulario() {
    return [...listaConceptos.querySelectorAll(".concepto-factura")].map(
        tarjeta => ({
            descripcion:
                tarjeta.querySelector('[name="descripcion"]').value.trim(),
            cantidad:
                Number(tarjeta.querySelector('[name="cantidad"]').value),
            precioUnitario:
                Number(tarjeta.querySelector('[name="precioUnitario"]').value),
            impuestoPorcentaje:
                Number(tarjeta.querySelector('[name="impuestoPorcentaje"]').value)
        })
    );
}

function calcularTotales(conceptos) {
    return conceptos.reduce(
        (totales, concepto) => {
            const importe =
                Math.round(
                    concepto.cantidad *
                    concepto.precioUnitario *
                    100
                ) / 100;
            const impuesto =
                Math.round(
                    importe *
                    concepto.impuestoPorcentaje
                ) / 100;

            totales.subtotal += importe;
            totales.impuestos += impuesto;
            return totales;
        },
        { subtotal: 0, impuestos: 0 }
    );
}

function actualizarTotales() {
    const totales =
        calcularTotales(leerConceptosFormulario());

    document.getElementById("subtotalVista").textContent =
        formatoMoneda.format(totales.subtotal);
    document.getElementById("impuestosVista").textContent =
        formatoMoneda.format(totales.impuestos);
    document.getElementById("totalVista").textContent =
        formatoMoneda.format(totales.subtotal + totales.impuestos);
}

function agregarConceptosAlResultado(tarjeta, conceptos) {
    if (!Array.isArray(conceptos) || conceptos.length === 0) return;

    const titulo =
        document.createElement("h4");
    titulo.textContent = "Conceptos";
    tarjeta.appendChild(titulo);

    const lista =
        document.createElement("ul");
    lista.className = "conceptos-consulta";

    for (const concepto of conceptos) {
        const elemento =
            document.createElement("li");
        const cantidad =
            Number(concepto.cantidad);
        const importe =
            Number(concepto.importe);
        elemento.textContent =
            `${concepto.descripcion} — ${cantidad} × ` +
            `${formatoMoneda.format(Number(concepto.precioUnitario))} ` +
            `= ${formatoMoneda.format(importe)}`;
        lista.appendChild(elemento);
    }

    tarjeta.appendChild(lista);
}

function mostrarFactura(contenedor, factura, titulo) {
    const tarjeta =
        document.createElement("div");
    tarjeta.className = "resultado-card";

    const encabezado =
        document.createElement("h3");
    encabezado.textContent = titulo;
    tarjeta.appendChild(encabezado);

    const campos = [
        ["Folio", factura.folio],
        [factura.tipoRegistro === "DIGITAL" ? "Cliente" : "Proveedor",
            factura.cliente || factura.proveedor],
        ["RFC", factura.rfc],
        ["Fecha", factura.fecha],
        ["Subtotal", formatoMoneda.format(Number(factura.subtotal))],
        ["Impuestos", formatoMoneda.format(Number(factura.iva))],
        ["Total", formatoMoneda.format(Number(factura.total))]
    ];

    for (const [etiqueta, valor] of campos) {
        if (valor == null || valor === "") continue;

        const parrafo =
            document.createElement("p");
        const textoEtiqueta =
            document.createElement("strong");
        textoEtiqueta.textContent = `${etiqueta}: `;
        parrafo.append(
            textoEtiqueta,
            document.createTextNode(String(valor))
        );
        tarjeta.appendChild(parrafo);
    }

    if (factura.duplicado) {
        const aviso = document.createElement("p");
        aviso.className = "aviso-interno";
        aviso.textContent =
            "Ya existe una factura de este proveedor con el mismo folio. No se registró otra vez.";
        tarjeta.appendChild(aviso);
    } else if (factura.registrada) {
        const aviso = document.createElement("p");
        aviso.className = "aviso-interno";
        aviso.textContent =
            "Factura registrada para revisión. La detección de duplicados no sustituye la aprobación de Cuentas por Pagar.";
        tarjeta.appendChild(aviso);
    }

    if (factura.tipoRegistro === "DIGITAL") {
        const aviso =
            document.createElement("p");
        aviso.className = "aviso-interno";
        aviso.textContent =
            "Registro digital interno. No es un CFDI ni un comprobante fiscal.";
        tarjeta.appendChild(aviso);
    }

    agregarConceptosAlResultado(tarjeta, factura.conceptos);
    contenedor.replaceChildren(tarjeta);
}

document
    .getElementById("btnAgregarConcepto")
    .addEventListener("click", agregarConcepto);

formFacturaDigital.addEventListener("submit", async event => {
    event.preventDefault();

    if (!formFacturaDigital.reportValidity()) return;

    const conceptos =
        leerConceptosFormulario();

    if (conceptos.some(concepto =>
        !concepto.descripcion ||
        concepto.cantidad <= 0 ||
        concepto.precioUnitario < 0 ||
        concepto.impuestoPorcentaje < 0 ||
        concepto.impuestoPorcentaje > 100
    )) {
        mostrarMensaje(
            resultadoDigital,
            "Revisa la descripción, cantidad, precio e impuesto de cada concepto.",
            true
        );
        return;
    }

    const boton =
        document.getElementById("btnCrearFactura");
    boton.disabled = true;
    boton.textContent = "Creando registro...";

    try {
        const respuesta = await fetch("/registrar-factura", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                cliente:
                    document.getElementById("nombreCliente").value.trim(),
                rfc:
                    document.getElementById("rfcCliente").value.trim(),
                conceptos
            })
        });
        const datos = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(
                datos.error || "No fue posible crear el registro de factura."
            );
        }

        mostrarFactura(
            resultadoDigital,
            datos,
            "Factura digital registrada"
        );
        folioConsulta.value = datos.folio;
        formFacturaDigital.reset();
        listaConceptos.replaceChildren();
        agregarConcepto();
    } catch (error) {
        mostrarMensaje(
            resultadoDigital,
            error.message || "No fue posible conectar con el servidor.",
            true
        );
    } finally {
        boton.disabled = false;
        boton.textContent = "Crear registro digital para cliente";
    }
});

formSubirFactura.addEventListener("submit", async event => {
    event.preventDefault();

    if (!archivo.files[0]) {
        mostrarMensaje(resultado, "Selecciona un archivo de factura.", true);
        return;
    }

    const formData = new FormData();
    formData.append("registrar", "true");
    formData.append("factura", archivo.files[0]);

    const boton =
        document.getElementById("btnAnalizar");
    boton.disabled = true;
    boton.textContent = "Analizando...";
    mostrarMensaje(resultado, "Estamos leyendo los datos de la factura...");

    try {
        const respuesta = await fetch("/subir-factura", {
            method: "POST",
            body: formData
        });
        const datos = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(
                datos.error || "No fue posible procesar la factura."
            );
        }

        mostrarFactura(resultado, {
            ...datos,
            tipoRegistro: "CARGADA"
        },         datos.duplicado
            ? "Posible factura duplicada"
            : "Factura de proveedor recibida");
        folioConsulta.value = datos.folio;
    } catch (error) {
        mostrarMensaje(
            resultado,
            error.message || "No fue posible conectar con el servidor.",
            true
        );
    } finally {
        boton.disabled = false;
        boton.textContent = "Analizar y registrar";
    }
});

formConsultar.addEventListener("submit", async event => {
    event.preventDefault();
    const folio = folioConsulta.value.trim();

    if (!folio) {
        mostrarMensaje(estadoFactura, "Ingresa el folio de la factura.", true);
        return;
    }

    mostrarMensaje(estadoFactura, "Consultando factura...");

    try {
        const respuesta = await fetch(
            `/consultar-folio/${encodeURIComponent(folio)}`
        );
        const datos = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(
                datos.mensaje || "No se encontró una factura con ese folio."
            );
        }

        mostrarFactura(
            estadoFactura,
            datos,
            datos.tipoRegistro === "DIGITAL"
                ? "Factura digital"
                : "Factura registrada"
        );
    } catch (error) {
        mostrarMensaje(
            estadoFactura,
            error.message || "No fue posible conectar con el servidor.",
            true
        );
    }
});

agregarConcepto();
