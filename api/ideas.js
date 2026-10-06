async function callOpenAI(prompt) {
  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      input: prompt
    })
  });

  if (!apiResponse.ok) {
    const detail = await apiResponse.text();
    console.error("OpenAI error:", apiResponse.status, detail);
    throw new Error(`OpenAI respondió ${apiResponse.status}`);
  }

  const data = await apiResponse.json();

  let outputText = "";
  if (typeof data.output_text === "string") {
    outputText = data.output_text;
  } else if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (!Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (part.type === "output_text" && typeof part.text === "string") {
          outputText += part.text;
        }
      }
    }
  }

  return outputText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeProducts(items) {
  return Array.isArray(items)
    ? items.slice(0, 8).map(p => ({
        product: String(p?.product || p?.name || "").trim(),
        quantity: Math.max(1, Math.min(20, Number(p?.quantity) || 1))
      })).filter(p => p.product)
    : [];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Solo se permite POST." });
  }

  try {
    const body = req.body || {};

    // ===============================================================
    // MODE 1: ANALYZE CLIENT BRIEF
    // ===============================================================
    if (body.mode === "brief") {
      const briefText = String(body.briefText || "").slice(0, 28000);
      const availableProducts = Array.isArray(body.availableProducts)
        ? body.availableProducts.slice(0, 50).map(x => String(x).slice(0, 160))
        : [];

      if (briefText.length < 40) {
        return res.status(400).json({ error: "El brief no contiene suficiente texto." });
      }

      const prompt = `
Eres un estratega comercial y de contenidos de Metro Ecuador.

Analiza el BRIEF DEL CLIENTE que aparece más abajo y prepara un primer
aterrizaje comercial para una ejecutiva de ventas.

IMPORTANTE:
- Trabaja únicamente con lo que realmente dice el brief.
- Si cliente o campaña no están claros, devuelve cadena vacía.
- No inventes precios, presupuestos, métricas, resultados, fechas ni claims.
- No agregues requisitos que el brief no menciona.
- Las recomendaciones de productos deben salir EXCLUSIVAMENTE de la lista
  PRODUCTOS DISPONIBLES.
- Recomienda una combinación compacta: normalmente entre 2 y 4 tipos de producto.
- Las cantidades pueden variar (ej. 1 Reel, 1 Galería, 2 Historias).
- Los dos caminos deben ser diferentes pero coherentes con el mismo brief.
- El texto debe sonar comercial, concreto y presentable; no hagas una bajada de producción completa.

PRODUCTOS DISPONIBLES:
${availableProducts.map(x => `- ${x}`).join("\n")}

BRIEF DEL CLIENTE:
-------------------
${briefText}
-------------------

Devuelve SOLO JSON válido con esta estructura exacta:
{
  "brief": {
    "client": "Nombre del cliente si aparece claramente, o vacío",
    "campaign": "Nombre de campaña si aparece claramente, o vacío",
    "summary": "Resumen ejecutivo del brief en 2-3 frases",
    "objective": "Objetivo u oportunidad principal en 1-2 frases",
    "centralIdea": "Una idea central sugerida, corta y comercial",
    "ideas": [
      {
        "title": "Nombre corto del camino 1",
        "text": "Un párrafo de aproximadamente 70-110 palabras",
        "products": [
          {"product": "Nombre EXACTO de PRODUCTOS DISPONIBLES", "quantity": 1}
        ]
      },
      {
        "title": "Nombre corto del camino 2",
        "text": "Un párrafo de aproximadamente 70-110 palabras",
        "products": [
          {"product": "Nombre EXACTO de PRODUCTOS DISPONIBLES", "quantity": 1}
        ]
      }
    ]
  }
}
`;

      const text = await callOpenAI(prompt);
      const parsed = JSON.parse(text);
      const brief = parsed?.brief;

      if (!brief || !Array.isArray(brief.ideas) || brief.ideas.length < 2) {
        throw new Error("La respuesta no contiene dos caminos de brief.");
      }

      const normalized = {
        client: String(brief.client || "").slice(0, 160),
        campaign: String(brief.campaign || "").slice(0, 180),
        summary: String(brief.summary || ""),
        objective: String(brief.objective || ""),
        centralIdea: String(brief.centralIdea || ""),
        ideas: brief.ideas.slice(0, 2).map((idea, i) => ({
          title: String(idea?.title || `Camino ${i + 1}`),
          text: String(idea?.text || idea?.idea || ""),
          products: normalizeProducts(idea?.products)
        }))
      };

      return res.status(200).json({ brief: normalized });
    }

    // ===============================================================
    // MODE 2: GENERATE 2 IDEAS FROM MANUAL IDEA
    // ===============================================================
    const {
      client = "",
      campaign = "",
      centralIdea = "",
      selectedProducts = [],
      availableProducts = []
    } = body;

    if (!centralIdea || typeof centralIdea !== "string") {
      return res.status(400).json({ error: "Falta la idea central." });
    }

    const safeClient = String(client).slice(0, 120);
    const safeCampaign = String(campaign).slice(0, 160);
    const safeIdea = String(centralIdea).slice(0, 1800);

    const safeSelected = Array.isArray(selectedProducts)
      ? selectedProducts.slice(0, 30).map(x => String(x).slice(0, 140))
      : [];

    const safeAvailable = Array.isArray(availableProducts)
      ? availableProducts.slice(0, 60).map(x => String(x).slice(0, 140))
      : [];

    const prompt = `
Eres un estratega comercial y de contenidos de Metro Ecuador.

Debes generar DOS caminos de propuesta digital para una ejecutiva comercial.
Además de la idea, cada camino debe incluir una MINI PROPUESTA DE PRODUCTOS
con cantidades sugeridas.

CLIENTE:
${safeClient || "No indicado"}

CAMPAÑA:
${safeCampaign || "No indicada"}

IDEA INICIAL:
${safeIdea}

PRODUCTOS QUE LA EJECUTIVA YA HABÍA SELECCIONADO, SI EXISTEN:
${safeSelected.length ? safeSelected.join(", ") : "Ninguno todavía"}

PRODUCTOS DISPONIBLES EN EL TARIFARIO:
${safeAvailable.length ? safeAvailable.map(x=>`- ${x}`).join("\n") : "No disponibles"}

REGLAS:
- Genera exactamente 2 caminos.
- Cada idea debe ser un solo párrafo de aproximadamente 70 a 110 palabras.
- Los dos caminos deben ser claramente distintos.
- Después de cada idea incluye una combinación pequeña y lógica de productos.
- Normalmente recomienda entre 2 y 4 tipos de producto por camino.
- Las cantidades pueden ser 1, 2, 3, etc., según tenga sentido.
- Usa EXCLUSIVAMENTE nombres presentes en PRODUCTOS DISPONIBLES EN EL TARIFARIO.
- Puedes mantener productos ya seleccionados si encajan, pero no estás obligado.
- No inventes precios.
- No inventes métricas, alcance, impresiones ni resultados.
- No prometas resultados.

Devuelve SOLO JSON válido con esta estructura exacta:
{
  "ideas": [
    {
      "text": "Primer párrafo...",
      "products": [
        {"product": "Nombre exacto del producto", "quantity": 1}
      ]
    },
    {
      "text": "Segundo párrafo...",
      "products": [
        {"product": "Nombre exacto del producto", "quantity": 1}
      ]
    }
  ]
}
`;

    const text = await callOpenAI(prompt);
    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed.ideas) || parsed.ideas.length < 2) {
      throw new Error("La respuesta no contiene dos ideas.");
    }

    const ideas = parsed.ideas.slice(0, 2).map(item => ({
      text: String(item?.text || item?.idea || ""),
      products: normalizeProducts(item?.products)
    }));

    return res.status(200).json({ ideas });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: "No se pudo procesar la solicitud.",
      detail: error?.message || "Error desconocido"
    });
  }
}
