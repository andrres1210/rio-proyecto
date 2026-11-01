const archivoInput =
    document.getElementById("archivo");

const boton =
    document.getElementById("btnAnalizar");

const resultado =
    document.getElementById("resultado");

let facturaActual = null;
let historialCompleto = [];

function escaparHtml(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, caracter => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[caracter]);
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

iniciar();

async function iniciar() {

    await cargarDashboard();
    await cargarHistorial();

}

boton.addEventListener(
    "click",
    async () => {

        const archivo =
            archivoInput.files[0];

        if (!archivo) {
            resultado.innerHTML =
                "Seleccione una factura.";
            return;
        }

        resultado.innerHTML =
            "Analizando factura...";

        const formData =
            new FormData();

        formData.append(
            "factura",
            archivo
        );

        let respuesta;
        try {
            respuesta = await fetch(
                "/subir-factura",
                {
                    method: "POST",
                    body: formData
                }
            );
        } catch (error) {
            resultado.textContent =
                "No fue posible conectar con el servidor para analizar la factura.";
            return;
        }

        let datos;
        try {
            datos = await respuesta.json();
        } catch (error) {
            resultado.textContent =
                "El servidor devolvió una respuesta que no se pudo leer.";
            return;
        }

        if (!respuesta.ok) {
            resultado.textContent =
                datos.error || "No fue posible analizar la factura.";
            return;
        }

        facturaActual = datos;

        let bloqueGuardar = "";

        if (!datos.duplicado) {

            bloqueGuardar = `
                <button id="guardarFactura">
                    Guardar Factura
                </button>
            `;

        } else {

            bloqueGuardar = `
                <div style="
                    color:red;
                    font-weight:bold;
                    margin-top:10px;
                ">
                    ⚠ Folio ya registrado para este proveedor. No se puede guardar otra vez.
                </div>
            `;
        }

        resultado.innerHTML = `
            <h3>Resultado</h3>

            <p><strong>Proveedor:</strong> ${escaparHtml(datos.proveedor)}</p>
            <p><strong>RFC:</strong> ${escaparHtml(datos.rfc || "No identificado")}</p>
            <p><strong>Folio:</strong> ${escaparHtml(datos.folio)}</p>
            <p><strong>Fecha:</strong> ${escaparHtml(datos.fecha)}</p>
            <p><strong>Subtotal:</strong> ${escaparHtml(datos.subtotal)}</p>
            <p><strong>IVA:</strong> ${escaparHtml(datos.iva)}</p>
            <p><strong>Total:</strong> ${escaparHtml(datos.total)}</p>

            <p>
                <strong>Coincidencia duplicada:</strong>
                ${datos.duplicado ? "⚠️ Sí" : "✅ No"}
            </p>

            ${bloqueGuardar}
        `;

        if (!datos.duplicado) {

            document
                .getElementById(
                    "guardarFactura"
                )
                .addEventListener(
                    "click",
                    async () => {

                        let respuestaGuardado;
                        try {
                            respuestaGuardado = await fetch(
                                "/guardar-factura",
                                {
                                    method: "POST",
                                    headers: {
                                        "Content-Type":
                                            "application/json"
                                    },
                                    body: JSON.stringify(
                                        facturaActual
                                    )
                                }
                            );
                        } catch (error) {
                            resultado.textContent =
                                "No fue posible conectar con el servidor para guardar la factura.";
                            return;
                        }

                        let resultadoGuardado;
                        try {
                            resultadoGuardado =
                                await respuestaGuardado.json();
                        } catch (error) {
                            resultado.textContent =
                                "El servidor devolvió una respuesta que no se pudo leer.";
                            return;
                        }
                        if (!respuestaGuardado.ok) {
                            resultado.textContent =
                                resultadoGuardado.error ||
                                "No fue posible registrar la factura.";
                            return;
                        }

                        alert(
                            "Factura guardada correctamente"
                        );

                        await cargarDashboard();
                        await cargarHistorial();

                    }
                );
        }

    }
);

async function cargarDashboard() {

    const respuesta =
        await fetch("/historial");

    const texto =
        await respuesta.text();

    const lineas =
        texto
            .split("\n")
            .filter(
                linea =>
                    linea.trim() !== ""
            );

    historialCompleto = [];

    for (
        let i = 1;
        i < lineas.length;
        i++
    ) {

        const c =
            parsearLineaCsv(lineas[i]);

        historialCompleto.push({
            folio: c[0] || "",
            proveedor: c[1] || "",
            fecha: c[2] || "",
            total: Number(c[6]) || 0,
            duplicado: c[10] || ""
        });

    }

    const foliosUnicos =
        new Set();

    const proveedoresUnicos =
        new Set();

    let duplicados = 0;
    let totalProcesado = 0;

    historialCompleto.forEach(
        factura => {

            proveedoresUnicos.add(
                factura.proveedor
            );

            if (!foliosUnicos.has(
                factura.folio
            )) {

                foliosUnicos.add(
                    factura.folio
                );

                totalProcesado +=
                    factura.total;

            }

            if (
                factura.duplicado
                    .toLowerCase()
                    .includes("si")
            ) {
                duplicados++;
            }

        }
    );

    document
        .getElementById(
            "dashboard"
        )
        .innerHTML = `
        <div class="dashboard-grid">

            <div class="card-metrica">
                <h3>📄 Facturas Únicas</h3>
                <p>${foliosUnicos.size}</p>
            </div>

            <div class="card-metrica">
                <h3>⚠️ Duplicados</h3>
                <p>${duplicados}</p>
            </div>

            <div class="card-metrica">
                <h3>🏢 Clientes / Proveedores</h3>
                <p>${proveedoresUnicos.size}</p>
            </div>

            <div class="card-metrica">
                <h3>💰 Total Procesado</h3>
                <p>$${totalProcesado.toFixed(2)}</p>
            </div>

        </div>
        `;
}

async function cargarHistorial() {

    const respuesta =
        await fetch("/historial");

    const texto =
        await respuesta.text();

    const lineas =
        texto
            .split("\n")
            .filter(
                linea =>
                    linea.trim() !== ""
            );

    historialCompleto = [];

    for (
        let i = 1;
        i < lineas.length;
        i++
    ) {

        const c =
            parsearLineaCsv(lineas[i]);

        historialCompleto.push({
            folio: c[0] || "",
            proveedor: c[1] || "",
            fecha: c[2] || "",
            total: c[6] || "",
            duplicado: c[10] || ""
        });

    }

    renderHistorial();

}

function renderHistorial() {

    const textoBusqueda =
        document
            .getElementById("buscarFolio")
            ?.value
            .toLowerCase() || "";

    const soloDuplicados =
        document
            .getElementById("soloDuplicados")
            ?.checked || false;

    const registros =
        historialCompleto.filter(
            factura => {

                const coincideTexto =
                    factura.folio
                        .toLowerCase()
                        .includes(
                            textoBusqueda
                        );

                const coincideDuplicado =
                    !soloDuplicados ||
                    factura.duplicado
                        .toLowerCase()
                        .includes("si");

                return (
                    coincideTexto &&
                    coincideDuplicado
                );

            }
        );

    let html = `
        <h2>📋 Historial de Facturas</h2>

        <div style="margin-bottom:20px;">

            <input
                type="text"
                id="buscarFolio"
                placeholder="Buscar folio..."
                value="${escaparHtml(textoBusqueda)}"
            >

            <label style="margin-left:20px;">

                <input
                    type="checkbox"
                    id="soloDuplicados"
                    ${soloDuplicados ? "checked" : ""}
                >

                Solo duplicados

            </label>

        </div>

        <table>

            <tr>
                <th>Folio</th>
                <th>Cliente / Proveedor</th>
                <th>Fecha</th>
                <th>Total</th>
                <th>Estado</th>
            </tr>
    `;

    registros.forEach(
        factura => {

            html += `
                <tr>

                    <td>${escaparHtml(factura.folio)}</td>

                    <td>${escaparHtml(factura.proveedor)}</td>

                    <td>${escaparHtml(factura.fecha)}</td>

                    <td>${escaparHtml(factura.total)}</td>

                    <td>
                        ${
                            factura.duplicado
                                .toLowerCase()
                                .includes("si")
                                ? "⚠️ Duplicado"
                                : "✅ Normal"
                        }
                    </td>

                </tr>
            `;
        }
    );

    html += "</table>";

    document
        .getElementById(
            "historial"
        )
        .innerHTML = html;

    document
        .getElementById(
            "buscarFolio"
        )
        .addEventListener(
            "input",
            renderHistorial
        );

    document
        .getElementById(
            "soloDuplicados"
        )
        .addEventListener(
            "change",
            renderHistorial
        );
}
