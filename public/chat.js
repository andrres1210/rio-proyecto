const boton =
    document.getElementById("btnEnviarChat");
const mensaje =
    document.getElementById("mensajeChat");
const chat =
    document.getElementById("chatMensajes");
const formulario =
    document.getElementById("formChat");
const sugerencias =
    document.querySelectorAll(".sugerencia-chat");
const botonDictado =
    document.getElementById("btnDictarChat");
const estadoDictado =
    document.getElementById("estadoDictado");
const soporteLectura =
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window;

const tiempoMinimoRespuesta = 750;
const duracionEscrituraRespuesta = 1400;
const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
let reconocimientoVoz = null;
let textoAntesDelDictado = "";
let dictadoFinal = "";
let dictadoIntermedio = "";
let huboErrorDictado = false;
let botonLecturaActivo = null;

function textoParaLeer(texto) {
    return texto
        .replace(/\n\s*Fuente:\s*.+$/s, "")
        .replace(/\s+/g, " ")
        .trim();
}

function seleccionarVozEspanol(voces) {
    const vocesEspanolMexico =
        voces.filter(voz =>
            voz.lang.toLowerCase() === "es-mx"
        );
    const vozPreferida =
        vocesEspanolMexico.find(voz =>
            /sabina/i.test(voz.name)
        );

    return vozPreferida ||
        vocesEspanolMexico[0] ||
        voces.find(voz =>
            voz.lang.toLowerCase().startsWith("es")
        ) ||
        null;
}

function restablecerBotonLectura() {
    if (!botonLecturaActivo) return;

    botonLecturaActivo.setAttribute("aria-pressed", "false");
    botonLecturaActivo.lastElementChild.textContent = "Leer respuesta";
    botonLecturaActivo.setAttribute(
        "aria-label",
        "Leer respuesta en voz alta"
    );
    botonLecturaActivo = null;
}

function leerRespuesta(botonLectura, texto) {
    if (!soporteLectura) return;

    if (botonLecturaActivo === botonLectura && speechSynthesis.speaking) {
        speechSynthesis.cancel();
        restablecerBotonLectura();
        return;
    }

    speechSynthesis.cancel();
    restablecerBotonLectura();

    const textoLimpio = textoParaLeer(texto);
    if (!textoLimpio) return;

    const voz = new SpeechSynthesisUtterance(textoLimpio);
    voz.lang = "es-MX";
    voz.rate = 0.96;
    voz.pitch = 1.04;
    voz.volume = 1;
    voz.voice = seleccionarVozEspanol(
        speechSynthesis.getVoices()
    );

    botonLecturaActivo = botonLectura;
    botonLectura.setAttribute("aria-pressed", "true");
    botonLectura.lastElementChild.textContent = "Detener lectura";
    botonLectura.setAttribute("aria-label", "Detener lectura en voz alta");
    voz.onend = () => {
        if (botonLecturaActivo === botonLectura) {
            restablecerBotonLectura();
        }
    };
    voz.onerror = () => {
        if (botonLecturaActivo === botonLectura) {
            restablecerBotonLectura();
        }
    };

    speechSynthesis.speak(voz);
}

function crearControlLectura(visible = false) {
    const botonLectura = document.createElement("button");
    botonLectura.className = "boton-leer-respuesta";
    botonLectura.type = "button";
    botonLectura.setAttribute("aria-label", "Leer respuesta en voz alta");
    botonLectura.setAttribute("aria-pressed", "false");
    botonLectura.hidden = !visible;
    const icono = document.createElement("span");
    icono.setAttribute("aria-hidden", "true");
    icono.textContent = "🔊";
    const etiqueta = document.createElement("span");
    etiqueta.textContent = "Leer respuesta";
    botonLectura.append(icono, etiqueta);
    return botonLectura;
}

function actualizarCampoDictado() {
    const partes = [
        textoAntesDelDictado.trim(),
        dictadoFinal.trim(),
        dictadoIntermedio.trim()
    ].filter(Boolean);

    mensaje.value = partes.join(" ");
    mensaje.dispatchEvent(new Event("input", { bubbles: true }));
}

function establecerEstadoDictado(texto) {
    estadoDictado.textContent = texto;
}

function iniciarODetenerDictado() {
    if (!reconocimientoVoz) return;

    if (botonDictado.classList.contains("dictado-activo")) {
        reconocimientoVoz.stop();
        return;
    }

    textoAntesDelDictado = mensaje.value;
    dictadoFinal = "";
    dictadoIntermedio = "";

    try {
        reconocimientoVoz.start();
    } catch (error) {
        if (error.name !== "InvalidStateError") {
            console.error("No fue posible iniciar el dictado por voz.", error);
            establecerEstadoDictado(
                "No fue posible iniciar el micrófono. Inténtalo de nuevo."
            );
        }
    }
}

function desplazarChatAlFinal(suave = true) {
    if (!suave) {
        chat.scrollTop = chat.scrollHeight;
        return;
    }

    chat.scrollTo({
        top: chat.scrollHeight,
        behavior: "smooth"
    });
}

chat.addEventListener("click", event => {
    const botonLectura =
        event.target.closest(".boton-leer-respuesta");

    if (!botonLectura || botonLectura.disabled) return;

    const contenido =
        botonLectura.closest(".burbuja-mensaje")
            .querySelector(".mensaje-contenido");
    leerRespuesta(botonLectura, contenido.textContent);
});

function agregarMensaje(clase, etiqueta, texto) {
    const contenedor =
        document.createElement("div");
    contenedor.className = clase;

    if (clase === "mensaje-bot") {
        const avatar =
            document.createElement("span");
        avatar.className = "mensaje-avatar";
        avatar.setAttribute("aria-hidden", "true");
        avatar.textContent = "RC";
        contenedor.appendChild(avatar);
    }

    const burbuja =
        document.createElement("div");
    burbuja.className = "burbuja-mensaje";

    const titulo =
        document.createElement("strong");
    titulo.textContent = etiqueta;

    const contenido =
        document.createElement("div");
    contenido.className = "mensaje-contenido";
    contenido.textContent = texto;

    burbuja.append(titulo, contenido);
    if (clase.includes("mensaje-bot")) {
        burbuja.appendChild(crearControlLectura());
    }
    contenedor.appendChild(burbuja);
    chat.appendChild(contenedor);
    desplazarChatAlFinal();

    return contenedor;
}

function mostrarRespuestaGradual(contenido, texto) {
    const caracteres = Array.from(texto);
    const paso =
        Math.max(
            1,
            Math.ceil(caracteres.length / 64)
        );
    const intervalo =
        duracionEscrituraRespuesta / Math.ceil(
            caracteres.length / paso
        );
    let posicion = 0;

    return new Promise(resolve => {
        function escribirSiguienteParte() {
            const siguiente =
                caracteres
                    .slice(posicion, posicion + paso)
                    .join("");

            contenido.textContent += siguiente;
            posicion += paso;
            desplazarChatAlFinal(false);

            if (posicion < caracteres.length) {
                setTimeout(escribirSiguienteParte, intervalo);
            } else {
                resolve();
            }
        }

        escribirSiguienteParte();
    });
}

function prepararRespuesta(texto) {
    const fuentes = new Set();
    const respuesta =
        texto
            .replace(/\*\*(.*?)\*\*/g, "$1")
            .replace(
                /【\d+:\d+†([^】]+)】/g,
                (_, fuente) => {
                    fuentes.add(fuente.trim());
                    return "";
                }
            )
            .replace(/[ \t]+([.,;!?])/g, "$1")
            .replace(/[ \t]{2,}/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

    return fuentes.size > 0
        ? `${respuesta}\n\nFuente: ${[...fuentes].join(", ")}`
        : respuesta;
}

async function enviarMensaje() {
    const pregunta = mensaje.value.trim();

    if (!pregunta || boton.disabled) return;

    agregarMensaje("mensaje-usuario", "Tú", pregunta);
    mensaje.value = "";
    mensaje.style.height = "auto";
    boton.disabled = true;
    mensaje.disabled = true;
    botonDictado.disabled = true;
    formulario.classList.add("chat-ocupado");
    if (botonDictado.classList.contains("dictado-activo")) {
        reconocimientoVoz.stop();
    }

    const inicio = Date.now();
    const indicador = agregarMensaje(
        "mensaje-bot mensaje-escribiendo",
        "Río Claro",
        "Estoy consultando la información disponible"
    );
    indicador.setAttribute("role", "status");
    indicador.setAttribute("aria-label", "Río Claro está preparando una respuesta");

    try {
        const respuesta = await fetch("/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ pregunta })
        });

        const datos = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(
                datos.respuesta ||
                "No fue posible consultar al asistente."
            );
        }

        const tiempoRestante =
            tiempoMinimoRespuesta - (Date.now() - inicio);

        if (tiempoRestante > 0) {
            await new Promise(resolve =>
                setTimeout(resolve, tiempoRestante)
            );
        }

        indicador.classList.remove("mensaje-escribiendo");
        indicador.removeAttribute("role");
        indicador.removeAttribute("aria-label");
        const contenidoRespuesta =
            indicador.querySelector(".mensaje-contenido");
        contenidoRespuesta.textContent = "";
        const controlLectura =
            indicador.querySelector(".boton-leer-respuesta");
        controlLectura.hidden = false;
        await mostrarRespuestaGradual(
            contenidoRespuesta,
            prepararRespuesta(datos.respuesta)
        );
    } catch (error) {
        indicador.classList.remove("mensaje-escribiendo");
        indicador.removeAttribute("role");
        indicador.removeAttribute("aria-label");
        indicador.querySelector(".mensaje-contenido").textContent =
            "Uy, no pude completar la respuesta. ¿Lo intentamos de nuevo?";
    } finally {
        boton.disabled = false;
        mensaje.disabled = false;
        botonDictado.disabled = !reconocimientoVoz;
        formulario.classList.remove("chat-ocupado");
        mensaje.focus();
    }
}

if (formulario) {
    formulario.addEventListener("submit", event => {
        event.preventDefault();
        enviarMensaje();
    });
} else {
    boton.addEventListener("click", enviarMensaje);
}

mensaje.addEventListener("keydown", event => {
    if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.isComposing
    ) {
        event.preventDefault();
        enviarMensaje();
    }
});

mensaje.addEventListener("input", () => {
    mensaje.style.height = "auto";
    mensaje.style.height =
        `${Math.min(mensaje.scrollHeight, 160)}px`;
});

for (const sugerencia of sugerencias) {
    sugerencia.addEventListener("click", () => {
        mensaje.value = sugerencia.dataset.pregunta || "";
        mensaje.focus();
        mensaje.dispatchEvent(new Event("input"));
        enviarMensaje();
    });
}

if (SpeechRecognition) {
    reconocimientoVoz = new SpeechRecognition();
    reconocimientoVoz.lang = "es-MX";
    reconocimientoVoz.continuous = true;
    reconocimientoVoz.interimResults = true;

    reconocimientoVoz.onstart = () => {
        huboErrorDictado = false;
        botonDictado.classList.add("dictado-activo");
        botonDictado.setAttribute("aria-label", "Detener dictado por voz");
        botonDictado.title = "Detener dictado por voz";
        establecerEstadoDictado(
            "Te escucho. Habla con claridad; puedes detener el dictado cuando quieras."
        );
    };

    reconocimientoVoz.onresult = event => {
        const partesFinales = [];
        const partesIntermedias = [];

        for (let indice = 0; indice < event.results.length; indice++) {
            const resultado = event.results[indice];
            const transcripcion = resultado[0].transcript.trim();

            if (resultado.isFinal) {
                partesFinales.push(transcripcion);
            } else {
                partesIntermedias.push(transcripcion);
            }
        }

        dictadoFinal = partesFinales.join(" ");
        dictadoIntermedio = partesIntermedias.join(" ");
        actualizarCampoDictado();
        establecerEstadoDictado(
            dictadoIntermedio
                ? `Te escucho: ${dictadoIntermedio}`
                : "Dictado agregado al mensaje. Puedes revisarlo antes de enviarlo."
        );
    };

    reconocimientoVoz.onerror = event => {
        const mensajesError = {
            "not-allowed": "No hay permiso para usar el micrófono. Habilítalo en el navegador e inténtalo de nuevo.",
            "service-not-allowed": "El navegador no permite el servicio de reconocimiento de voz.",
            "audio-capture": "No se encontró un micrófono disponible.",
            "no-speech": "No se detectó voz. Puedes volver a intentarlo.",
            network: "No se pudo completar el reconocimiento de voz por un problema de conexión."
        };
        const mensajeError =
            mensajesError[event.error] ||
            "Ocurrió un error durante el dictado. Inténtalo de nuevo.";

        huboErrorDictado = true;
        establecerEstadoDictado(mensajeError);
    };

    reconocimientoVoz.onend = () => {
        dictadoIntermedio = "";
        actualizarCampoDictado();
        botonDictado.classList.remove("dictado-activo");
        botonDictado.setAttribute("aria-label", "Dictar mensaje por voz");
        botonDictado.title = "Dictar mensaje por voz";

        if (!huboErrorDictado) {
            establecerEstadoDictado(
                mensaje.value.trim()
                    ? "Dictado listo. Revisa el texto y envíalo cuando quieras."
                    : "Dictado detenido."
            );
        }
    };

    botonDictado.addEventListener("click", iniciarODetenerDictado);
} else {
    botonDictado.disabled = true;
    botonDictado.title = "El navegador no admite dictado por voz";
    establecerEstadoDictado(
        "El dictado por voz no está disponible en este navegador. Prueba con Chrome o Edge actualizado."
    );
}

if (!soporteLectura) {
    for (const control of document.querySelectorAll(".boton-leer-respuesta")) {
        control.disabled = true;
        control.title = "La lectura en voz alta no está disponible en este navegador";
    }
}

const preguntaInicial =
    new URLSearchParams(window.location.search).get("pregunta");

if (preguntaInicial) {
    mensaje.value = preguntaInicial.slice(0, 2000);
    mensaje.dispatchEvent(new Event("input"));
    mensaje.focus();
}
