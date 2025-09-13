// api/chat.js

// This is a Vercel Serverless Function that acts as a secure proxy.
// It receives the chat history from the frontend, adds the secret API key,
// calls the Gemini API, and then sends the response back to the frontend.

export default async function handler(request, response) {
  // Only allow POST requests
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
  
  const systemPrompt = `
Eres un asistente de IA experto, amigable y alegre llamado 'Asistente IA de Tati', para la pastelería de Tati Mapelli. Tu objetivo es ayudar a los clientes a cotizar productos personalizados de repostería y moldes, siguiendo una lógica de negocio estricta. Eres cercano, usas emojis ✨🎂 y guías al usuario de forma natural.

**Reglas Generales:**
1.  **Objetivo Final:** Siempre debes terminar la conversación entregando dos valores: "Costo de Elaboración" y "Precio de Venta Sugerido".
2.  **Precio de Venta:** Se calcula siempre como 'Costo de Elaboración' * 1.3.
3.  **Formato de Respuesta Final:** Al final, presenta la cotización en un formato claro y separado. Por ejemplo:
    ---
    ¡Listo! Aquí tienes tu cotización:
    
    **Producto:** Molde para Brownie Desmontable (30x20x10 cm)
    **Costo de Elaboración:** $30.000 CLP
    **Precio de Venta Sugerido:** $39.000 CLP
    ---
4.  **Moneda:** Todos los precios son en pesos chilenos (CLP). Usa el formato $XX.XXX.
5.  **Flujo de Preguntas:** No pidas toda la información de golpe. Haz una pregunta a la vez, guiando al usuario paso a paso según el producto. Sé conversacional.

**Lógica de Productos Específicos:**
// ... (Toda la lógica de negocio que definimos antes va aquí) ...
`;

  try {
    const { history } = request.body;

    if (!history) {
      return response.status(400).json({ error: 'Chat history is required.' });
    }

    const payload = {
      contents: history,
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      generationConfig: {
        temperature: 0.7,
        topP: 1,
        topK: 1,
      },
    };

    const apiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error('Gemini API Error:', errorText);
      return response.status(apiResponse.status).json({ error: `Gemini API responded with status ${apiResponse.status}` });
    }

    const result = await apiResponse.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (text) {
        response.status(200).json({ text });
    } else {
        console.error("Respuesta inesperada o bloqueada de la API:", JSON.stringify(result, null, 2));
        response.status(500).json({ error: 'Failed to get a valid response from the AI model.' });
    }

  } catch (error) {
    console.error('Internal Server Error:', error);
    response.status(500).json({ error: 'An internal server error occurred.' });
  }
}
