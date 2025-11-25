// api/chat.js
// Vercel Serverless Function para Tati Bot

module.exports = async (request, response) => {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return response.status(500).json({ error: 'API Key missing' });
  }

  // --- LÓGICA DE NEGOCIO (PRECIOS) ---
  // Aquí centralizamos los precios. Si algo cambia, solo editas esto.
  const PRECIOS = {
    MOLDE: {
      fijo: 22500,
      desmontable: 30000,
      areaBase: 600, // cm2 (30x20)
      ajusteCm2: 5,  // $5 por cada cm2 extra
      division: 1250,
      factorReforzado: 1.25 // 1.5mm
    },
    PANQUEQUERA: {
      factorDiametro: 625,
      restaBase: 4250,
      minimo: 2000,
      factorEspesor3mm: 1.4
    },
    VARILLAS: { base: 2500, factorArea: 0.5, factorEspesor3mm: 1.4 },
    PLACAS: { base: 1500, factorArea: 2.5, factorEspesor3mm: 1.4 },
    MARGEN_VENTA: 1.3 // Costo * 1.3 = Precio Venta
  };

  function formatearMoneda(valor) {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(Math.round(valor));
  }

  function calcularCotizacion(datos) {
    let costo = 0;
    let descripcion = "";

    // 1. MOLDES
    if (datos.tipo === 'molde') {
      const { largo, ancho, subtipo, divisiones, espesor } = datos; // subtipo: 'fijo' o 'desmontable'
      const area = largo * ancho;
      
      let precioBase = subtipo === 'fijo' ? PRECIOS.MOLDE.fijo : PRECIOS.MOLDE.desmontable;
      
      // Ajuste por tamaño
      let ajusteTamano = 0;
      if (area > PRECIOS.MOLDE.areaBase) {
        ajusteTamano = (area - PRECIOS.MOLDE.areaBase) * PRECIOS.MOLDE.ajusteCm2;
      }

      // Divisiones
      const costoDiv = (divisiones || 0) * PRECIOS.MOLDE.division;

      let costoTotal = precioBase + ajusteTamano + costoDiv;

      // Espesor (Reforzado)
      if (espesor === '1.5mm' || espesor === 1.5) {
        costoTotal *= PRECIOS.MOLDE.factorReforzado;
      }
      
      costo = costoTotal;
      descripcion = `Molde ${subtipo} de ${largo}x${ancho}cm` + (divisiones ? ` con ${divisiones} divisiones` : "") + ` (${espesor}mm)`;
    }

    // 2. PANQUEQUERAS
    else if (datos.tipo === 'panquequera') {
        const { forma, d, l, a, espesor } = datos;
        let diametroEq = 0;

        if (forma === 'redonda') {
            diametroEq = d;
            descripcion = `Panquequera Redonda Ø${d}cm`;
        } else {
            // Rectangular a equivalente
            diametroEq = 2 * Math.sqrt((l * a) / Math.PI);
            descripcion = `Panquequera Rectangular ${l}x${a}cm`;
        }

        let base = (PRECIOS.PANQUEQUERA.factorDiametro * diametroEq) - PRECIOS.PANQUEQUERA.restaBase;
        if (base < PRECIOS.PANQUEQUERA.minimo) base = PRECIOS.PANQUEQUERA.minimo;

        if (espesor === '3mm' || espesor === 3) {
            base *= PRECIOS.PANQUEQUERA.factorEspesor3mm;
        }
        costo = base;
        descripcion += ` (${espesor}mm)`;
    }

    // 3. VARILLAS / PLACAS
    else if (datos.tipo === 'varillas' || datos.tipo === 'placas') {
        const { l, a, espesor } = datos;
        const area = l * a;
        let base = 0;
        
        if (datos.tipo === 'varillas') {
            base = PRECIOS.VARILLAS.base + (area * PRECIOS.VARILLAS.factorArea);
            descripcion = `Juego de Varillas ${l}x${a}cm`;
        } else {
            base = PRECIOS.PLACAS.base + (area * PRECIOS.PLACAS.factorArea);
            descripcion = `Placa de Acrílico ${l}x${a}cm`;
        }

        if (espesor === '3mm' || espesor === 3) {
            base *= (datos.tipo === 'varillas' ? PRECIOS.VARILLAS.factorEspesor3mm : PRECIOS.PLACAS.factorEspesor3mm);
        }
        costo = base;
        descripcion += ` (${espesor}mm)`;
    }

    const precioVenta = costo * PRECIOS.MARGEN_VENTA;

    return {
        producto: descripcion,
        costo: formatearMoneda(costo),
        precio: formatearMoneda(precioVenta),
        precioNumerico: Math.round(precioVenta) // Para link de pago o similar si se necesitara
    };
  }
  // -------------------------------------

  const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
  
  // Prompt diseñado para NO calcular, sino extraer JSON
  const systemPrompt = `
Eres Tati Bot 🎂, asistente de "La Tiendita de Tati Mapelli".
Tu objetivo es guiar al cliente para cotizar: Moldes (Aluminio), Panquequeras (Acrílico), Varillas o Placas.

**REGLA DE ORO: TÚ NO CALCULAS PRECIOS.**
Tu único trabajo es conversar amablemente para obtener los datos técnicos.
Cuando tengas TODOS los datos necesarios para un producto, en lugar de dar un precio, DEBES generar un bloque de código JSON oculto. El sistema calculará el precio por ti.

**Flujo de Conversación:**
1. Saluda y pregunta qué necesitan.
2. Pide dimensiones (largo, ancho, alto, diámetro), tipo (fijo/desmontable) y espesor (1mm/1.5mm o 2mm/3mm) según corresponda.
3. SIEMPRE confirma los datos antes de cotizar.

**CUANDO TENGAS LOS DATOS COMPLETOS:**
Responde con un mensaje amable diciendo "¡Perfecto! Aquí tienes tu cotización:" seguido INMEDIATAMENTE de este bloque JSON (sin markdown de código, solo el json string):

CALCULAR_JSON:{"tipo": "molde", "subtipo": "desmontable", "largo": 30, "ancho": 20, "espesor": 1.5, "divisiones": 0}

**Tipos válidos para el JSON:**
- Molde: { "tipo": "molde", "subtipo": "fijo"|"desmontable", "largo": N, "ancho": N, "espesor": 1|1.5, "divisiones": N }
- Panquequera Redonda: { "tipo": "panquequera", "forma": "redonda", "d": N, "espesor": 2|3 }
- Panquequera Rect: { "tipo": "panquequera", "forma": "rectangular", "l": N, "a": N, "espesor": 2|3 }
- Varillas/Placas: { "tipo": "varillas"|"placas", "l": N, "a": N, "espesor": 2|3 }

Si el usuario pregunta algo general ("¿haces envíos?", "hola"), responde normal como asistente amable.
`;

  try {
    const { history } = request.body;
    
    // Llamada a Gemini
    const payload = {
      contents: history,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0.5 } // Menos temperatura para ser más preciso con el JSON
    };

    const apiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await apiResponse.json();
    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "Lo siento, tuve un error.";

    // --- INTERCEPTAR Y CALCULAR ---
    // Buscamos si el bot mandó la señal de calcular
    if (text.includes("CALCULAR_JSON:")) {
        try {
            // Extraer el JSON string
            const jsonPart = text.split("CALCULAR_JSON:")[1].trim();
            // Limpiar posibles caracteres extra si el bot alucina markdown
            const jsonClean = jsonPart.replace(/```json/g, '').replace(/```/g, '').trim();
            
            const datosPedido = JSON.parse(jsonClean);
            
            // Ejecutar la matemática exacta
            const cotizacion = calcularCotizacion(datosPedido);

            // Reconstruir la respuesta final para el usuario
            const respuestaFinal = `¡Listo! ✨ He calculado el valor exacto para tu diseño:

<div class="quote-card">
  <div class="quote-header">COTIZACIÓN OFICIAL</div>
  <div class="quote-body">
    <div class="quote-item"><strong>Producto:</strong> ${cotizacion.producto}</div>
    <div class="quote-price">${cotizacion.precio}</div>
    <div class="quote-note">*Valor sugerido de venta (IVA incluido)*</div>
  </div>
  <a href="https://wa.me/56900000000?text=${encodeURIComponent('Hola Tati, quiero encargar: ' + cotizacion.producto)}" target="_blank" class="quote-btn">¡Lo quiero! 🛍️</a>
</div>

¿Te gustaría agregar algo más a este pedido?`;

            // Enviamos esto al frontend en lugar del JSON crudo
            return response.status(200).json({ text: respuestaFinal });

        } catch (e) {
            console.error("Error calculando precio:", e);
            // Fallback si falla el JSON
            return response.status(200).json({ text: "¡Ups! Tengo los datos pero falló mi calculadora interna. Por favor avísale a Tati manualmente." });
        }
    }

    // Si no hay cálculo, devolvemos la respuesta normal (charla)
    response.status(200).json({ text });

  } catch (error) {
    console.error(error);
    response.status(500).json({ error: 'Internal server error' });
  }
};
