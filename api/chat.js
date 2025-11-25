// api/chat.js
// Vercel Serverless Function para Tati Bot

module.exports = async (request, response) => {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("API Key missing");
    return response.status(500).json({ error: 'API Key missing in server' });
  }

  // --- LÓGICA DE NEGOCIO (PRECIOS) ---
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
      const { largo, ancho, subtipo, divisiones, espesor } = datos; 
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
        precioNumerico: Math.round(precioVenta)
    };
  }

  // ✅ CORRECCIÓN 1: Usar modelo estable gemini-1.5-flash
  const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const systemPrompt = `
Eres Tati Bot 🎂, asistente de "La Tiendita de Tati Mapelli".
Tu objetivo es guiar al cliente para cotizar: Moldes (Aluminio), Panquequeras (Acrílico), Varillas o Placas.

**REGLA DE ORO: TÚ NO CALCULAS PRECIOS.**
Tu único trabajo es conversar amablemente para obtener los datos técnicos.
Cuando tengas TODOS los datos necesarios para un producto, genera un JSON oculto.

**Flujo:**
1. Saluda y pregunta qué necesitan.
2. Pide dimensiones, tipo y espesor.
3. Confirma datos.

**OUTPUT FINAL (JSON):**
Responde: "¡Perfecto! Aquí tienes tu cotización:" seguido de:
CALCULAR_JSON:{"tipo": "molde", "subtipo": "desmontable", "largo": 30, "ancho": 20, "espesor": 1.5, "divisiones": 0}

Si es charla general, responde amable.
`;

  try {
    const { history } = request.body;
    
    const payload = {
      contents: history,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { 
          temperature: 0.5,
          maxOutputTokens: 500 
      },
      // ✅ CORRECCIÓN 2: Desactivar filtros de seguridad para evitar bloqueos falsos
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
      ]
    };

    const apiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!apiResponse.ok) {
        const errText = await apiResponse.text();
        console.error("Gemini API Error:", errText);
        return response.status(apiResponse.status).json({ error: `Error Google: ${apiResponse.status}` });
    }

    const result = await apiResponse.json();
    
    // ✅ CORRECCIÓN 3: Validación robusta de la respuesta
    const candidate = result.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;

    if (!text) {
        // Si no hay texto, vemos por qué (FinishReason)
        console.error("Respuesta vacía de Gemini:", JSON.stringify(result, null, 2));
        const reason = candidate?.finishReason || "UNKNOWN";
        // Devolvemos el error al usuario para entender qué pasa
        return response.status(200).json({ text: `(Error Técnico: Google bloqueó la respuesta. Razón: ${reason})` });
    }

    // --- INTERCEPTAR Y CALCULAR ---
    if (text.includes("CALCULAR_JSON:")) {
        try {
            const jsonPart = text.split("CALCULAR_JSON:")[1].trim();
            const jsonClean = jsonPart.replace(/```json/g, '').replace(/```/g, '').trim();
            const datosPedido = JSON.parse(jsonClean);
            const cotizacion = calcularCotizacion(datosPedido);

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

¿Te gustaría agregar algo más?`;

            return response.status(200).json({ text: respuestaFinal });

        } catch (e) {
            console.error("Error calculando JSON:", e);
            return response.status(200).json({ text: "¡Ups! Entendí tu pedido pero falló mi calculadora. Por favor avísale a Tati." });
        }
    }

    response.status(200).json({ text });

  } catch (error) {
    console.error("Server Error:", error);
    response.status(500).json({ error: 'Internal server error' });
  }
};
